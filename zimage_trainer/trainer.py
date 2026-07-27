"""One-purpose Flow Matching LoRA trainer for Z-Image Turbo."""

from __future__ import annotations

import argparse
import itertools
import random
import subprocess
import sys
from pathlib import Path

import torch
import yaml
from accelerate import Accelerator
from diffusers import ZImagePipeline
from torch.utils.data import DataLoader

from .checkpoints import checkpoint_path, prune_checkpoints
from .config import load_config, validation_samples
from .data import CaptionedImageFolder
from .lora import LoRALinear, add_lora, merge_training_adapter, save_user_lora


def generate_sample(config: dict, transformer: torch.nn.Module, accelerator: Accelerator, step: int, baseline: bool = False) -> None:
    """Run validation inference after releasing the frozen base model VRAM."""
    sample, output_dir = config["sample"], Path(config["train"]["output_dir"])
    samples_dir = output_dir / "samples"
    samples_dir.mkdir(parents=True, exist_ok=True)
    label = "baseline" if baseline else f"step_{step:06d}"
    samples = validation_samples(sample)
    lora_path = None
    temporary_lora = False
    if not baseline:
        saved_checkpoint = checkpoint_path(output_dir, step)
        if saved_checkpoint.exists():
            lora_path = saved_checkpoint
        else:
            lora_path = samples_dir / f".validation_lora_step_{step}.safetensors"
            temporary_lora = True
    model = accelerator.unwrap_model(transformer)
    try:
        if temporary_lora and lora_path:
            save_user_lora(model, lora_path, {"base_model": config["model"]["id"], "rank": str(config["lora"]["rank"]), "format": "zimage-trainer-v1"})
        model.to("cpu")
        torch.cuda.empty_cache()
        for index, validation in enumerate(samples, start=1):
            image_label = label if len(samples) == 1 else f"{label}_{index:02d}"
            image_path = samples_dir / f"{image_label}.png"
            command = [sys.executable, "infer.py", "--prompt", validation["prompt"], "--output", str(image_path), "--seed", str(sample["seed"] + index - 1), "--width", str(validation["width"]), "--height", str(validation["height"])]
            if lora_path:
                command.extend(["--lora", str(lora_path), "--lora-rank", str(config["lora"]["rank"]), "--lora-alpha", str(config["lora"]["alpha"])])
            print(f"SAMPLE starting {image_label}", flush=True)
            result = subprocess.run(command, check=False)
            print(f"SAMPLE {'saved ' + image_path.as_posix() if result.returncode == 0 else 'failed ' + image_label + ' exit=' + str(result.returncode)}", flush=True)
    finally:
        if temporary_lora and lora_path:
            lora_path.unlink(missing_ok=True)
        model.to(accelerator.device)
        torch.cuda.empty_cache()


def train(config_path: str) -> None:
    config = load_config(config_path)
    train_config, model_config = config["train"], config["model"]
    output_dir = Path(train_config["output_dir"])
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "config.yaml").write_text(yaml.safe_dump(config, sort_keys=False), encoding="utf-8")

    accelerator = Accelerator(mixed_precision="bf16", gradient_accumulation_steps=train_config["gradient_accumulation"])
    random.seed(train_config["seed"] + accelerator.process_index)
    torch.manual_seed(train_config["seed"] + accelerator.process_index)

    pipe = ZImagePipeline.from_pretrained(model_config["id"], torch_dtype=torch.bfloat16)
    transformer = pipe.transformer
    # Turbo is distilled for inference. This adapter creates the train-time model;
    # do not save it, otherwise the final LoRA would not apply to stock Turbo.
    merge_training_adapter(transformer, model_config["training_adapter"])
    add_lora(transformer, config["lora"]["rank"], config["lora"]["alpha"])
    if train_config.get("gradient_checkpointing", True):
        transformer.enable_gradient_checkpointing()
    for parameter in transformer.parameters():
        parameter.requires_grad_(False)
    for module in transformer.modules():
        if isinstance(module, LoRALinear):
            module.down.requires_grad_(True)
            module.up.requires_grad_(True)

    device = accelerator.device
    # The pipeline already loaded the VAE in bf16. Avoid re-casting on every
    # device move; AutoencoderKL warns when its dtype is forced repeatedly.
    pipe.vae.to("cpu").eval().requires_grad_(False)
    pipe.text_encoder.to("cpu", dtype=torch.bfloat16).eval().requires_grad_(False)
    dataset = CaptionedImageFolder(**config["data"])
    loader = DataLoader(dataset, batch_size=train_config["batch_size"], shuffle=True, num_workers=0, pin_memory=True)
    optimizer = torch.optim.AdamW((p for p in transformer.parameters() if p.requires_grad), lr=train_config["learning_rate"])
    transformer, optimizer, loader = accelerator.prepare(transformer, optimizer, loader)
    pipe.transformer = transformer
    data_iter = itertools.cycle(loader)

    if accelerator.is_main_process and config["sample"].get("enabled"):
        generate_sample(config, transformer, accelerator, step=0, baseline=True)

    for step in range(1, train_config["steps"] + 1):
        if accelerator.is_main_process and step == 1:
            print("STAGE preparing first training batch", flush=True)
        batch = next(data_iter)
        with accelerator.accumulate(transformer):
            with torch.no_grad():
                # VAE and Qwen are frozen. Keeping them on CPU between the two
                # encoding phases frees several GB before Transformer backward.
                pipe.vae.to(device)
                if accelerator.is_main_process and step == 1:
                    print("STAGE encoding first image", flush=True)
                pixels = batch["pixels"].to(device, dtype=torch.bfloat16, non_blocking=True)
                latents = pipe.vae.encode(pixels).latent_dist.sample()
                latents = (latents - pipe.vae.config.shift_factor) * pipe.vae.config.scaling_factor
                if train_config.get("offload_aux_models", True):
                    pipe.vae.to("cpu")
                    torch.cuda.empty_cache()
                pipe.text_encoder.to(device, dtype=torch.bfloat16)
                if accelerator.is_main_process and step == 1:
                    print("STAGE encoding first caption", flush=True)
                prompt_embeds = pipe.encode_prompt(batch["caption"], device=device, do_classifier_free_guidance=False)[0]
                if train_config.get("offload_aux_models", True):
                    pipe.text_encoder.to("cpu")
                    torch.cuda.empty_cache()
            noise = torch.randn_like(latents, dtype=torch.float32)
            latents, noise = latents.float(), noise.float()
            timesteps = torch.randint(1, 1001, (latents.shape[0],), device=device, dtype=torch.float32)
            t = timesteps.view(-1, 1, 1, 1) / 1000
            noisy_latents = (1 - t) * latents + t * noise
            latent_list = list(noisy_latents.to(torch.bfloat16).unsqueeze(2).unbind(dim=0))
            prediction_list = transformer(latent_list, (1000 - timesteps) / 1000, prompt_embeds, return_dict=False)[0]
            # Z-Image's transformer uses the opposite velocity convention from
            # our forward flow target. ai-toolkit's ZImageModel applies this
            # same negation in get_noise_prediction before comparing against
            # (noise - latents). Without it, loss falls while inference is
            # driven toward noise instead of toward a clean sample.
            prediction = -torch.stack([item.float() for item in prediction_list]).squeeze(2)
            loss = torch.nn.functional.mse_loss(prediction, noise - latents)
            if accelerator.is_main_process and step == 1:
                print("STAGE running first backward pass", flush=True)
            accelerator.backward(loss)
            if accelerator.sync_gradients:
                accelerator.clip_grad_norm_((p for p in transformer.parameters() if p.requires_grad), 1.0)
            optimizer.step()
            optimizer.zero_grad(set_to_none=True)

        if accelerator.is_main_process and (step == 1 or step % train_config.get("log_every", 1) == 0):
            print(f"step {step}/{train_config['steps']}  loss={loss.detach().item():.5f}", flush=True)
        if accelerator.is_main_process and (step % train_config["save_every"] == 0 or step == train_config["steps"]):
            save_user_lora(accelerator.unwrap_model(transformer), checkpoint_path(output_dir, step), {"base_model": model_config["id"], "rank": str(config["lora"]["rank"]), "format": "zimage-trainer-v1"})
            removed = prune_checkpoints(output_dir, train_config["keep_last"])
            if removed:
                print(f"CHECKPOINT removed {', '.join(path.name for path in removed)}", flush=True)
        if accelerator.is_main_process and config["sample"].get("enabled") and (step % config["sample"]["every"] == 0 or step == train_config["steps"]):
            generate_sample(config, transformer, accelerator, step=step)
    accelerator.wait_for_everyone()


def main() -> None:
    parser = argparse.ArgumentParser(description="Train a LoRA for Z-Image Turbo")
    parser.add_argument("config", help="Path to a YAML config")
    train(parser.parse_args().config)


if __name__ == "__main__":
    main()

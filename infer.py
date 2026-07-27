"""Generate one image with Tongyi-MAI/Z-Image-Turbo.

The first run downloads roughly 33 GB of model weights into the Hugging Face
cache. Subsequent runs reuse that cache.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import torch
from diffusers import ZImagePipeline
from zimage_trainer.lora import load_user_lora


MODEL_ID = "Tongyi-MAI/Z-Image-Turbo"


def main() -> None:
    parser = argparse.ArgumentParser(description="Minimal Z-Image Turbo inference")
    parser.add_argument(
        "--prompt",
        default="A tiny red panda astronaut tending plants inside a glass space station, cinematic sunlight, detailed",
    )
    parser.add_argument("--output", type=Path, default=Path("outputs/zimage-turbo.png"))
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--width", type=int, default=1024)
    parser.add_argument("--height", type=int, default=1024)
    parser.add_argument("--steps", type=int, default=9, help="Turbo inference steps")
    parser.add_argument("--lora", type=Path, help="A .safetensors file produced by train.py")
    parser.add_argument("--lora-rank", type=int, default=16)
    parser.add_argument("--lora-alpha", type=float, default=16)
    args = parser.parse_args()

    if not torch.cuda.is_available():
        raise RuntimeError("Z-Image Turbo inference requires a CUDA-capable GPU.")

    pipe = ZImagePipeline.from_pretrained(MODEL_ID, torch_dtype=torch.bfloat16)
    pipe.set_progress_bar_config(disable=True)
    if args.lora:
        load_user_lora(pipe.transformer, args.lora, args.lora_rank, args.lora_alpha)
    pipe.to("cuda")
    generator = torch.Generator(device="cuda").manual_seed(args.seed)

    image = pipe(
        prompt=args.prompt,
        width=args.width,
        height=args.height,
        num_inference_steps=args.steps,
        guidance_scale=0.0,
        generator=generator,
    ).images[0]

    args.output.parent.mkdir(parents=True, exist_ok=True)
    image.save(args.output)
    print(f"Saved image to {args.output.resolve()}")


if __name__ == "__main__":
    main()

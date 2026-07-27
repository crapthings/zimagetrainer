"""Minimal LoRA layers and the Z-Image Turbo training-adapter merge."""

from __future__ import annotations

from pathlib import Path

import torch
from huggingface_hub import hf_hub_download
from safetensors.torch import load_file, save_file

TARGET_SUFFIXES = (
    "attention.to_q", "attention.to_k", "attention.to_v", "attention.to_out.0",
    "feed_forward.w1", "feed_forward.w2", "feed_forward.w3", "adaLN_modulation.0",
)

class LoRALinear(torch.nn.Module):
    def __init__(self, base: torch.nn.Linear, rank: int, alpha: float):
        super().__init__()
        self.base, self.scale = base, alpha / rank
        self.down = torch.nn.Parameter(torch.empty(rank, base.in_features, dtype=torch.float32))
        self.up = torch.nn.Parameter(torch.zeros(base.out_features, rank, dtype=torch.float32))
        torch.nn.init.kaiming_uniform_(self.down, a=5**0.5)

    def forward(self, inputs: torch.Tensor) -> torch.Tensor:
        update = torch.nn.functional.linear(torch.nn.functional.linear(inputs.float(), self.down), self.up)
        return self.base(inputs) + (update * self.scale).to(inputs.dtype)

def _parent_and_name(module: torch.nn.Module, dotted_name: str) -> tuple[torch.nn.Module, str]:
    parent, parts = module, dotted_name.split(".")
    for part in parts[:-1]:
        parent = parent[int(part)] if part.isdigit() else getattr(parent, part)
    return parent, parts[-1]

def add_lora(transformer: torch.nn.Module, rank: int, alpha: float) -> list[str]:
    # The public Turbo training adapter targets the 30 main Transformer blocks
    # only (30 blocks × 8 projections = 240 modules). Matching that topology
    # keeps the exported LoRA compact and compatible with stock Turbo.
    names = [name for name, module in transformer.named_modules() if isinstance(module, torch.nn.Linear) and name.startswith("layers.") and name.endswith(TARGET_SUFFIXES)]
    for name in names:
        parent, attribute = _parent_and_name(transformer, name)
        original = parent[int(attribute)] if attribute.isdigit() else getattr(parent, attribute)
        replacement = LoRALinear(original, rank, alpha)
        if attribute.isdigit():
            parent[int(attribute)] = replacement
        else:
            setattr(parent, attribute, replacement)
    return names

def lora_state_dict(transformer: torch.nn.Module) -> dict[str, torch.Tensor]:
    return {f"{name}.{parameter}": getattr(module, parameter).detach().cpu() for name, module in transformer.named_modules() if isinstance(module, LoRALinear) for parameter in ("down", "up")}

def load_user_lora(transformer: torch.nn.Module, path: str | Path, rank: int, alpha: float) -> None:
    add_lora(transformer, rank, alpha)
    weights = load_file(str(path))
    for name, module in transformer.named_modules():
        if isinstance(module, LoRALinear):
            module.down.data.copy_(weights[f"{name}.down"])
            module.up.data.copy_(weights[f"{name}.up"])

def save_user_lora(transformer: torch.nn.Module, path: str | Path, metadata: dict[str, str]) -> None:
    save_file(lora_state_dict(transformer), str(path), metadata=metadata)

def merge_training_adapter(transformer: torch.nn.Module, adapter_ref: str) -> None:
    """Merge the adapter into the base only during training; it is not saved."""
    if Path(adapter_ref).exists():
        adapter_path = adapter_ref
    else:
        repo_id, filename = adapter_ref.rsplit("/", 1)
        adapter_path = hf_hub_download(repo_id, filename)
    weights, modules, merged = load_file(adapter_path), dict(transformer.named_modules()), 0
    for key, down in weights.items():
        if not key.endswith(".lora_A.weight"):
            continue
        name = key.removeprefix("diffusion_model.").removesuffix(".lora_A.weight")
        module = modules.get(name)
        if not isinstance(module, torch.nn.Linear):
            raise KeyError(f"Training adapter refers to missing linear layer: {name}")
        up = weights[key.replace(".lora_A.weight", ".lora_B.weight")]
        module.weight.data.add_((up.float() @ down.float()).to(module.weight.dtype))
        merged += 1
    if not merged:
        raise ValueError("No LoRA weights found in training adapter")

"""Small, explicit configuration loader for the trainer."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

DEFAULTS: dict[str, Any] = {
    "model": {"id": "Tongyi-MAI/Z-Image-Turbo", "training_adapter": "ostris/zimage_turbo_training_adapter/zimage_turbo_training_adapter_v2.safetensors"},
    "data": {"folder": "data/train", "resolution": 1024, "caption_extension": ".txt", "aspect_ratio_bucketing": True},
    "lora": {"rank": 16, "alpha": 16},
    "train": {"output_dir": "outputs/lora", "steps": 1000, "batch_size": 1, "gradient_accumulation": 1, "learning_rate": 1.0e-4, "save_every": 250, "keep_last": 3, "seed": 42, "log_every": 1, "gradient_checkpointing": True, "offload_aux_models": True},
    "sample": {"enabled": False, "prompt": "", "prompts": [], "every": 250, "width": 1024, "height": 1024, "seed": 42},
}

def _merge(base: dict[str, Any], overrides: dict[str, Any]) -> dict[str, Any]:
    result = base.copy()
    for key, value in overrides.items():
        result[key] = _merge(result[key], value) if isinstance(value, dict) and isinstance(result.get(key), dict) else value
    return result

def validation_prompts(sample: dict[str, Any]) -> list[str]:
    prompts = sample.get("prompts")
    if isinstance(prompts, list):
        cleaned = [str(prompt).strip() for prompt in prompts if str(prompt).strip()]
        if cleaned:
            return cleaned
    legacy_prompt = str(sample.get("prompt", "")).strip()
    return [legacy_prompt] if legacy_prompt else []

def load_config(path: str | Path) -> dict[str, Any]:
    with Path(path).open("r", encoding="utf-8") as file:
        config = _merge(DEFAULTS, yaml.safe_load(file) or {})
    if config["lora"]["rank"] <= 0:
        raise ValueError("lora.rank must be positive")
    if config["data"]["resolution"] % 16:
        raise ValueError("data.resolution must be divisible by 16")
    if config["train"]["batch_size"] <= 0 or config["train"]["steps"] <= 0:
        raise ValueError("train.batch_size and train.steps must be positive")
    if config["train"]["save_every"] <= 0 or config["train"]["keep_last"] <= 0:
        raise ValueError("train.save_every and train.keep_last must be positive")
    if config["data"].get("aspect_ratio_bucketing", True) and config["train"]["batch_size"] != 1:
        raise ValueError("aspect-ratio bucketing currently requires train.batch_size: 1")
    if config["sample"]["enabled"] and not validation_prompts(config["sample"]):
        raise ValueError("sample.prompts or sample.prompt is required when sampling is enabled")
    if config["sample"]["every"] <= 0:
        raise ValueError("sample.every must be positive")
    if config["sample"]["width"] <= 0 or config["sample"]["height"] <= 0:
        raise ValueError("sample.width and sample.height must be positive")
    if config["sample"]["width"] % 16 or config["sample"]["height"] % 16:
        raise ValueError("sample.width and sample.height must be divisible by 16")
    return config

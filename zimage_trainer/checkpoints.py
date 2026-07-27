"""Checkpoint paths and retention for exported LoRA weights."""

from __future__ import annotations

import re
from pathlib import Path

CHECKPOINT_PATTERN = re.compile(r"^zimage_lora_step_(\d+)\.safetensors$")


def checkpoint_path(output_dir: Path, step: int) -> Path:
    return output_dir / f"zimage_lora_step_{step}.safetensors"


def checkpoint_step(path: Path) -> int | None:
    match = CHECKPOINT_PATTERN.fullmatch(path.name)
    return int(match.group(1)) if match else None


def prune_checkpoints(output_dir: Path, keep_last: int) -> list[Path]:
    """Delete older exported LoRAs, retaining the newest `keep_last` by step."""
    if keep_last <= 0:
        raise ValueError("keep_last must be positive")

    checkpoints = sorted(
        (
            (step, path)
            for path in output_dir.glob("zimage_lora_step_*.safetensors")
            if (step := checkpoint_step(path)) is not None
        ),
        key=lambda item: item[0],
    )
    removed = [path for _, path in checkpoints[:-keep_last]]
    for path in removed:
        path.unlink(missing_ok=True)
    return removed

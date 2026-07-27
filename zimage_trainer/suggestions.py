"""Dataset-aware defaults derived from the trainer's actual sampling loop."""

from __future__ import annotations

import math
from typing import Any


def _round_up(value: float, interval: int) -> int:
    return int(math.ceil(value / interval) * interval)


def training_plans(image_count: int, median_short_side: int) -> dict[str, Any]:
    """Return explainable starting points, not promises of final quality.

    The trainer cycles a shuffled DataLoader and consumes one batch per step.
    With the UI defaults (batch size 1, accumulation 1), steps / image_count is
    therefore the approximate number of times each image is presented.
    """
    count = max(1, image_count)
    if count <= 10:
        target_exposures = 120
    elif count <= 25:
        target_exposures = 80
    elif count <= 50:
        target_exposures = 60
    elif count <= 100:
        target_exposures = 40
    else:
        target_exposures = 25

    recommended_steps = max(400, min(6000, _round_up(count * target_exposures, 100)))
    quick_steps = max(50, min(200, _round_up(count * 2, 10)))
    resolution = 512 if median_short_side < 640 else 768

    def plan(rank: int, steps: int) -> dict[str, Any]:
        return {
            "resolution": resolution,
            "rank": rank,
            "steps": steps,
            "batch_size": 1,
            "gradient_accumulation": 1,
            "exposures_per_image": round(steps / count, 1),
        }

    return {
        "recommended": plan(rank=16, steps=recommended_steps),
        "quick": plan(rank=8, steps=quick_steps),
    }

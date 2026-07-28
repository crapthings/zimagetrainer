"""Fast, explainable dataset checks used before a training run."""

from __future__ import annotations

import math
from collections import defaultdict
from pathlib import Path
from typing import Any

from PIL import Image

from .data import ASPECT_RATIOS


def _difference_hash(image: Image.Image) -> int:
    """Return a small perceptual hash for spotting near-identical images."""
    grayscale = image.convert("L").resize((9, 8), Image.Resampling.LANCZOS)
    pixels = list(grayscale.get_flattened_data())
    return sum(
        (1 << (row * 8 + column))
        for row in range(8)
        for column in range(8)
        if pixels[row * 9 + column] > pixels[row * 9 + column + 1]
    )


def _crop_loss(width: int, height: int, resolution: int) -> tuple[float, int, int]:
    ratio = width / height
    bucket = min(ASPECT_RATIOS, key=lambda candidate: abs(math.log(ratio / candidate)))
    target_width = max(16, round(math.sqrt(resolution**2 * bucket) / 16) * 16)
    target_height = max(16, round(math.sqrt(resolution**2 / bucket) / 16) * 16)
    target_ratio = target_width / target_height
    retained = target_ratio / ratio if ratio > target_ratio else ratio / target_ratio
    return max(0, 1 - retained), target_width, target_height


def _caption_key(caption: str) -> str:
    return " ".join(caption.casefold().split())


def audit_dataset_images(
    images: list[dict[str, Any]], root: Path, resolution: int
) -> dict[str, Any]:
    """Inspect local image/caption data without modifying it.

    The result intentionally reports concrete evidence rather than a synthetic
    quality score: creators can decide whether a warning matters for their set.
    """
    records: list[dict[str, Any]] = []
    unreadable: list[dict[str, str]] = []
    caption_groups: dict[str, list[str]] = defaultdict(list)

    for image in images:
        caption = image["caption"].strip()
        if caption:
            caption_groups[_caption_key(caption)].append(image["id"])
        try:
            with Image.open(root / image["path"]) as source:
                width, height = source.size
                image_hash = _difference_hash(source)
        except (OSError, ValueError):
            unreadable.append({"id": image["id"], "path": image["path"]})
            continue
        crop_loss, target_width, target_height = _crop_loss(width, height, resolution)
        records.append(
            {
                "id": image["id"],
                "path": image["path"],
                "width": width,
                "height": height,
                "short_side": min(width, height),
                "crop_loss": round(crop_loss * 100, 1),
                "target_width": target_width,
                "target_height": target_height,
                "hash": image_hash,
            }
        )

    duplicate_pairs = []
    duplicate_ids: set[str] = set()
    for index, current in enumerate(records):
        for other in records[index + 1 :]:
            distance = (current["hash"] ^ other["hash"]).bit_count()
            # Keep this conservative: nearby shots of the same person or scene
            # are useful training variation, while a 0–1 bit difference is
            # usually an accidental duplicate or export.
            if distance <= 1:
                duplicate_pairs.append(
                    {
                        "image_ids": [current["id"], other["id"]],
                        "distance": distance,
                    }
                )
                duplicate_ids.update((current["id"], other["id"]))

    missing_caption_ids = {image["id"] for image in images if not image["caption"].strip()}
    short_caption_ids = {
        image["id"]
        for image in images
        if image["caption"].strip() and len(image["caption"].strip()) < 16
    }
    repeated_caption_groups = [
        ids for caption, ids in caption_groups.items() if caption and len(ids) > 1
    ]
    repeated_caption_ids = {image_id for group in repeated_caption_groups for image_id in group}
    small_image_ids = {record["id"] for record in records if record["short_side"] < resolution}
    crop_risk_ids = {record["id"] for record in records if record["crop_loss"] >= 12}
    attention_ids = (
        missing_caption_ids
        | short_caption_ids
        | repeated_caption_ids
        | small_image_ids
        | crop_risk_ids
        | duplicate_ids
        | {image["id"] for image in unreadable}
    )
    return {
        "resolution": resolution,
        "image_count": len(images),
        "ready": not missing_caption_ids and not unreadable,
        "attention_image_count": len(attention_ids),
        "missing_caption_ids": sorted(missing_caption_ids),
        "short_caption_ids": sorted(short_caption_ids),
        "small_image_ids": sorted(small_image_ids),
        "crop_risk_ids": sorted(crop_risk_ids),
        "duplicate_image_ids": sorted(duplicate_ids),
        "duplicate_pairs": duplicate_pairs,
        "repeated_caption_groups": repeated_caption_groups,
        "unreadable": unreadable,
    }

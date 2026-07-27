"""Captioned image-folder dataset; no database or opaque preprocessing."""

from __future__ import annotations

from pathlib import Path
import math

import numpy as np
import torch
from PIL import Image
from torch.utils.data import Dataset

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}
ASPECT_RATIOS = (1.0, 4 / 3, 3 / 4, 3 / 2, 2 / 3, 16 / 9, 9 / 16)

class CaptionedImageFolder(Dataset):
    def __init__(self, folder: str | Path, resolution: int, caption_extension: str = ".txt", aspect_ratio_bucketing: bool = True):
        self.folder, self.resolution, self.caption_extension = Path(folder), resolution, caption_extension
        self.aspect_ratio_bucketing = aspect_ratio_bucketing
        self.images = sorted(path for path in self.folder.rglob("*") if path.suffix.lower() in IMAGE_SUFFIXES)
        if not self.images:
            raise ValueError(f"No images found in {self.folder.resolve()}")

    def __len__(self) -> int:
        return len(self.images)

    def _target_size(self, image: Image.Image) -> tuple[int, int]:
        """Choose a 16-aligned bucket with approximately resolution² pixels."""
        if not self.aspect_ratio_bucketing:
            return self.resolution, self.resolution
        ratio = image.width / image.height
        bucket_ratio = min(ASPECT_RATIOS, key=lambda candidate: abs(math.log(ratio / candidate)))
        width = max(16, round(math.sqrt(self.resolution**2 * bucket_ratio) / 16) * 16)
        height = max(16, round(math.sqrt(self.resolution**2 / bucket_ratio) / 16) * 16)
        return width, height

    def __getitem__(self, index: int) -> dict[str, torch.Tensor | str]:
        image_path = self.images[index]
        caption_path = image_path.with_suffix(self.caption_extension)
        caption = caption_path.read_text(encoding="utf-8").strip() if caption_path.exists() else ""
        image = Image.open(image_path).convert("RGB")
        target_width, target_height = self._target_size(image)
        scale = max(target_width / image.width, target_height / image.height)
        resized = image.resize((round(image.width * scale), round(image.height * scale)), Image.Resampling.LANCZOS)
        left, top = (resized.width - target_width) // 2, (resized.height - target_height) // 2
        pixels = torch.from_numpy(np.asarray(resized.crop((left, top, left + target_width, top + target_height))).copy()).permute(2, 0, 1).float() / 127.5 - 1
        return {"pixels": pixels, "caption": caption}

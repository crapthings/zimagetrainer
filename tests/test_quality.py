from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase

from PIL import Image

from zimage_trainer.quality import audit_dataset_images


class DatasetQualityTests(TestCase):
    def test_reports_training_relevant_image_and_caption_issues(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            folder = root / "data"
            folder.mkdir()
            image = Image.new("RGB", (300, 1200), color="white")
            image.save(folder / "first.png")
            image.save(folder / "second.png")
            result = audit_dataset_images(
                [
                    {"id": "first", "path": "data/first.png", "caption": "same"},
                    {"id": "second", "path": "data/second.png", "caption": "same"},
                    {"id": "third", "path": "data/missing.png", "caption": ""},
                ],
                root,
                768,
            )

        self.assertFalse(result["ready"])
        self.assertEqual(result["missing_caption_ids"], ["third"])
        self.assertEqual(result["small_image_ids"], ["first", "second"])
        self.assertEqual(result["crop_risk_ids"], ["first", "second"])
        self.assertEqual(result["duplicate_image_ids"], ["first", "second"])
        self.assertEqual(result["repeated_caption_groups"], [["first", "second"]])
        self.assertEqual(result["unreadable"], [{"id": "third", "path": "data/missing.png"}])

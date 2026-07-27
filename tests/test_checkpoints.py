from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase

from zimage_trainer.checkpoints import checkpoint_path, checkpoint_step, prune_checkpoints


class CheckpointRetentionTests(TestCase):
    def test_checkpoint_step_only_accepts_exported_lora_names(self) -> None:
        self.assertEqual(checkpoint_step(Path("zimage_lora_step_250.safetensors")), 250)
        self.assertIsNone(checkpoint_step(Path(".validation_lora_step_250.safetensors")))
        self.assertIsNone(checkpoint_step(Path("zimage_lora_step_latest.safetensors")))

    def test_prune_keeps_latest_checkpoints_by_numeric_step(self) -> None:
        with TemporaryDirectory() as directory:
            output_dir = Path(directory)
            for step in (50, 1000, 250, 100):
                checkpoint_path(output_dir, step).write_bytes(b"checkpoint")
            unrelated = output_dir / "notes.txt"
            unrelated.write_text("keep me", encoding="utf-8")

            removed = prune_checkpoints(output_dir, keep_last=2)

            self.assertEqual(
                {path.name for path in removed},
                {
                    "zimage_lora_step_50.safetensors",
                    "zimage_lora_step_100.safetensors",
                },
            )
            self.assertTrue(checkpoint_path(output_dir, 250).exists())
            self.assertTrue(checkpoint_path(output_dir, 1000).exists())
            self.assertTrue(unrelated.exists())

    def test_prune_rejects_non_positive_retention(self) -> None:
        with TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, "keep_last must be positive"):
                prune_checkpoints(Path(directory), keep_last=0)

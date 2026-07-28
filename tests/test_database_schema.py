from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase

from zimage_trainer.database import Database


class DatabaseSchemaTests(TestCase):
    def test_fresh_database_uses_only_current_schema(self):
        with TemporaryDirectory() as directory:
            database = Database(Path(directory) / "state.db")
            try:
                dataset_columns = {
                    row[1]
                    for row in database.connection.execute(
                        "PRAGMA table_info(datasets)"
                    )
                }
                tables = {
                    row[0]
                    for row in database.connection.execute(
                        "SELECT name FROM sqlite_master WHERE type = 'table'"
                    )
                }
                self.assertIn("system_prompt", dataset_columns)
                self.assertIn("caption_model", dataset_columns)
                self.assertIn("generations", tables)
                self.assertNotIn("dataset_images", tables)
            finally:
                database.connection.close()

    def test_generation_history_uses_stable_newest_first_ordering(self):
        with TemporaryDirectory() as directory:
            database = Database(Path(directory) / "state.db")
            try:
                for generation_id in ("first", "second"):
                    database.create_generation(
                        {
                            "id": generation_id,
                            "path": f"outputs/playground/{generation_id}.png",
                            "prompt": "test",
                            "width": 1024,
                            "height": 1024,
                            "seed": 42,
                            "steps": 9,
                            "lora_path": None,
                        }
                    )
                history = database.generations()
                self.assertEqual([item["id"] for item in history], ["second", "first"])
                self.assertTrue(history[0]["created_at"])
            finally:
                database.connection.close()

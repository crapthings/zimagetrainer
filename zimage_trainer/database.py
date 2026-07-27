"""Small SQLite persistence layer for the local trainer console."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from threading import Lock
from typing import Any


class Database:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(path, check_same_thread=False)
        self.connection.row_factory = sqlite3.Row
        self.lock = Lock()
        with self.connection:
            self.connection.executescript("""
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS jobs (
                    id TEXT PRIMARY KEY,
                    status TEXT NOT NULL,
                    config_json TEXT NOT NULL,
                    config_path TEXT NOT NULL,
                    pid INTEGER,
                    returncode INTEGER,
                    error TEXT,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                CREATE TABLE IF NOT EXISTS events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    job_id TEXT,
                    event_json TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(job_id) REFERENCES jobs(id)
                );
                CREATE TABLE IF NOT EXISTS datasets (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    folder TEXT NOT NULL UNIQUE,
                    system_prompt TEXT NOT NULL DEFAULT '',
                    caption_model TEXT NOT NULL DEFAULT 'gemini-3.5-flash-lite',
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                CREATE TABLE IF NOT EXISTS images (
                    id TEXT PRIMARY KEY,
                    dataset_id TEXT NOT NULL,
                    path TEXT NOT NULL UNIQUE,
                    caption TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(dataset_id) REFERENCES datasets(id)
                );
            """)

    def create_job(self, job_id: str, config: dict[str, Any], config_path: str) -> None:
        with self.lock, self.connection:
            self.connection.execute("INSERT INTO jobs (id, status, config_json, config_path) VALUES (?, 'queued', ?, ?)", (job_id, json.dumps(config), config_path))

    def update_job(self, job_id: str, **fields: Any) -> None:
        if not fields:
            return
        keys, values = zip(*fields.items())
        statement = ", ".join(f"{key} = ?" for key in keys) + ", updated_at = CURRENT_TIMESTAMP"
        with self.lock, self.connection:
            self.connection.execute(f"UPDATE jobs SET {statement} WHERE id = ?", (*values, job_id))

    def jobs(self) -> dict[str, dict[str, Any]]:
        with self.lock:
            rows = self.connection.execute("SELECT * FROM jobs ORDER BY created_at DESC").fetchall()
        return {row["id"]: {"status": row["status"], "pid": row["pid"], "returncode": row["returncode"], "error": row["error"], "config": row["config_path"], "created_at": row["created_at"]} for row in rows}

    def queued_jobs(self) -> list[dict[str, Any]]:
        with self.lock:
            rows = self.connection.execute("SELECT id, config_path FROM jobs WHERE status = 'queued' ORDER BY created_at ASC").fetchall()
        return [dict(row) for row in rows]

    def interrupt_stale_jobs(self) -> int:
        """Close jobs whose owning API process no longer exists after restart."""
        message = "Training was interrupted because the API process stopped or restarted. Queue a new run to continue."
        with self.lock, self.connection:
            cursor = self.connection.execute(
                "UPDATE jobs SET status = 'failed', returncode = -1, error = ?, updated_at = CURRENT_TIMESTAMP WHERE status = 'running'",
                (message,),
            )
        return cursor.rowcount

    def job_monitor(self, job_id: str) -> dict[str, Any] | None:
        with self.lock:
            job = self.connection.execute("SELECT id, status, config_json, error FROM jobs WHERE id = ?", (job_id,)).fetchone()
            rows = self.connection.execute("SELECT event_json, created_at FROM events WHERE job_id = ? ORDER BY id ASC", (job_id,)).fetchall()
        if not job:
            return None
        losses, samples, logs, timeline, stage = [], [], [], [], None
        for row in rows:
            try:
                event = json.loads(row["event_json"])
            except json.JSONDecodeError:
                continue
            if event.get("type") == "training" and "step" in event and "loss" in event:
                losses.append({"step": event["step"], "loss": event["loss"]})
            if event.get("type") == "sample" and event.get("path"):
                samples.append(event["path"])
            if event.get("type") == "log" and event.get("line"):
                logs.append(event["line"])
            if event.get("type") == "stage" and event.get("stage"):
                stage = event["stage"]
            if event.get("type") in {"stage", "checkpoint", "sample"}:
                timeline.append({**event, "created_at": row["created_at"]})
            if event.get("type") == "training" and event.get("status") in {"queued", "running", "completed", "failed"} and "step" not in event:
                timeline.append({**event, "created_at": row["created_at"]})
        config = json.loads(job["config_json"])
        return {
            "id": job["id"],
            "status": job["status"],
            "error": job["error"],
            "total": config.get("train", {}).get("steps", 0),
            "losses": losses[-10000:],
            "samples": samples,
            "logs": logs[-500:],
            "stage": stage,
            "timeline": timeline[-100:],
        }

    def add_event(self, event: dict[str, Any]) -> None:
        with self.lock, self.connection:
            self.connection.execute("INSERT INTO events (job_id, event_json) VALUES (?, ?)", (event.get("jobId"), json.dumps(event)))

    def create_dataset(self, dataset_id: str, name: str, folder: str) -> dict[str, Any]:
        with self.lock, self.connection:
            self.connection.execute("INSERT INTO datasets (id, name, folder, caption_model) VALUES (?, ?, ?, ?)", (dataset_id, name, folder, "gemini-3.5-flash-lite"))
        return self.dataset(dataset_id)  # type: ignore[return-value]

    def datasets(self) -> list[dict[str, Any]]:
        with self.lock:
            rows = self.connection.execute("""SELECT d.*, COUNT(i.id) AS image_count, MIN(i.path) AS cover_path
                FROM datasets d LEFT JOIN images i ON i.dataset_id = d.id
                GROUP BY d.id ORDER BY d.created_at DESC""").fetchall()
        return [dict(row) for row in rows]

    def dataset(self, dataset_id: str) -> dict[str, Any] | None:
        with self.lock:
            row = self.connection.execute("""SELECT d.*, COUNT(i.id) AS image_count, MIN(i.path) AS cover_path
                FROM datasets d LEFT JOIN images i ON i.dataset_id = d.id WHERE d.id = ? GROUP BY d.id""", (dataset_id,)).fetchone()
        return dict(row) if row else None

    def dataset_for_folder(self, folder: str) -> dict[str, Any] | None:
        with self.lock:
            row = self.connection.execute("SELECT * FROM datasets WHERE folder = ?", (folder,)).fetchone()
        return dict(row) if row else None

    def images(self, dataset_id: str) -> list[dict[str, Any]]:
        with self.lock:
            rows = self.connection.execute("SELECT * FROM images WHERE dataset_id = ? ORDER BY created_at DESC", (dataset_id,)).fetchall()
        return [dict(row) for row in rows]

    def add_image(self, image_id: str, dataset_id: str, path: str) -> None:
        with self.lock, self.connection:
            self.connection.execute("INSERT INTO images (id, dataset_id, path) VALUES (?, ?, ?)", (image_id, dataset_id, path))

    def delete_dataset(self, dataset_id: str) -> None:
        with self.lock, self.connection:
            self.connection.execute("DELETE FROM images WHERE dataset_id = ?", (dataset_id,))
            self.connection.execute("DELETE FROM datasets WHERE id = ?", (dataset_id,))

    def delete_image(self, image_id: str) -> None:
        with self.lock, self.connection:
            self.connection.execute("DELETE FROM images WHERE id = ?", (image_id,))

    def update_dataset_prompt(self, dataset_id: str, system_prompt: str) -> None:
        with self.lock, self.connection:
            self.connection.execute("UPDATE datasets SET system_prompt = ? WHERE id = ?", (system_prompt, dataset_id))

    def update_dataset_caption_settings(self, dataset_id: str, system_prompt: str, caption_model: str) -> None:
        with self.lock, self.connection:
            self.connection.execute("UPDATE datasets SET system_prompt = ?, caption_model = ? WHERE id = ?", (system_prompt, caption_model, dataset_id))

    def update_image_caption(self, path: str, caption: str) -> None:
        with self.lock, self.connection:
            self.connection.execute("UPDATE images SET caption = ?, updated_at = CURRENT_TIMESTAMP WHERE path = ?", (caption, path))

    def image(self, image_id: str) -> dict[str, Any] | None:
        with self.lock:
            row = self.connection.execute("SELECT * FROM images WHERE id = ?", (image_id,)).fetchone()
        return dict(row) if row else None

    def update_image_caption_by_id(self, image_id: str, caption: str) -> dict[str, Any] | None:
        with self.lock, self.connection:
            self.connection.execute("UPDATE images SET caption = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", (caption, image_id))
        return self.image(image_id)

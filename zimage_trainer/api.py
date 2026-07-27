"""Local FastAPI control plane for captioning and Z-Image Turbo training."""

from __future__ import annotations

import asyncio
import json
import mimetypes
import os
import re
import shutil
import subprocess
import sys
import uuid
from statistics import median
from pathlib import Path
from typing import Any

import yaml
from fastapi import FastAPI, File, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from google import genai
from google.genai import types
from PIL import Image as PILImage
from pydantic import BaseModel, Field

from .data import IMAGE_SUFFIXES
from .database import Database
from .suggestions import training_plans

ROOT = Path(__file__).resolve().parents[1]
JOBS_DIR = ROOT / ".jobs"
JOBS_DIR.mkdir(exist_ok=True)
database = Database(ROOT / ".state" / "trainer.db")
DEFAULT_CAPTION_PROMPT = "Write one concise, factual image-training caption. Describe subject, visual style, setting, composition, lighting and meaningful details. Output only the caption."


class CaptionRequest(BaseModel):
    dataset_id: str | None = None
    folder: str = "data/train"
    api_key: str | None = None
    model: str | None = None
    overwrite: bool = False
    system_prompt: str | None = None
    concurrency: int = Field(default=4, ge=1, le=8)


class TrainRequest(BaseModel):
    config: dict[str, Any]


class DatasetCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class DatasetUpdateRequest(BaseModel):
    system_prompt: str = Field(max_length=4000)
    caption_model: str = "gemini-3.5-flash-lite"


class ImageUpdateRequest(BaseModel):
    caption: str = Field(max_length=8000)


class ImagesDeleteRequest(BaseModel):
    image_ids: list[str] = Field(min_length=1, max_length=1000)


class EventHub:
    def __init__(self) -> None:
        self.clients: set[WebSocket] = set()
        self.jobs: dict[str, dict[str, Any]] = {}

    async def publish(self, event: dict[str, Any]) -> None:
        database.add_event(event)
        stale = []
        for client in self.clients:
            try:
                await client.send_json(event)
            except Exception:
                stale.append(client)
        for client in stale:
            self.clients.discard(client)


hub = EventHub()
training_queue: asyncio.Queue[tuple[str, Path]] = asyncio.Queue()
training_worker: asyncio.Task | None = None
app = FastAPI(title="Z-Image Trainer API")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173"], allow_methods=["*"], allow_headers=["*"])
app.mount("/files", StaticFiles(directory=ROOT), name="files")


def resolve_folder(value: str) -> Path:
    path = (ROOT / value).resolve()
    if ROOT not in path.parents and path != ROOT:
        raise HTTPException(400, "Folder must be inside this project")
    if not path.is_dir():
        raise HTTPException(404, f"Folder not found: {value}")
    return path


def list_images(folder: Path) -> list[dict[str, Any]]:
    result = []
    for path in sorted(p for p in folder.rglob("*") if p.suffix.lower() in IMAGE_SUFFIXES):
        caption_path = path.with_suffix(".txt")
        result.append({"path": path.relative_to(ROOT).as_posix(), "caption": caption_path.read_text(encoding="utf-8").strip() if caption_path.exists() else ""})
    return result


@app.get("/api/dataset")
async def dataset(folder: str = "data/train") -> dict[str, Any]:
    path = resolve_folder(folder)
    relative_folder = path.relative_to(ROOT).as_posix()
    images = list_images(path)
    database.sync_images(relative_folder, images)
    return {"folder": relative_folder, "images": images}


@app.get("/api/datasets")
async def datasets() -> dict[str, Any]:
    return {"datasets": database.datasets()}


@app.post("/api/datasets")
async def create_dataset(request: DatasetCreateRequest) -> dict[str, Any]:
    dataset_id = uuid.uuid4().hex[:10]
    folder = f"data/datasets/{dataset_id}"
    (ROOT / folder).mkdir(parents=True, exist_ok=False)
    database.create_dataset(dataset_id, request.name.strip(), folder)
    database.update_dataset_prompt(dataset_id, DEFAULT_CAPTION_PROMPT)
    return get_dataset_or_404(dataset_id)


def get_dataset_or_404(dataset_id: str) -> dict[str, Any]:
    dataset = database.dataset(dataset_id)
    if not dataset:
        raise HTTPException(404, "Dataset not found")
    return dataset


@app.get("/api/datasets/{dataset_id}/training-suggestion")
async def training_suggestion(dataset_id: str) -> dict[str, Any]:
    dataset = get_dataset_or_404(dataset_id)
    images = database.images(dataset_id)
    dimensions = []
    for image in images:
        try:
            with PILImage.open(ROOT / image["path"]) as file:
                dimensions.append(file.size)
        except OSError:
            continue
    count = len(images)
    captioned = sum(bool(image["caption"].strip()) for image in images)
    median_short_side = int(median([min(width, height) for width, height in dimensions])) if dimensions else 1024
    plans = training_plans(count, median_short_side)
    captions = [image["caption"].strip() for image in images if image["caption"].strip()]
    # Pick the caption whose vocabulary overlaps most with the others. It makes
    # a representative validation prompt without using extra API quota.
    words = [set(re.findall(r"[a-zA-Z0-9][a-zA-Z0-9'-]*", caption.lower())) for caption in captions]
    if captions:
        scores = [sum(len(current & other) / max(1, len(current | other)) for other in words) for current in words]
        sample_prompt = captions[scores.index(max(scores))]
    else:
        sample_prompt = "A high quality representative image from this training dataset"
    return {"dataset_id": dataset["id"], "image_count": count, "captioned_count": captioned, "caption_coverage": round(captioned / count, 3) if count else 0, "median_short_side": median_short_side, **plans, "sample_prompt": sample_prompt, "sample_prompt_reason": "Chosen from the caption most representative of this dataset." if captions else "Add captions to generate a dataset-specific test prompt.", "reason": f"{count} images, {captioned}/{count} captioned, median short side {median_short_side}px."}


@app.get("/api/datasets/{dataset_id}")
async def get_dataset(dataset_id: str) -> dict[str, Any]:
    dataset = get_dataset_or_404(dataset_id)
    return {"dataset": dataset, "images": database.images(dataset_id)}


@app.patch("/api/datasets/{dataset_id}")
async def update_dataset(dataset_id: str, request: DatasetUpdateRequest) -> dict[str, Any]:
    get_dataset_or_404(dataset_id)
    database.update_dataset_caption_settings(dataset_id, request.system_prompt.strip(), request.caption_model)
    return {"dataset": get_dataset_or_404(dataset_id)}


@app.delete("/api/datasets/{dataset_id}")
async def delete_dataset(dataset_id: str) -> dict[str, str]:
    dataset = get_dataset_or_404(dataset_id)
    folder = (ROOT / dataset["folder"]).resolve()
    datasets_root = (ROOT / "data" / "datasets").resolve()
    if datasets_root not in folder.parents:
        raise HTTPException(400, "Invalid dataset folder")
    shutil.rmtree(folder)
    database.delete_dataset(dataset_id)
    return {"status": "deleted"}


@app.post("/api/datasets/{dataset_id}/upload")
async def upload_images(dataset_id: str, files: list[UploadFile] = File(...)) -> dict[str, Any]:
    dataset = get_dataset_or_404(dataset_id)
    destination = ROOT / dataset["folder"]
    uploaded = []
    for file in files:
        suffix = Path(file.filename or "").suffix.lower()
        if suffix not in IMAGE_SUFFIXES:
            raise HTTPException(400, "Unsupported image type")
        # Never retain the user-provided filename; a UUID prevents collisions and
        # avoids leaking source filenames into the dataset directory.
        target = destination / f"{uuid.uuid4().hex}{suffix}"
        target.write_bytes(await file.read())
        relative_path = target.relative_to(ROOT).as_posix()
        database.add_image(uuid.uuid4().hex, dataset_id, relative_path)
        uploaded.append(relative_path)
    return {"uploaded": uploaded}


@app.patch("/api/images/{image_id}")
async def update_image(image_id: str, request: ImageUpdateRequest) -> dict[str, Any]:
    image = database.image(image_id)
    if not image:
        raise HTTPException(404, "Image not found")
    path = ROOT / image["path"]
    path.with_suffix(".txt").write_text(request.caption.strip() + "\n", encoding="utf-8")
    updated = database.update_image_caption_by_id(image_id, request.caption.strip())
    return {"image": updated}


@app.delete("/api/images/{image_id}")
async def delete_image(image_id: str) -> dict[str, str]:
    image = database.image(image_id)
    if not image:
        raise HTTPException(404, "Image not found")
    path = (ROOT / image["path"]).resolve()
    datasets_root = (ROOT / "data" / "datasets").resolve()
    if datasets_root not in path.parents:
        raise HTTPException(400, "Invalid image path")
    path.unlink(missing_ok=True)
    path.with_suffix(".txt").unlink(missing_ok=True)
    database.delete_image(image_id)
    return {"status": "deleted"}


@app.post("/api/datasets/{dataset_id}/delete-images")
async def delete_images(dataset_id: str, request: ImagesDeleteRequest) -> dict[str, int]:
    get_dataset_or_404(dataset_id)
    deleted = 0
    for image_id in request.image_ids:
        image = database.image(image_id)
        if not image or image["dataset_id"] != dataset_id:
            continue
        path = (ROOT / image["path"]).resolve()
        datasets_root = (ROOT / "data" / "datasets").resolve()
        if datasets_root not in path.parents:
            raise HTTPException(400, "Invalid image path")
        path.unlink(missing_ok=True)
        path.with_suffix(".txt").unlink(missing_ok=True)
        database.delete_image(image_id)
        deleted += 1
    return {"deleted": deleted}


def caption_image(path: Path, api_key: str | None, model: str, system_prompt: str) -> str:
    key = api_key or os.getenv("GEMINI_API_KEY")
    if not key:
        raise ValueError("Set GEMINI_API_KEY or enter an API key in the UI")
    mime = mimetypes.guess_type(path.name)[0] or "image/png"
    client = genai.Client(api_key=key)
    response = client.models.generate_content(
        model=model,
        contents=[
            system_prompt,
            types.Part.from_bytes(data=path.read_bytes(), mime_type=mime),
        ],
    )
    if not response.text:
        raise ValueError("Gemini returned no caption")
    return response.text.strip()


@app.post("/api/caption")
async def caption(request: CaptionRequest) -> dict[str, Any]:
    if request.dataset_id:
        dataset = get_dataset_or_404(request.dataset_id)
        folder = ROOT / dataset["folder"]
        images = [{"path": image["path"], "caption": image["caption"]} for image in database.images(request.dataset_id)]
        system_prompt = request.system_prompt or dataset.get("system_prompt") or DEFAULT_CAPTION_PROMPT
        model = request.model or dataset.get("caption_model") or "gemini-3.5-flash-lite"
    else:
        folder = resolve_folder(request.folder)
        images = list_images(folder)
        system_prompt = request.system_prompt or DEFAULT_CAPTION_PROMPT
        model = request.model
    candidates = [item for item in images if request.overwrite or not (ROOT / item["path"]).with_suffix(".txt").exists()]
    await hub.publish({"type": "caption", "status": "started", "total": len(candidates), "concurrency": request.concurrency})
    semaphore = asyncio.Semaphore(request.concurrency)
    async def caption_one(item: dict[str, Any]) -> tuple[dict[str, Any], str | None, str | None]:
        try:
            async with semaphore:
                text = await asyncio.to_thread(caption_image, ROOT / item["path"], request.api_key, model, system_prompt)
            return item, text, None
        except Exception as exc:
            return item, None, str(exc)
    updated, errors, completed = 0, [], 0
    for task in asyncio.as_completed([caption_one(item) for item in candidates]):
        item, text, error = await task
        completed += 1
        if error:
            errors.append({"path": item["path"], "error": error})
            await hub.publish({"type": "caption", "status": "error", "current": completed, "total": len(candidates), "path": item["path"], "error": error})
            continue
        assert text is not None
        (ROOT / item["path"]).with_suffix(".txt").write_text(text + "\n", encoding="utf-8")
        if request.dataset_id:
            database.update_image_caption(item["path"], text)
        updated += 1
        await hub.publish({"type": "caption", "status": "progress", "current": completed, "total": len(candidates), "path": item["path"], "caption": text})
    await hub.publish({"type": "caption", "status": "finished", "updated": updated, "errors": errors})
    return {"updated": updated, "errors": errors}


async def run_training(job_id: str, config_path: Path) -> None:
    command = [sys.executable, "train.py", str(config_path.relative_to(ROOT))]
    # Windows may run FastAPI on a Selector event loop, where asyncio's
    # subprocess APIs raise NotImplementedError. Standard Popen works on both
    # Windows and Unix; readline/wait are bridged without blocking the server.
    process = subprocess.Popen(
        command,
        cwd=ROOT,
        env={**os.environ, "PYTHONIOENCODING": "utf-8", "PYTHONUNBUFFERED": "1"},
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
    )
    hub.jobs.setdefault(job_id, {"status": "queued", "config": str(config_path.relative_to(ROOT))})
    hub.jobs[job_id].update(status="running", pid=process.pid)
    database.update_job(job_id, status="running", pid=process.pid)
    await hub.publish({"type": "training", "jobId": job_id, "status": "running", "pid": process.pid})
    assert process.stdout
    last_line = ""
    while True:
        raw = await asyncio.to_thread(process.stdout.readline)
        if raw == "":
            break
        line = raw.strip()
        if not line:
            continue
        last_line = line
        # Keep every subprocess line as a log. Training and sample events are
        # emitted separately so a preview image can never make logs disappear.
        await hub.publish({"type": "log", "jobId": job_id, "line": line})
        match = re.search(r"step (\d+)/(\d+)\s+loss=([\d.]+)", line)
        if match:
            await hub.publish({"type": "training", "jobId": job_id, "step": int(match[1]), "total": int(match[2]), "loss": float(match[3]), "status": "running"})
        stage = re.search(r"STAGE (.+)", line)
        if stage:
            await hub.publish({"type": "stage", "jobId": job_id, "stage": stage[1]})
        if re.search(r"SAMPLE starting", line):
            await hub.publish({"type": "sample", "jobId": job_id, "status": "starting"})
        sample = re.search(r"SAMPLE saved (.+)", line)
        if sample:
            await hub.publish({"type": "sample", "jobId": job_id, "status": "saved", "path": sample[1].replace("\\", "/")})
    code = await asyncio.to_thread(process.wait)
    status = "completed" if code == 0 else "failed"
    hub.jobs[job_id].update(status=status, returncode=code)
    error = None if code == 0 else (last_line or f"Training process exited with code {code}")
    database.update_job(job_id, status=status, returncode=code, error=error)
    await hub.publish({"type": "training", "jobId": job_id, "status": status, "returncode": code, "error": error})


async def training_queue_worker() -> None:
    while True:
        job_id, config_path = await training_queue.get()
        try:
            await run_training(job_id, config_path)
        except Exception as exc:
            error = f"{type(exc).__name__}: {exc}"
            hub.jobs.setdefault(job_id, {}).update(status="failed", error=error)
            database.update_job(job_id, status="failed", returncode=-1, error=error)
            await hub.publish({"type": "training", "jobId": job_id, "status": "failed", "error": error})
        finally:
            training_queue.task_done()


@app.on_event("startup")
async def start_worker() -> None:
    global training_worker
    database.interrupt_stale_jobs()
    training_worker = asyncio.create_task(training_queue_worker())
    # A dev-server reload clears in-memory queues; restore persisted jobs.
    for job in database.queued_jobs():
        await training_queue.put((job["id"], ROOT / job["config_path"]))


@app.on_event("shutdown")
async def stop_worker() -> None:
    if training_worker:
        training_worker.cancel()


@app.get("/api/jobs")
async def jobs() -> dict[str, Any]:
    return {"jobs": database.jobs()}


@app.get("/api/jobs/{job_id}/monitor")
async def job_monitor(job_id: str) -> dict[str, Any]:
    monitor = database.job_monitor(job_id)
    if not monitor:
        raise HTTPException(404, "Job not found")
    return monitor


@app.post("/api/train")
async def start_training(request: TrainRequest) -> dict[str, str]:
    job_id = uuid.uuid4().hex[:8]
    config = json.loads(json.dumps(request.config))
    folder = config.get("data", {}).get("folder")
    dataset = database.dataset_for_folder(folder) if isinstance(folder, str) else None
    if dataset:
        train = config.setdefault("train", {})
        if not isinstance(train, dict):
            raise HTTPException(422, "Training configuration must contain a train object")
        train["output_dir"] = f"outputs/{dataset['id']}/{job_id}_lora"
    config_path = JOBS_DIR / f"{job_id}.yaml"
    config_path.write_text(yaml.safe_dump(config, sort_keys=False), encoding="utf-8")
    hub.jobs[job_id] = {"status": "queued", "config": str(config_path.relative_to(ROOT))}
    database.create_job(job_id, config, str(config_path.relative_to(ROOT)))
    await training_queue.put((job_id, config_path))
    return {"job_id": job_id}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    await websocket.accept()
    hub.clients.add(websocket)
    await websocket.send_json({"type": "snapshot", "jobs": database.jobs()})
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        hub.clients.discard(websocket)

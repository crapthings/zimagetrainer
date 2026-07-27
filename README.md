# Z-Image Turbo LoRA Trainer

A focused local trainer for `Tongyi-MAI/Z-Image-Turbo`, with a CLI and local
web dashboard. Give it a captioned image folder and it produces one portable
LoRA file.

Images use aspect-ratio buckets by default: the trainer selects the nearest
square, 4:3, 3:4, 3:2, 2:3, 16:9, or 9:16 bucket at approximately the chosen
pixel area. This preserves horizontal and vertical compositions better than
forcing every image into a square. Bucketing currently requires `batch_size: 1`.

## Why the training adapter exists

Z-Image Turbo is a distilled inference model. Before adding the user LoRA, the
trainer merges Ostris's public Turbo training adapter into the Transformer. The
adapter is never included in the output. Thus the exported LoRA is applied to
the original `Tongyi-MAI/Z-Image-Turbo` at inference time.

## Windows quick start

The Windows setup is intentionally split into two double-click steps:

1. Download or clone this repository, then double-click
   [install.bat](install.bat). It installs `uv` and Node.js LTS if they are
   missing, then installs the Python, launcher, and web dependencies. Keep the
   window open until it reports that installation is complete. The first run
   can take several minutes and requires an internet connection.
2. For everyday use, double-click [start-dev.bat](start-dev.bat), then open
   http://localhost:5173 in your browser. Leave its terminal window open while
   using the app; press `Ctrl+C` there to stop it.

The installer needs Windows 10/11 with `winget` (included with current
versions of Windows). Training requires a compatible NVIDIA GPU and CUDA
driver; starting the local UI itself does not download the base model.

## Train

1. Put images in `data/train/`. For an image named `subject_01.jpg`, optionally
   create `subject_01.txt` containing its caption.
2. Copy `config/train.example.yaml` and adjust the dataset path and run length.
3. Run:

```powershell
uv run python train.py config/train.example.yaml
```

The first training run downloads the base model and the training adapter. The
LoRA checkpoints are stored under `train.output_dir`.
Use `train.save_every` to control the checkpoint interval and
`train.keep_last` to retain only the newest exported LoRA files. The final
checkpoint is always included in the retained set.

Validation previews support multiple prompts, each with its own resolution and
common aspect-ratio preset. Each prompt produces its own deterministic baseline
and checkpoint image, so one training run can be compared across several
subjects, styles, and output formats. Existing configurations that use
`sample.prompts` or a single `sample.prompt` remain supported.

## Use the exported LoRA

```powershell
uv run python infer.py --lora outputs/my_zimage_lora/zimage_lora_step_1000.safetensors --prompt "your trigger, studio portrait"
```

Keep `--lora-rank` and `--lora-alpha` equal to the configuration used for
training. The starter configuration is rank 16, alpha 16.

## Web UI

The local UI is Vite + React + Tailwind CSS, with Zustand for browser state.
FastAPI starts the training subprocess and streams structured progress/log
events to the UI over a WebSocket.

Job history, submitted configurations, events, and dataset caption metadata are
stored locally in SQLite at `.state/trainer.db`. Images and LoRA weights remain
as normal files; the database intentionally does not copy large binary assets.

Start both services together from the project root:

```powershell
corepack pnpm dev
```

On Windows, run [install.bat](install.bat) once, then double-click
[start-dev.bat](start-dev.bat) whenever you want to use the app. It launches
the same development command in a terminal window; it does not build the
frontend. Vite hot-reloads UI changes, while Uvicorn reloads the FastAPI
server when Python files change.

The command uses `concurrently` to run FastAPI and Vite together. It binds to
all network interfaces, so other devices on the same trusted LAN can open:

```text
http://<this-computer-LAN-IP>:5173
```

The FastAPI service itself is available on port `8000`. Create datasets from
the **Datasets** page, upload images into their real folders under
`data/datasets/<id>/`, generate captions, and start training from the dashboard.
The dataset list uses TanStack Query caching and TanStack Virtual rendering for
large collections.

For Gemini auto-captioning, set `GEMINI_API_KEY` before launching the API, or
enter a key in the UI. A UI-provided key is used only for that request and is
never written to a project file.

## Layout

```text
zimage_trainer/
  data.py       # image + sidecar caption input
  lora.py       # small LoRA implementation and adapter merge
  config.py     # YAML defaults and validation
  trainer.py    # Flow Matching training loop
config/train.example.yaml
train.py        # CLI
infer.py        # inference, including exported LoRAs
```

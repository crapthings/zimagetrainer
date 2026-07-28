# Z-Forge

> Train a personal **Z-Image Turbo LoRA** on your own computer — from a folder of images to a model you can test, without writing YAML or terminal commands.
>
> **Windows:** run `install.bat` once, then `start-dev.bat` whenever you create. **You need:** an NVIDIA GPU and a compatible CUDA driver.

Z-Forge is a local-first training studio for creators who want to teach
[`Tongyi-MAI/Z-Image-Turbo`](https://huggingface.co/Tongyi-MAI/Z-Image-Turbo)
a person, product, visual style, or character. Your images, captions, training
history, and exported LoRAs stay on your machine.

```text
Images → quality check → captions → train → compare checkpoints → Playground
```

## Start here

### Windows 10 / 11 — recommended

1. Download or clone this repository.
2. Double-click **`install.bat`** and wait for it to finish. This only happens once.
3. Double-click **`start-dev.bat`** whenever you want to use Z-Forge.
4. Open [http://localhost:5173](http://localhost:5173).

The installer sets up `uv`, Node.js, Python packages, and the web UI dependencies.
Keep the terminal window open while Z-Forge runs; press `Ctrl+C` to stop it.

### What you can do

| In Z-Forge | Why it matters |
| --- | --- |
| Build a dataset from local images | Keep project files and source images under your control. |
| Check data quality before training | Catch missing captions, small images, crop risk, unreadable files, and accidental duplicates. |
| Generate or edit captions | Use Gemini, or write every caption yourself. |
| Train with safe recommendations | Start from a plan based on your dataset size, then adjust resolution, rank, steps, and checkpoints. |
| Compare validation images | Use fixed prompts and seeds to choose the checkpoint that actually looks best. |
| Test in Playground | Load an exported LoRA and generate Z-Image Turbo images without leaving the app. |

## A typical first LoRA

1. Create a dataset and upload a focused set of images.
2. Open **Data check** and resolve any missing captions or unreadable files.
3. Generate captions with Gemini, then review or edit them.
4. Use the recommended training plan, and add one or more validation prompts.
5. Start training. Z-Forge saves checkpoints and validation images as it runs.
6. In **Training**, compare validation images across checkpoints.
7. Open the preferred checkpoint in **Playground** to test it with real prompts.

The short **Test run** only confirms that your setup, GPU, and output work. It
is not meant to produce your final LoRA.

## Requirements and platforms

| Platform | Status |
| --- | --- |
| Windows 10 / 11 | Supported with one-click install and start scripts |
| Linux | Supported with manual setup |
| macOS | The UI may run, but NVIDIA CUDA training is not supported |

Training requires an NVIDIA GPU and a compatible CUDA driver. Z-Forge uses the
CUDA 13.0 PyTorch packages defined in `pyproject.toml`. The first training run
also downloads the base model and its public training adapter.

## Linux setup

Install [uv](https://docs.astral.sh/uv/) and Node.js 22, then run:

```bash
corepack enable
uv sync --frozen
corepack pnpm install --frozen-lockfile
corepack pnpm --dir web install --frozen-lockfile
corepack pnpm dev
```

Open [http://localhost:5173](http://localhost:5173), then stop the services
with `Ctrl+C`.

## How training behaves

- Images are automatically placed into common aspect-ratio buckets.
- **Preview crop** shows the center crop that training will use at the selected resolution.
- Recommended steps are based on dataset size and estimated presentations per image.
- Checkpoint frequency and retention are configurable.
- Every validation prompt can use its own aspect ratio and resolution.
- Existing run metadata is stored in `.state/trainer.db`; images remain in
  `data/`, and LoRAs plus validation images remain in `outputs/`.

## Gemini captions

Add a Gemini API key in **Settings**, or set `GEMINI_API_KEY` before starting
the app. A key entered in the UI is used for captioning requests and is not
written to project files, SQLite, or server logs. Captioning is optional: you
can write every caption manually.

## Command line (optional)

The web UI is the recommended workflow. To train directly from YAML:

```bash
uv run python train.py config/train.example.yaml
```

To generate with an exported LoRA:

```bash
uv run python infer.py \
  --lora outputs/my_lora/zimage_lora_step_1000.safetensors \
  --prompt "a studio portrait"
```

When using non-default settings, keep `--lora-rank` and `--lora-alpha`
consistent with the training configuration.

## Local services and privacy

- Web UI: [http://localhost:5173](http://localhost:5173)
- API: [http://localhost:8000](http://localhost:8000)

The API binds to your local network so you can use it from a trusted LAN. Do
not expose it to the public internet, especially if you use a Gemini API key.

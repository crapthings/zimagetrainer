# Z-Forge

Z-Forge is a local web app for training LoRAs for
[`Tongyi-MAI/Z-Image-Turbo`](https://huggingface.co/Tongyi-MAI/Z-Image-Turbo).
Create a dataset, upload images, generate or edit captions, choose training
settings, and compare validation images from saved checkpoints.

Everything runs locally. Images, captions, job history, and LoRA files stay on
your computer.

## Platform support

| Platform | Status |
| --- | --- |
| Windows 10/11 | Supported with one-click install and start scripts |
| Linux | Supported with manual setup |
| macOS | The UI may run, but NVIDIA CUDA training is not supported |

Training requires an NVIDIA GPU and a compatible CUDA driver. The project uses
the CUDA 13.0 PyTorch packages configured in `pyproject.toml`.

## Windows

1. Download or clone this repository.
2. Double-click `install.bat` once.
3. Double-click `start-dev.bat` whenever you want to use Z-Forge.
4. Open [http://localhost:5173](http://localhost:5173).

The installer uses `winget` to install missing tools and then installs the
Python and web dependencies. Keep the terminal window open while Z-Forge is
running. Press `Ctrl+C` to stop it.

## Linux

Install [uv](https://docs.astral.sh/uv/) and Node.js 22, then run:

```bash
corepack enable
uv sync
corepack pnpm install
corepack pnpm --dir web install
corepack pnpm dev
```

Open [http://localhost:5173](http://localhost:5173). Stop the services with
`Ctrl+C`.

Linux currently has no one-click shell scripts; setup and startup use the
commands above.

## Basic workflow

1. Open **Datasets** and create a dataset.
2. Upload training images.
3. Generate captions with Gemini or edit captions manually.
4. Review the dataset-aware training recommendation.
5. Configure validation prompts and image sizes.
6. Start training.
7. Compare validation images and keep the best LoRA checkpoint.

The short **Test run** only verifies that training and output work. It is not
intended to produce the final model.

## Training behavior

- Images are automatically placed into common aspect-ratio buckets.
- Recommended steps are based on dataset size and estimated presentations per
  image.
- Checkpoint frequency and retention are configurable.
- Every validation prompt can use its own aspect ratio and resolution.
- Existing runs and dataset metadata are stored in `.state/trainer.db`.
- Images remain under `data/`; LoRA files and validation images remain under
  `outputs/`.

The first training run downloads the base model and the public Z-Image Turbo
training adapter. The adapter is merged only for training and is not included
in the exported LoRA.

## Gemini captions

Add a Gemini API key in **Settings**, or set `GEMINI_API_KEY` before starting
the app. A key entered in the UI is used for the request and is not written to
the project files.

Captioning is optional. You can write every caption manually.

## Command-line training

The Web UI is the recommended workflow. To train directly from a YAML file:

```bash
uv run python train.py config/train.example.yaml
```

To generate an image with an exported LoRA:

```bash
uv run python infer.py \
  --lora outputs/my_lora/zimage_lora_step_1000.safetensors \
  --prompt "a studio portrait"
```

Keep `--lora-rank` and `--lora-alpha` consistent with the training
configuration when using non-default values.

## Local services

- Web UI: [http://localhost:5173](http://localhost:5173)
- API: [http://localhost:8000](http://localhost:8000)

Both services bind to the local network. Only use Z-Forge on a trusted LAN,
especially when a Gemini API key is configured.

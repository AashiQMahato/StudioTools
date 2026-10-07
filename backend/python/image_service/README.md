# rembg service (internal)

A small FastAPI app that keeps one [rembg](https://github.com/danielgatis/rembg) model session loaded and removes backgrounds from uploaded images. **It is internal**: it binds to `127.0.0.1`, requires a per-launch token, and is only called by the Node API.

## Normal use

You don't start this yourself. `npm run dev` in `backend/` launches it on a free localhost port with a random token, waits for the model to load, and stops it on exit. If Node dies abruptly, the service notices within ~2 s and exits (no orphaned processes).

## Setup

```bash
# from the repository root — creates backend/python/.venv and downloads the model
scripts/setup-ml.sh
```

Or manually (Python 3.11–3.13; rembg does not support 3.14 yet):

```bash
cd backend/python
python3.12 -m venv .venv
source .venv/bin/activate            # Windows: .venv\Scripts\activate
pip install -r rembg_service/requirements.txt
```

## Running it separately (optional)

```bash
cd backend/python/rembg_service
INTERNAL_SERVICE_TOKEN=change-me REMBG_MODEL=isnet-general-use U2NET_HOME=../.models \
  ../.venv/bin/python -m uvicorn app:app --host 127.0.0.1 --port 5055 --workers 1
```

Then in `backend/.env`: `REMBG_AUTOSTART=false`, `REMBG_SERVICE_URL=http://127.0.0.1:5055`, `REMBG_SERVICE_TOKEN=change-me`. Never expose this port publicly.

## Endpoints

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/health` | `{ ready, model, error }` — requires `x-internal-token` |
| POST | `/remove-background` | multipart `file` (+ optional `alpha_matting`, `decontaminate`) → `image/png`; requires `x-internal-token` |

Only direct uploads are accepted. There is no URL input and no request-selectable model.

## Settings (environment)

| Variable | Default | |
| --- | --- | --- |
| `REMBG_MODEL` | `bria-rmbg` | Must be one of the allowed models in `app.py`. See THIRD_PARTY_NOTICES.md for licences. |
| `REMBG_PROVIDERS` | `CPUExecutionProvider` | onnxruntime providers. On macOS the CoreML provider is slower to load and run, so CPU is the default. |
| `BACKGROUND_REMOVAL_CONCURRENCY` | `2` | Parallel model runs. |
| `REMBG_DECONTAMINATE` / `REMBG_ALPHA_MATTING` | `true` / `false` | Default quality options. |
| `MAX_IMAGE_SIZE_MB`, `MAX_IMAGE_PIXELS` | `10`, `40000000` | Upload and decompression-bomb limits. |

## Choosing a model

Measured on an 8 GB Apple M2 with a 1600 px photo: `isnet-general-use` ≈ 1 s, `u2netp` ≈ 0.2 s, `birefnet-general-lite` ≈ 15–35 s, `bria-rmbg` ≈ 20–80 s (it pushes an 8 GB machine into swap). `bria-rmbg` gives the best edges; use it on machines with ≥ 16 GB RAM — and note its non-commercial licence.

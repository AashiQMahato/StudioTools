# Image service (internal)

A FastAPI app the Node API starts and calls: background removal, format conversion (HEIC…), face and
watermark detection, inpainting (LaMa) and PDF work. **It is internal**: it binds to `127.0.0.1`, needs a
per-launch token, and never returns stack traces, paths or model internals.

## Background removal — BiRefNet-Massive

**Current Remove Background model: BiRefNet-Massive** (`BiRefNet-massive-TR_DIS5K_TR_TEs`, MIT, by Peng
Zheng et al.) — the only background-removal model. Weights from `ZhengPeng7/BiRefNet-DIS5K-TR_TEs` and
model code from `ZhengPeng7/BiRefNet`, both at pinned revisions (see `background_removal/model_config.py`),
in `backend/python/.models/birefnet-massive`. Loaded once at startup, warmed up, then only read — nothing
is downloaded while serving.

```
original image
  → model copy (longest side = the mode's input size, aspect kept, padded square — never stretched)
  → BiRefNet-Massive (fp16 on a GPU) → raw alpha
  → normalise · drop specks cut off from the subject · fill pinholes
  → alpha at ≤ 2048 px → edge-aware refinement in the transition band (colour-guided filter, the photo as guide)
  → alpha at the ORIGINAL size (bicubic, never thresholded)
  → halo removal in the soft edge band (blur-fusion foreground estimation; colour only, alpha untouched)
  → original RGB + refined alpha → RGBA PNG at the original resolution
```

| Module | Does |
|---|---|
| `background_removal/birefnet_service.py` | the model: load once, `predict`, CPU fallback if the GPU fails |
| `background_removal/image_preprocessor.py` | safe decode, EXIF, RGB, aspect-kept model input |
| `background_removal/mask_processor.py` | normalise, specks, pinholes, `resize_alpha` |
| `background_removal/alpha_refiner.py` | `detect_transition_band`, `refine_alpha_edges` (guided filter, band only) |
| `background_removal/edge_decontaminator.py` | `decontaminate_edges` (halo removal) |
| `background_removal/background_removal_service.py` | the pipeline: `generate_alpha` → … → `compose_rgba`, timings |

**Guarantees** (tested in `tests/test_background_removal.py`): soft alpha is kept (no hard threshold);
pixels BiRefNet is confident about aren't changed; opaque pixels keep their original RGB exactly; the
output has the original resolution; specks are only pieces cut off from the subject, never strands joined
to it through soft hair or fur.

### Modes

| Mode | Input | When |
|---|---|---|
| `quality` (default) | 768 on 8 GB Apple Silicon, 1024 with more memory or CUDA, 512 on CPU | every request unless asked otherwise |
| `ultra` | 1024 | on a GPU (`BIREFNET_ULTRA=auto`); not always better — see below |
| `fast` | 640 | API only on a GPU (it isn't meaningfully faster there); offered on CPU-only servers |

### Measured on an M2, 8 GB (MPS, fp16, 1–1.7 MP photos, warm)

| Input | BiRefNet | Refine | Halo removal | Compose | Total | GPU / RAM |
|---|---|---|---|---|---|---|
| 512 | 0.83 s | — | — | — | 1.1 s | — loses the subject on some photos: not used |
| 640 (fast) | 1.25 s | 0.08 s | 0.16 s | 0.14 s | 1.6 s | 1.3 GB / 1.1 GB |
| **768 (quality)** | **1.3 s** | **0.08 s** | **0.15 s** | **0.14 s** | **1.7 s** | **1.4 GB / 1.0 GB** |
| 1024 (ultra) | 2.9 s | 0.15 s | 0.2 s | 0.15 s | 3.5 s | 1.4 GB / 1.3 GB |

Load ≈ 3–5 s, warm-up ≈ 3 s. Run it yourself: `.venv/bin/python scripts/benchmark_background_removal.py`.

### Settings (environment; `backend/.env.example` has them all)

| Variable | Default | |
|---|---|---|
| `BACKGROUND_REMOVAL` | `on` | `off` on small servers (no PyTorch needed: install `requirements.txt` only) |
| `BIREFNET_DEVICE` | `auto` | CUDA → MPS → CPU |
| `BIREFNET_MODEL_PATH` | `backend/python/.models/birefnet-massive` | |
| `BIREFNET_INPUT_SIZE` | automatic | quality's input size |
| `BIREFNET_PRECISION` | fp16 on GPU, fp32 on CPU | |
| `BIREFNET_ULTRA` | `auto` | `on` / `off` |
| `EDGE_LOW_THRESHOLD` / `EDGE_HIGH_THRESHOLD` | 0.05 / 0.95 | the transition band that gets refined |
| `REFINE_EPS`, `REFINE_MAX_SIDE` | 1e-4, 2048 | guided-filter regularisation; refinement size cap |
| `DECONTAMINATE_STRENGTH` | 1 | halo removal, 0–1 |

## Setup

`scripts/setup-ml.sh` (repository root) makes `backend/python/.venv` with `requirements-ai.txt` and
downloads BiRefNet-Massive (≈ 885 MB). Python 3.11–3.13. Manually:

```bash
cd backend/python
uv venv --python 3.12 .venv            # or: python3.12 -m venv .venv
uv pip install --python .venv/bin/python -r image_service/requirements-ai.txt
```

- **Apple Silicon:** MPS is used automatically (ops it lacks fall back to the CPU). On 8 GB keep other
  heavy apps closed; the model needs ≈ 1.4 GB of unified memory.
- **CUDA:** install the CUDA build of PyTorch first (pytorch.org), then the requirements.
- **CPU only:** works, much slower (quality mode uses 512 there).

Tests: `uv pip install --python .venv/bin/python -r requirements-dev.txt && .venv/bin/python -m pytest tests`.

## Troubleshooting

- **"Background removal is temporarily unavailable"** — the model folder is missing: run `scripts/setup-ml.sh`.
- **Slow first request** — the GPU compiles kernels per input size; quality and fast are warmed at startup, ultra on first use.
- **Memory pressure on 8 GB** — use quality (768), close other model servers (only one copy of the model should run).
- **A whole group is kept** — BiRefNet is a foreground model: it keeps whatever stands out, everyone in a group photo included. It doesn't choose between people.

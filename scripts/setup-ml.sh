#!/usr/bin/env bash
# Sets up local image processing for Studio Tools:
#   1. A Python virtualenv for the image service, with BiRefNet-Massive (background removal).
#   2. The official upscayl-ncnn binary ("upscayl-bin") and Upscayl's models (upscaling).
#   3. A separate Python virtualenv with PaddleOCR and its text models (the OCR editor).
#
# Nothing is installed system-wide. Everything lands under backend/python/ and backend/vendor/ (both git-ignored).
# The script explains what it will download and asks before doing it (pass --yes to skip the prompt).
#
# Usage: scripts/setup-ml.sh [--yes] [--skip-image-service] [--skip-upscayl] [--skip-ocr]

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND="$ROOT/backend"
PY_DIR="$BACKEND/python"
VENV="$PY_DIR/.venv"
OCR_VENV="$PY_DIR/.venv-ocr"
MODELS_HOME="$PY_DIR/.models"
VENDOR="$BACKEND/vendor/upscayl"

# Pinned upstream versions. Update deliberately, together with the digests.
UPSCAYL_BIN_TAG="20251207-174704"
declare_digest() {
  case "$1" in
    macos) echo "277419791281a56eae0c739c70120b974d7267cf7c2de8e86dc09798d4b314db" ;;
    linux) echo "a9fab3c770b62f2b7a35d8d6d61eb4e8b3aef79128b665c919d080b85a2292f2" ;;
    *) echo "" ;;
  esac
}
# Upscayl v2.15.0. Only models without a non-commercial label from Upscayl are fetched (see THIRD_PARTY_NOTICES.md).
UPSCAYL_MODELS_COMMIT="4f39acfc6f88260d105920a64deff8431d5e1544"
UPSCAYL_MODELS=(upscayl-standard-4x upscayl-lite-4x digital-art-4x)

ASSUME_YES=false
SKIP_IMAGE_SERVICE=false
SKIP_UPSCAYL=false
SKIP_OCR=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes|-y) ASSUME_YES=true ;;
    --skip-image-service|--skip-rembg) SKIP_IMAGE_SERVICE=true ;;
    --skip-upscayl) SKIP_UPSCAYL=true ;;
    --skip-ocr) SKIP_OCR=true ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
ok() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
fail() { printf '  \033[31m✗\033[0m %s\n' "$*"; }

# Read a key from backend/.env if present (without sourcing the file).
env_value() {
  [[ -f "$BACKEND/.env" ]] || return 0
  grep -E "^$1=" "$BACKEND/.env" | tail -1 | cut -d= -f2- | tr -d '"' || true
}

OS="$(uname -s)"
ARCH="$(uname -m)"
case "$OS" in
  Darwin) PLATFORM=macos ;;
  Linux) PLATFORM=linux ;;
  *) PLATFORM=unsupported ;;
esac

bold "Studio Tools — processing setup"
echo "  Platform: $OS $ARCH"
echo
echo "This will:"
$SKIP_IMAGE_SERVICE || echo "  • create $VENV and install backend/python/image_service/requirements-ai.txt"
$SKIP_IMAGE_SERVICE || echo "  • download BiRefNet-Massive (≈885 MB) into $MODELS_HOME/birefnet-massive"
$SKIP_UPSCAYL || echo "  • download upscayl-bin $UPSCAYL_BIN_TAG ($PLATFORM) from github.com/upscayl/upscayl-ncnn and verify its SHA-256"
$SKIP_UPSCAYL || echo "  • download Upscayl models (${UPSCAYL_MODELS[*]}) from github.com/upscayl/upscayl @ ${UPSCAYL_MODELS_COMMIT:0:7}"
$SKIP_OCR || echo "  • create $OCR_VENV, install backend/python/ocr_service/requirements.txt (PaddlePaddle + PaddleOCR, ~1 GB)"
$SKIP_OCR || echo "  • download the PaddleOCR text models (detection, English and Devanagari recognition, layout) into $MODELS_HOME/paddlex"
echo
if ! $ASSUME_YES; then
  read -r -p "Continue? [y/N] " answer
  [[ "$answer" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 1; }
fi

# ---------------------------------------------------------------- image service

find_python() {
  if command -v uv >/dev/null 2>&1; then echo "uv"; return; fi
  for candidate in python3.13 python3.12 python3.11 python3; do
    if command -v "$candidate" >/dev/null 2>&1; then
      if "$candidate" -c 'import sys; sys.exit(0 if (3, 11) <= sys.version_info[:2] < (3, 14) else 1)' 2>/dev/null; then
        echo "$candidate"; return
      fi
    fi
  done
}

if ! $SKIP_IMAGE_SERVICE; then
  echo; bold "Image service + background removal (BiRefNet-Massive)"
  PY="$(find_python)"
  if [[ -z "$PY" ]]; then
    fail "No Python between 3.11 and 3.13 found."
    echo "    Install one (e.g. 'brew install python@3.12' or 'uv python install 3.12') and re-run."
    exit 1
  fi
  REQS="$PY_DIR/image_service/requirements-ai.txt"
  [[ "${BACKGROUND_REMOVAL:-on}" == "off" ]] && REQS="$PY_DIR/image_service/requirements.txt"
  if [[ "$PY" == "uv" ]]; then
    [[ -x "$VENV/bin/python" ]] || uv venv -q --python 3.12 "$VENV"
    uv pip install -q --python "$VENV/bin/python" -r "$REQS"
  else
    [[ -x "$VENV/bin/python" ]] || "$PY" -m venv "$VENV"
    "$VENV/bin/python" -m pip install -q --upgrade pip
    "$VENV/bin/python" -m pip install -q -r "$REQS"
  fi
  ok "Python $("$VENV/bin/python" -c 'import platform; print(platform.python_version())')"

  if [[ "${BACKGROUND_REMOVAL:-on}" != "off" ]]; then
    # BiRefNet-Massive (MIT): weights + model code at reviewed, pinned revisions, in one local folder.
    echo "  Downloading BiRefNet-Massive (≈885 MB, first run only)…"
    BIREFNET_DIR="$MODELS_HOME/birefnet-massive" "$VENV/bin/python" - <<'PY'
import os, shutil
from huggingface_hub import hf_hub_download
dst = os.environ["BIREFNET_DIR"]; os.makedirs(dst, exist_ok=True)
pins = {
    ("ZhengPeng7/BiRefNet-DIS5K-TR_TEs", "487f440314ea7ab8ea7d184861953a4010b55587"): ["config.json", "model.safetensors"],
    ("ZhengPeng7/BiRefNet", "e2bf8e4460fc8fa32bba5ea4d94b3233d367b0e4"): ["birefnet.py", "BiRefNet_config.py"],
}
for (repo, revision), files in pins.items():
    for name in files:
        target = os.path.join(dst, name)
        if not os.path.exists(target):
            shutil.copy(hf_hub_download(repo, name, revision=revision), target)
PY
    ok "BiRefNet-Massive ready"
  fi

  # Face detection for the photo generator: OpenCV's YuNet (MIT), from the OpenCV model zoo.
  FACE_MODEL="$MODELS_HOME/face_detection_yunet_2023mar.onnx"
  FACE_MODEL_SHA256="8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4"
  if [[ ! -s "$FACE_MODEL" ]]; then
    curl -fsSL "https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx" -o "$FACE_MODEL.part"
    if [[ "$(shasum -a 256 "$FACE_MODEL.part" | cut -d' ' -f1)" != "$FACE_MODEL_SHA256" ]]; then
      rm -f "$FACE_MODEL.part"
      fail "Face detection model checksum mismatch; not installed."
      exit 1
    fi
    mv "$FACE_MODEL.part" "$FACE_MODEL"
  fi
  ok "Face detection model (YuNet) ready"

  # Watermark remover: PP-OCRv3 text detection (Apache-2.0, OpenCV model zoo) and LaMa inpainting
  # (Apache-2.0, ONNX export, ~200 MB) — both run by the Python service; LaMa also powers Retouch.
  fetch_model() {
    local target="$MODELS_HOME/$1" url="$2" sha="$3"
    if [[ ! -s "$target" ]]; then
      curl -fsSL "$url" -o "$target.part"
      if [[ "$(shasum -a 256 "$target.part" | cut -d' ' -f1)" != "$sha" ]]; then
        rm -f "$target.part"
        fail "Checksum mismatch for $1; not installed."
        exit 1
      fi
      mv "$target.part" "$target"
    fi
  }
  fetch_model text_detection_en_ppocrv3_2023may.onnx \
    "https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/text_detection_ppocr/text_detection_en_ppocrv3_2023may.onnx" \
    03f550c6b406fda8bf54bd8327815f6c7e2edd98cea02348c93d879254366587
  ok "Text detection model (PP-OCRv3) ready"
  echo "  Downloading LaMa inpainting model (~200 MB, first run only)…"
  fetch_model lama_fp32.onnx "https://huggingface.co/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx" \
    1faef5301d78db7dda502fe59966957ec4b79dd64e16f03ed96913c7a4eb68d6
  ok "Inpainting model (LaMa) ready"
fi

# ---------------------------------------------------------------- OCR (PaddleOCR)

if ! $SKIP_OCR; then
  echo; bold "Text recognition (PaddleOCR)"
  OCR_PY="$(find_python)"
  if [[ -z "$OCR_PY" ]]; then
    fail "No Python between 3.11 and 3.13 found (needed for PaddleOCR)."
    exit 1
  fi
  # Its own environment: PaddleOCR pins OpenCV and NumPy versions that would clash with the image service's.
  if [[ "$OCR_PY" == "uv" ]]; then
    [[ -x "$OCR_VENV/bin/python" ]] || uv venv -q --python 3.12 "$OCR_VENV"
    uv pip install -q --python "$OCR_VENV/bin/python" -r "$PY_DIR/ocr_service/requirements.txt"
  else
    [[ -x "$OCR_VENV/bin/python" ]] || "$OCR_PY" -m venv "$OCR_VENV"
    "$OCR_VENV/bin/python" -m pip install -q --upgrade pip
    "$OCR_VENV/bin/python" -m pip install -q -r "$PY_DIR/ocr_service/requirements.txt"
  fi
  ok "PaddleOCR $("$OCR_VENV/bin/python" -c 'import importlib.metadata as m; print(m.version("paddleocr"))')"
  echo "  Downloading the text models (first run only)…"
  # Loading each model once downloads it into the cache the service uses.
  PADDLE_PDX_CACHE_HOME="$MODELS_HOME/paddlex" PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=True \
    "$OCR_VENV/bin/python" -c "
import sys; sys.path.insert(0, '$PY_DIR/ocr_service')
import app
for key in ('devanagari', 'en', 'layout', 'orientation'): app.model(key)
" >/dev/null 2>&1 || { fail "Could not download the PaddleOCR models."; exit 1; }
  ok "Text models ready (PP-OCRv5 detection, English and Devanagari recognition, PP-DocLayout)"
fi

# ---------------------------------------------------------------- Upscayl

if ! $SKIP_UPSCAYL; then
  echo; bold "Upscaling (upscayl-ncnn)"
  if [[ "$PLATFORM" == "unsupported" ]]; then
    fail "This script supports macOS and Linux. On Windows, download upscayl-bin-$UPSCAYL_BIN_TAG-windows.zip from"
    echo "    https://github.com/upscayl/upscayl-ncnn/releases/tag/$UPSCAYL_BIN_TAG and set UPSCAYL_BINARY_PATH."
    exit 1
  fi

  if [[ "$PLATFORM" == "linux" ]]; then
    if ldconfig -p 2>/dev/null | grep -q "libvulkan.so.1"; then
      ok "Vulkan loader found (libvulkan.so.1)"
    else
      fail "Vulkan loader (libvulkan.so.1) not found. Install your distro's Vulkan loader and a Vulkan-capable GPU driver"
      echo "    (e.g. 'sudo apt install libvulkan1 mesa-vulkan-drivers'), then re-run. Upscaling will report as unavailable until then."
    fi
  else
    ok "macOS: upscayl-bin bundles MoltenVK (Vulkan on Metal)"
  fi

  mkdir -p "$VENDOR/models"
  BIN="$VENDOR/upscayl-bin"
  if [[ -x "$BIN" ]]; then
    ok "upscayl-bin already present"
  else
    ZIP_NAME="upscayl-bin-$UPSCAYL_BIN_TAG-$PLATFORM.zip"
    URL="https://github.com/upscayl/upscayl-ncnn/releases/download/$UPSCAYL_BIN_TAG/$ZIP_NAME"
    TMP="$(mktemp -d)"
    trap 'rm -rf "$TMP"' EXIT
    curl -fsSL "$URL" -o "$TMP/$ZIP_NAME"
    EXPECTED="$(declare_digest "$PLATFORM")"
    ACTUAL="$(shasum -a 256 "$TMP/$ZIP_NAME" | cut -d' ' -f1)"
    if [[ "$ACTUAL" != "$EXPECTED" ]]; then
      fail "Checksum mismatch for $ZIP_NAME (expected $EXPECTED, got $ACTUAL). Not installing."
      exit 1
    fi
    ok "Downloaded and verified $ZIP_NAME"
    unzip -q "$TMP/$ZIP_NAME" -d "$TMP/unzipped"
    FOUND="$(find "$TMP/unzipped" -type f -name 'upscayl-bin' | head -1)"
    [[ -n "$FOUND" ]] || { fail "upscayl-bin not found inside the archive"; exit 1; }
    cp "$FOUND" "$BIN"
    chmod +x "$BIN"
    # Keep upstream licence/notice files next to the binary.
    find "$TMP/unzipped" -maxdepth 3 -type f \( -iname 'LICENSE*' -o -iname 'NOTICE*' -o -iname 'README*' \) -exec cp {} "$VENDOR/" \; 2>/dev/null || true
    ok "Installed upscayl-bin into backend/vendor/upscayl/"
  fi

  for model in "${UPSCAYL_MODELS[@]}"; do
    for ext in param bin; do
      target="$VENDOR/models/$model.$ext"
      [[ -s "$target" ]] && continue
      curl -fsSL "https://raw.githubusercontent.com/upscayl/upscayl/$UPSCAYL_MODELS_COMMIT/resources/models/$model.$ext" -o "$target.part"
      mv "$target.part" "$target"
    done
    ok "Model $model"
  done

  # Real probe: upscale a tiny image. This is what actually proves Vulkan/GPU support.
  PROBE="$(mktemp -d)"
  if [[ -x "$VENV/bin/python" ]]; then
    "$VENV/bin/python" -c "from PIL import Image; Image.new('RGB', (16, 16), (120, 90, 60)).save('$PROBE/in.png')"
  else
    warn "Skipping probe image generation (no Python venv); run scripts/check-processing.sh after setup."
  fi
  if [[ -f "$PROBE/in.png" ]]; then
    if "$BIN" -i "$PROBE/in.png" -o "$PROBE/out.png" -m "$VENDOR/models" -n upscayl-standard-4x -s 4 -f png >"$PROBE/log" 2>&1 && [[ -s "$PROBE/out.png" ]]; then
      GPU="$(grep -Eo '^\[[0-9]+ [^]]+\]' "$PROBE/log" | head -1 | sed -E 's/^\[[0-9]+ (.*)\]$/\1/')"
      ok "Upscaling works on this machine${GPU:+ (GPU: $GPU)}"
    else
      fail "upscayl-bin could not run. Most likely no Vulkan-capable GPU/driver is available. Last lines:"
      tail -5 "$PROBE/log" | sed 's/^/    /'
    fi
  fi
  rm -rf "$PROBE"
fi

echo
bold "Done."
echo "  Start the API with 'npm run dev' in backend/ — it launches the image service automatically."
echo "  Check status any time with scripts/check-processing.sh"

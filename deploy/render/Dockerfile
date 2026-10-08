# Studio Tools API, "lite", for Render's free plan (512 MB). Build context: the repository root.
#
# Node runs the API and launches the Python image/PDF service itself (the PDF tools hand it file paths,
# so they share a disk). To fit in 512 MB, the heavy AI is left out:
#   • PDF to images, compress, protect, unlock, PDF to text/Word: full quality (PDFium, qpdf).
#   • OCR: Tesseract (English and Nepali) instead of PaddleOCR.
#   • Background removal and passport photos: off (the model alone needs ~400 MB).
#   • Retouch and watermark removal: the built-in engine; upscaling: off (needs a GPU).
FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv curl ca-certificates tesseract-ocr tesseract-ocr-eng tesseract-ocr-nep libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

USER node
ENV HOME=/home/node
WORKDIR /home/node/app/backend

COPY --chown=node backend/package.json backend/package-lock.json ./
RUN npm ci

COPY --chown=node backend ./
RUN npm run build && npm prune --omit=dev

# The image/PDF service's environment (the paths the API expects: python/.venv, python/.models).
RUN python3 -m venv python/.venv \
    && python/.venv/bin/pip install --no-cache-dir -q -r python/image_service/requirements.txt

# The two small detection models (face for photos, text for watermarks), checked against known hashes.
RUN mkdir -p python/.models && cd python/.models \
    && curl -fsSL -o face_detection_yunet_2023mar.onnx https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx \
    && curl -fsSL -o text_detection_en_ppocrv3_2023may.onnx https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/text_detection_ppocr/text_detection_en_ppocrv3_2023may.onnx \
    && echo "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4  face_detection_yunet_2023mar.onnx" | sha256sum -c - \
    && echo "03f550c6b406fda8bf54bd8327815f6c7e2edd98cea02348c93d879254366587  text_detection_en_ppocrv3_2023may.onnx" | sha256sum -c -

ENV NODE_ENV=production \
    BACKGROUND_REMOVAL=off \
    UPSCAYL_ENABLED=false \
    OCR_PROVIDER=tesseract \
    RETOUCH_PROVIDER=local \
    WATERMARK_REMOVAL_PROVIDER=local \
    DOCUMENTS_CONCURRENCY=1 \
    COMPRESSION_CONCURRENCY=1 \
    RETOUCH_CONCURRENCY=1 \
    OCR_CONCURRENCY=1 \
    UV_THREADPOOL_SIZE=2

# Render sets PORT.
CMD ["node", "dist/server.js"]

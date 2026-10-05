# Studio Tools — Backend

Express 5 + TypeScript (strict) API. It is the only thing the browser talks to; the image-processing engines run behind it and are never exposed.

```text
React ──► Express API ──► rembg service (Python, localhost-only, token-protected)
                     └──► upscayl-bin (Upscayl / upscayl-ncnn, spawned per job, no shell)
```

## Setup

```bash
npm install
cp .env.example .env
../scripts/setup-ml.sh          # Python venv + rembg model, Upscayl binary + models (asks before downloading)
npm run dev                     # also launches the rembg service; http://localhost:5000
../scripts/check-processing.sh  # what's ready, and why not
```

`npm run build` compiles to `dist/`; `npm run start` runs it (the rembg service is launched the same way).

On macOS, port 5000 is taken by AirPlay Receiver — disable it or set `PORT=5050` (and `API_PROXY_TARGET=http://localhost:5050` in `frontend/.env`).

## API

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| GET | `/api/health` | — | `{ success, message, services: { api, backgroundRemoval, upscaling } }` |
| GET | `/api/health/processors` | — | availability, status, model, GPU name, queue, limits (no paths or secrets) |
| POST | `/api/remove-background` | multipart `file` | `image/png` (transparent), same dimensions as the input |
| POST | `/api/upscale` | multipart `file`, `scale` = `2` or `4` | the image at 2×/4×; JPEG stays JPEG, PNG/WebP keep transparency |
| POST | `/api/retouch` | multipart `file`, `mask` (PNG; transparent = untouched), `mode`, `strength`, `texture` | the retouched image, full resolution |
| POST | `/api/convert` | multipart `file` (JPG, PNG, WebP, HEIC/HEIF, AVIF, TIFF, BMP, GIF) | an upright `image/jpeg` |
| GET | `/api/photo-generator/presets` | — | photo types: physical size, DPI, pixel size, sheet capacity |
| POST | `/api/photo-generator/process` | multipart `file`, `preset` | `application/x-ndjson`: one progress event per line, then `{ type: "result" }` or `{ type: "error" }` |
| POST | `/api/photo-generator/adjust` | JSON `{ workId, crop }` | the photo re-rendered from a manual crop, with its checks |
| POST | `/api/photo-generator/sheet` | JSON `{ photoId, copies }` | an A4 sheet of copies at the photo's DPI |
| POST | `/api/ocr` | multipart `file`, `language` = `auto` \| `en` \| `ne` \| `mixed`, optional `region` (JSON: `{"type":"rect","box":{…}}` or `{"type":"polygon","points":[[x,y],…]}`, image pixels), `preserveLayout` | `application/x-ndjson`: a `stage` event per step, then `{ type: "result", data }` (blocks, lines, words, boxes, confidence, estimated formatting) or `{ type: "error" }` |
| POST | `/api/pdf/merge` | multipart `files` (2+ PDFs, in order) | `202` + a job (see below) → one merged PDF |
| POST | `/api/pdf/split` | multipart `files` (1 PDF), `mode` = `every` \| `ranges`, `ranges` (e.g. `1-3, 5, 8-`) | job → one PDF per page or range |
| POST | `/api/pdf/organize` | multipart `files` (1 PDF), `plan` (JSON `[{ "page": 3, "rotate": 90 }, …]` — reorder, delete, duplicate, rotate, extract) | job → the rearranged PDF |
| POST | `/api/pdf/to-images` | multipart `files` (1 PDF), `format` = `jpg` \| `png` \| `webp`, `dpi`, `quality`, optional `pages` | job → one image per page |
| POST | `/api/pdf/from-images` | multipart `files` (images, in order), `size`, `orientation`, `margin` (mm), `fit`, `quality`, `maxDpi`, `rotations` (JSON) | job → one PDF |
| POST | `/api/pdf/compress` | multipart `files` (1 PDF), `preset` = `maximum` \| `recommended` \| `high` \| `custom` (+ `quality`, `maxSide`) | job → the compressed PDF; summary `{ before, after, smaller }` (the original back if nothing was gained) |
| POST | `/api/pdf/watermark` | multipart `files` (1 PDF), `kind` = `text` \| `image` (+ `image` file), `text`, `fontSize`, `color`, `opacity`, `rotation`, `position` (9 spots or `tile`), `imageScale`, optional `pages` | job → the watermarked PDF |
| POST | `/api/pdf/page-numbers` | multipart `files` (1 PDF), `template` (e.g. `Page {n} of {total}`), `position`, `fontSize`, `margin`, `start`, optional `pages` | job → the numbered PDF |
| POST | `/api/pdf/to-text` | multipart `files` (1 PDF), `mode` = `auto` \| `text` \| `ocr`, `language` | job → `.txt` and per-page `.json` (text layer or OCR, with the other reading kept) |
| POST | `/api/pdf/to-word` | multipart `files` (1 PDF), `language` | job → per-page `.json` documents (headings, paragraphs, lists, tables, styled runs; OCR for scans) with the pictures cropped from each page; the browser builds the `.docx` |
| POST | `/api/pdf/annotate` | multipart `files` (1 PDF), `annotations` (JSON: text, image, ink, highlight/underline/strike, rect/ellipse, line/arrow — points on the page as displayed), `deletePages` (JSON), `images` (the pictures used, named by their key), `purpose` = `edit` \| `sign` | job → the edited (or signed) PDF; the original content is kept underneath |
| POST | `/api/pdf/protect` | multipart `files` (1 PDF), `password`, optional `ownerPassword`, `allowPrint`, `allowCopy`, `allowEdit` | job → the PDF encrypted with AES-256 (passwords are never logged or kept) |
| POST | `/api/pdf/unlock` | multipart `files` (1 PDF), `password` (may be empty for restrictions-only PDFs) | job → the PDF without its password; `422 WRONG_PASSWORD` if it doesn't open it |
| GET | `/api/jobs/:id` | — | status (`queued` → `processing` → `completed` \| `failed`), progress `{ step, done, total }`, result files (ids, names, sizes), safe error |
| GET | `/api/jobs/:id/files/:fileId` | `?inline=1` to view | a result file |
| GET | `/api/jobs/:id/archive` | — | every result file as a ZIP, streamed |
| DELETE | `/api/jobs/:id` | — | cancels the job and deletes its files now |
| GET | `/api/photo-generator/files/:id` | `?download=1` to save | a generated file; kept in memory only, deleted after `PHOTO_FILE_TTL_MINUTES` |

Successful responses include `Content-Disposition` (e.g. `photo-no-background.png`, `photo-upscaled-2x.jpg`), `X-Image-Width/Height` and `X-Original-Width/Height`. Errors are JSON: `{ "success": false, "message": "…", "code": "…" }` with codes such as `FILE_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE`, `INVALID_IMAGE`, `IMAGE_TOO_LARGE`, `INVALID_SCALE`, `SERVER_BUSY`, `PROCESSING_TIMEOUT`, `BACKGROUND_REMOVAL_UNAVAILABLE`, `UPSCALING_UNAVAILABLE`, `RATE_LIMITED`.

```bash
curl -X POST -F "file=@photo.jpg" http://localhost:5000/api/remove-background --output photo-no-background.png
curl -X POST -F "file=@photo.jpg" -F "scale=2" http://localhost:5000/api/upscale --output photo-upscaled-2x.jpg
```

## How requests are handled

1. **Rate limit** (`PROCESSING_RATE_LIMIT` per 15 min) → **multer** (memory only, size limit, one file).
2. **Validation** (`services/image-processing/imageValidation.service.ts`): extension and declared type, real format from the file signature, then a full decode with a pixel limit.
3. **Concurrency limiter** per engine (`BACKGROUND_REMOVAL_CONCURRENCY`, `UPSCALE_CONCURRENCY`) with a bounded queue (`PROCESSING_MAX_QUEUE`) → `SERVER_BUSY` when full.
4. **Engine**
   - rembg: HTTP to the internal service, with a timeout (`REMBG_TIMEOUT_MS`).
   - Upscayl: a private `mkdtemp` directory per request, EXIF-oriented PNG written with a fixed name, `upscayl-bin` spawned with an argument array (no shell), killed on timeout (`UPSCALE_TIMEOUT_MS`) or client disconnect, directory always deleted.
5. The result is streamed back. Nothing is stored.

If a client disconnects mid-request, its job is cancelled (queued jobs never start; a running upscale is killed).

## Structure

```text
src/
├── config/          env (all settings), upload rules
├── controllers/     background removal, upscale, health
├── middleware/      rate limiters, upload, error handler (safe messages only)
├── routes/          /api router
├── services/
│   ├── background-removal/   rembgProcess (lifecycle), rembgProvider, service (+ limiter)
│   ├── upscaling/            upscaylProvider (probe, spawn, encode), service (+ limiter)
│   ├── ocr/                  providers (PaddleOCR, Tesseract), preprocessing, layout, formatting, reconstruction
│   ├── pdf/                  merge/split/organize, images → PDF, PDF → images (PDFium render), page ranges
│   ├── jobs/                 background jobs: progress, results, expiry and deletion
│   ├── files/                private per-job workspaces in the documents temp folder
│   └── image-processing/     imageValidation.service
└── utils/           AppError, ConcurrencyLimiter, withTempDir, http helpers
python/rembg_service/  internal FastAPI service (see its README)
python/ocr_service/    internal PaddleOCR service (own venv: python/.venv-ocr); the document model is built in services/ocr/
vendor/upscayl/        upscayl-bin + models (installed by scripts/setup-ml.sh; git-ignored)
```

Swap engines by implementing `BackgroundRemovalProvider` / `UpscaleProvider` (`src/types/image.ts`).

See `.env.example` for every setting and [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) for licences.

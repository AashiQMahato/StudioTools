# Third-party notices

Studio Tools runs open-source image-processing engines **locally, on the server**. Nothing here is sent to a third-party service. This file records what is used, where it comes from, and its licence. It is not legal advice — review it before you package or deploy the product commercially.

## Background removal — BiRefNet

| | |
| --- | --- |
| Model | BiRefNet-Massive (Zheng Peng et al., `ZhengPeng7/BiRefNet-DIS5K-TR_TEs`) |
| Licence | MIT: commercial use allowed |
| Runtime | PyTorch (BSD-3-Clause) and `transformers` (Apache-2.0) in the internal image service |

Weights are fetched once by `scripts/setup-ml.sh` from pinned revisions into `backend/python/.models/` (not committed) and only read while serving.

## Upscaling — Upscayl / upscayl-ncnn

| | |
| --- | --- |
| Project | [upscayl-ncnn](https://github.com/upscayl/upscayl-ncnn) — the processing backend of [Upscayl](https://github.com/upscayl/upscayl) |
| Version | release `20251207-174704`, binary `upscayl-bin` (SHA-256 verified by `scripts/setup-ml.sh`) |
| Licence | **GNU AGPL-3.0** (the upstream `LICENSE` is kept next to the binary in `backend/vendor/upscayl/`) |
| Used as | Unmodified executable, launched by the API as a separate process |
| Built on | [NCNN](https://github.com/Tencent/ncnn) (BSD-3-Clause) and [Real-ESRGAN-ncnn-vulkan](https://github.com/xinntao/Real-ESRGAN-ncnn-vulkan) / [Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN) (BSD-3-Clause); on macOS, Vulkan runs through [MoltenVK](https://github.com/KhronosGroup/MoltenVK) (Apache-2.0) |

AGPL-3.0 note: we run the upstream binary unmodified. If you modify upscayl-ncnn and let users interact with it over a network, AGPL §13 requires offering them the corresponding source. Upstream source: https://github.com/upscayl/upscayl-ncnn.

### Upscayl models

Downloaded by `scripts/setup-ml.sh` from the Upscayl repository at commit `4f39acfc6f88260d105920a64deff8431d5e1544` (v2.15.0) into `backend/vendor/upscayl/models/` (not committed).

| Model | Installed | Notes |
| --- | --- | --- |
| `upscayl-standard-4x` (default) | Yes | Distributed by Upscayl; not marked non-commercial by Upscayl. |
| `upscayl-lite-4x` | Yes | Distributed by Upscayl; not marked non-commercial by Upscayl. Much faster. |
| `digital-art-4x` | Yes | Distributed by Upscayl; not marked non-commercial by Upscayl. |
| `remacri-4x`, `ultramix-balanced-4x`, `ultrasharp-4x` | **No** | Upscayl labels these "Non-Commercial" (Foolhardy; Kim2091). |
| `high-fidelity-4x` (`hfa2k-4x`) | No | Licence not confirmed. |

Upscayl does not publish a separate licence for each bundled weight file. Confirm the terms of the model you enable before commercial use.

## Photo generator — face detection and HEIC decoding

| | |
| --- | --- |
| Face detection | [OpenCV](https://github.com/opencv/opencv) via `opencv-python-headless` 5.0 (Apache-2.0), running the [YuNet](https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet) model `face_detection_yunet_2023mar.onnx` (MIT) |
| HEIC/HEIF decoding | [pillow-heif](https://github.com/bigcat88/pillow_heif) 1.8 (BSD-3-Clause) |
| Used as | Python libraries inside our internal service (`backend/python/rembg_service`) |

The YuNet weights are downloaded by `scripts/setup-ml.sh` from the OpenCV model zoo (checksum-verified) into `backend/python/.models/` (not committed).

**Check before distributing:** pillow-heif's binary wheels bundle libheif and libde265 (LGPL-3.0) and, for encoding, x265 (GPL-2.0). Running them on your own server is different from shipping them to others; if you package or redistribute the backend, review those licences. HEVC (the codec inside HEIC) is also covered by patents in some countries.

## Watermark remover and Retouch — text detection and inpainting

| | |
| --- | --- |
| Text detection | [PP-OCRv3](https://github.com/opencv/opencv_zoo/tree/main/models/text_detection_ppocr) detector, `text_detection_en_ppocrv3_2023may.onnx` (Apache-2.0), run by OpenCV |
| Inpainting | [LaMa](https://github.com/advimman/lama) (Apache-2.0), ONNX export [`Carve/LaMa-ONNX`](https://huggingface.co/Carve/LaMa-ONNX) `lama_fp32.onnx` (Apache-2.0), run by ONNX Runtime (MIT) |
| Used as | Models inside our internal service (`backend/python/rembg_service`) |

Both are downloaded by `scripts/setup-ml.sh` (checksum-verified) into `backend/python/.models/` (not committed). The watermark remover is meant for images the user owns or may edit; the UI says so.

## OCR editor — PaddleOCR

| | |
| --- | --- |
| Project | [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) 3.7.0 and [PaddlePaddle](https://github.com/PaddlePaddle/Paddle) 3.3.1 (pinned in `backend/python/ocr_service/requirements.txt`) |
| Licence | Apache-2.0 (both) |
| Models | PP-OCRv5 mobile detection, PP-OCRv6 medium recognition (English), Devanagari PP-OCRv5 mobile recognition, PP-DocLayout_plus-L, PP-LCNet_x1_0_doc_ori (page orientation) — Apache-2.0, downloaded by `scripts/setup-ml.sh` into `backend/python/.models/paddlex/` (not committed) |
| Used as | Python libraries inside our internal service (`backend/python/ocr_service`) |

Optional fallback: [Tesseract](https://github.com/tesseract-ocr/tesseract) (Apache-2.0), used only if installed on the machine. PDFs are opened in the browser with [PDF.js](https://github.com/mozilla/pdf.js) (Apache-2.0) — only rendered pages are sent to be read. The editor uses [Tiptap](https://tiptap.dev) (MIT) and [docx](https://github.com/dolanmiu/docx) (MIT); text is set in Inter and Noto Sans/Serif (Devanagari) — SIL Open Font Licence, served by Google Fonts.

## Document tools — PDF processing

| | |
| --- | --- |
| Editing | [pdf-lib](https://github.com/Hopding/pdf-lib) (MIT) — merge, split, organize, rotate, images → PDF |
| Rendering | [pypdfium2](https://github.com/pypdfium2-team/pypdfium2) (Apache-2.0 / BSD-3-Clause) with [PDFium](https://pdfium.googlesource.com/pdfium/) (BSD-3-Clause), inside our internal service (`backend/python/rembg_service`) |
| Archives | [fflate](https://github.com/101arrowz/fflate) (MIT) — ZIP downloads, streamed |
| Compression | [pikepdf](https://github.com/pikepdf/pikepdf) (MPL-2.0) with [qpdf](https://github.com/qpdf/qpdf) (Apache-2.0), inside our internal service |
| Nepali stamps | [Noto Sans Devanagari](https://github.com/notofonts/devanagari) (SIL Open Font License 1.1; licence in `backend/assets/fonts/OFL.txt`), shaped by HarfBuzz/Pango through sharp (LGPL-3.0 libvips, dynamically linked) |
| Previews | PDF.js (Apache-2.0), in the browser |

## Whiteboard — Excalidraw

| | |
| --- | --- |
| Project | [Excalidraw](https://github.com/excalidraw/excalidraw), npm package [`@excalidraw/excalidraw`](https://www.npmjs.com/package/@excalidraw/excalidraw) 0.18.1 |
| Licence | MIT — Copyright (c) 2020 Excalidraw |
| Used as | Unmodified library, bundled into the `/whiteboard` page; runs only in the browser |
| Fonts | Copied unmodified from the package's `dist/prod/fonts` and served from this site: Excalifont, Virgil, Nunito, Lilita One, Cascadia Code, Liberation Sans, Xiaolai and Assistant (SIL Open Font License 1.1) and Comic Shanns (MIT). Check each font's upstream licence before redistributing them separately. |

The page is called **Whiteboard** and says it is part of Studio Tools; it is not the Excalidraw website and is not endorsed by it. The header, tool strip, menus and theme around the editor are Studio Tools' own; the drawing engine is used through its public API and is not modified. The More menu links to the Excalidraw project ("Built on Excalidraw (MIT licence)"). Excalidraw's own dependencies (bundled with it) include roughjs (MIT), perfect-freehand (MIT), Radix UI (MIT), jotai (MIT), browser-fs-access (Apache-2.0), pako (MIT and Zlib), pica (MIT) and @excalidraw/mermaid-to-excalidraw with Mermaid (MIT).

MIT licence (Excalidraw):

```
MIT License

Copyright (c) 2020 Excalidraw

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Frontend

UI built with [Untitled UI React](https://www.untitledui.com/react) (MIT), [React Aria Components](https://react-spectrum.adobe.com/react-aria/) (Apache-2.0), [Lucide](https://lucide.dev) (ISC) and Tailwind CSS (MIT). Landing-page photography is CC0 — see `frontend/src/assets/images/landing/CREDITS.md`.

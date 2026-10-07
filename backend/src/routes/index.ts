import { Router } from "express";
import { removeBackgroundHandler, removeBackgroundStatusHandler } from "../controllers/backgroundRemovalController.js";
import { compressHandler } from "../controllers/compressionController.js";
import { annotateHandler, protectHandler, toWordHandler, unlockHandler, compressHandler as compressPdfHandler, deleteJobHandler, fromImagesHandler, pageNumbersHandler, toTextHandler, watermarkHandler, getJobHandler, jobArchiveHandler, jobFileHandler, mergeHandler, organizeHandler, splitHandler, toImagesHandler } from "../controllers/documentController.js";
import { getHealth, getProcessorHealth } from "../controllers/healthController.js";
import { ocrHandler } from "../controllers/ocrController.js";
import { adjustCropHandler, convertHandler, fileHandler, presetsHandler, processHandler, sheetHandler } from "../controllers/photoGeneratorController.js";
import { upscaleHandler } from "../controllers/upscaleController.js";
import { retouchHandler } from "../controllers/retouchController.js";
import { detectWatermarkHandler, removeWatermarkHandler } from "../controllers/watermarkController.js";
import { processingRateLimiter } from "../middleware/rateLimiter.js";
import { documentUpload } from "../middleware/documentUpload.js";
import { uploadImage, uploadPhoto, uploadRetouch } from "../middleware/upload.js";

export const apiRouter = Router();

apiRouter.get("/health", getHealth);
apiRouter.get("/health/processors", getProcessorHealth);
apiRouter.post("/remove-background", processingRateLimiter, uploadImage, removeBackgroundHandler);
apiRouter.get("/remove-bg/status", removeBackgroundStatusHandler);
apiRouter.post("/upscale", processingRateLimiter, uploadImage, upscaleHandler);
apiRouter.post("/retouch", processingRateLimiter, uploadRetouch, retouchHandler);
apiRouter.post("/convert", processingRateLimiter, uploadPhoto, convertHandler);

apiRouter.get("/photo-generator/presets", presetsHandler);
apiRouter.post("/photo-generator/process", processingRateLimiter, uploadPhoto, processHandler);
apiRouter.post("/photo-generator/adjust", adjustCropHandler);
apiRouter.post("/photo-generator/sheet", sheetHandler);
apiRouter.get("/photo-generator/files/:id", fileHandler);
apiRouter.post("/compress", processingRateLimiter, uploadImage, compressHandler);

apiRouter.post("/watermark/detect", processingRateLimiter, uploadImage, detectWatermarkHandler);
apiRouter.post("/watermark/remove", processingRateLimiter, uploadRetouch, removeWatermarkHandler);
apiRouter.post("/ocr", processingRateLimiter, uploadPhoto, ocrHandler);

// Document tools: each request starts a job (202) that the client follows at /jobs/:id.
apiRouter.post("/pdf/merge", processingRateLimiter, documentUpload("pdf", { min: 2 }), mergeHandler);
apiRouter.post("/pdf/split", processingRateLimiter, documentUpload("pdf", { max: 1 }), splitHandler);
apiRouter.post("/pdf/organize", processingRateLimiter, documentUpload("pdf", { max: 1 }), organizeHandler);
apiRouter.post("/pdf/to-images", processingRateLimiter, documentUpload("pdf", { max: 1 }), toImagesHandler);
apiRouter.post("/pdf/from-images", processingRateLimiter, documentUpload("image"), fromImagesHandler);
apiRouter.post("/pdf/compress", processingRateLimiter, documentUpload("pdf", { max: 1 }), compressPdfHandler);
apiRouter.post("/pdf/watermark", processingRateLimiter, documentUpload("pdf", { max: 1, withImage: true }), watermarkHandler);
apiRouter.post("/pdf/page-numbers", processingRateLimiter, documentUpload("pdf", { max: 1 }), pageNumbersHandler);
apiRouter.post("/pdf/to-text", processingRateLimiter, documentUpload("pdf", { max: 1 }), toTextHandler);
apiRouter.post("/pdf/to-word", processingRateLimiter, documentUpload("pdf", { max: 1 }), toWordHandler);
apiRouter.post("/pdf/protect", processingRateLimiter, documentUpload("pdf", { max: 1 }), protectHandler);
apiRouter.post("/pdf/unlock", processingRateLimiter, documentUpload("pdf", { max: 1 }), unlockHandler);
apiRouter.post("/pdf/annotate", processingRateLimiter, documentUpload("pdf", { max: 1, withImages: 40 }), annotateHandler);
apiRouter.get("/jobs/:id", getJobHandler);
apiRouter.delete("/jobs/:id", deleteJobHandler);
apiRouter.get("/jobs/:id/files/:fileId", jobFileHandler);
apiRouter.get("/jobs/:id/archive", jobArchiveHandler);

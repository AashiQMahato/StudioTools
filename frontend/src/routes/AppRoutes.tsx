import { lazy, type ReactNode, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { ROUTES } from "@/lib/constants/routes";
import { CropperPage } from "@/pages/Cropper/CropperPage";
import { EditorPage } from "@/pages/Editor/EditorPage";
import { HomePage } from "@/pages/Home/HomePage";
import { RemoveBackgroundPage } from "@/pages/RemoveBackground/RemoveBackgroundPage";
import { CompressorPage } from "@/pages/Compressor/CompressorPage";
import { PhotoGeneratorPage } from "@/pages/PhotoGenerator/PhotoGeneratorPage";
import { RetouchPage } from "@/pages/Retouch/RetouchPage";
import { UpscalerPage } from "@/pages/Upscaler/UpscalerPage";
import { WatermarkRemoverPage } from "@/pages/WatermarkRemover/WatermarkRemoverPage";

// The OCR editor brings a rich-text editor with it; only its own page loads that.
const OcrPage = lazy(() => import("@/pages/Ocr/OcrPage").then((module) => ({ default: module.OcrPage })));
// The document tools share pdf.js previews and their own components: loaded when one opens.
const ImageToolsPage = lazy(() => import("@/pages/ImageTools/ImageToolsPage").then((module) => ({ default: module.ImageToolsPage })));
const DocumentsPage = lazy(() => import("@/pages/Documents/DocumentsPage").then((module) => ({ default: module.DocumentsPage })));
const MergePage = lazy(() => import("@/pages/Pdf/MergePage").then((module) => ({ default: module.MergePage })));
const SplitPage = lazy(() => import("@/pages/Pdf/SplitPage").then((module) => ({ default: module.SplitPage })));
const OrganizePage = lazy(() => import("@/pages/Pdf/OrganizePage").then((module) => ({ default: module.OrganizePage })));
const RotatePage = lazy(() => import("@/pages/Pdf/OrganizePage").then((module) => ({ default: module.RotatePage })));
const ToImagesPage = lazy(() => import("@/pages/Pdf/ToImagesPage").then((module) => ({ default: module.ToImagesPage })));
const CompressPdfPage = lazy(() => import("@/pages/Pdf/CompressPage").then((module) => ({ default: module.CompressPage })));
const WatermarkPage = lazy(() => import("@/pages/Pdf/WatermarkPage").then((module) => ({ default: module.WatermarkPage })));
const PageNumbersPage = lazy(() => import("@/pages/Pdf/PageNumbersPage").then((module) => ({ default: module.PageNumbersPage })));
const ToWordPage = lazy(() => import("@/pages/Pdf/ToWordPage").then((module) => ({ default: module.ToWordPage })));
const ViewerPage = lazy(() => import("@/pages/Pdf/ViewerPage").then((module) => ({ default: module.ViewerPage })));
const PdfEditorPage = lazy(() => import("@/pages/Pdf/EditorPage").then((module) => ({ default: module.EditorPage })));
const SignPage = lazy(() => import("@/pages/Pdf/SignPage").then((module) => ({ default: module.SignPage })));
const ProtectPage = lazy(() => import("@/pages/Pdf/ProtectPage").then((module) => ({ default: module.ProtectPage })));
const UnlockPage = lazy(() => import("@/pages/Pdf/UnlockPage").then((module) => ({ default: module.UnlockPage })));
const ToTextPage = lazy(() => import("@/pages/Pdf/ToTextPage").then((module) => ({ default: module.ToTextPage })));
const TextEditorPage = lazy(() => import("@/pages/Text/TextPages").then((module) => ({ default: module.TextEditorPage })));
const TextCleanerPage = lazy(() => import("@/pages/Text/TextPages").then((module) => ({ default: module.TextCleanerPage })));
const CaseConverterPage = lazy(() => import("@/pages/Text/TextPages").then((module) => ({ default: module.CaseConverterPage })));
const WordCounterPage = lazy(() => import("@/pages/Text/TextPages").then((module) => ({ default: module.WordCounterPage })));
const ImagesToPdfPage = lazy(() => import("@/pages/Pdf/ImagesToPdfPage").then((module) => ({ default: module.ImagesToPdfPage })));

const later = (page: ReactNode) => <Suspense fallback={null}>{page}</Suspense>;

export function AppRoutes() {
    return (
        <Routes>
            <Route element={<AppLayout />}>
                <Route path={ROUTES.home} element={<HomePage />} />
                <Route path={ROUTES.removeBackground} element={<RemoveBackgroundPage />} />
                <Route path={ROUTES.upscale} element={<UpscalerPage />} />
                <Route path={ROUTES.retouch} element={<RetouchPage />} />
                <Route path={ROUTES.photoGenerator} element={<PhotoGeneratorPage />} />
                <Route path={ROUTES.watermarkRemover} element={<WatermarkRemoverPage />} />
                <Route path={ROUTES.ocr} element={later(<OcrPage />)} />
                <Route path={ROUTES.imageTools} element={later(<ImageToolsPage />)} />
                <Route path={ROUTES.documents} element={later(<DocumentsPage />)} />
                <Route path={ROUTES.pdfMerge} element={later(<MergePage />)} />
                <Route path={ROUTES.pdfSplit} element={later(<SplitPage />)} />
                <Route path={ROUTES.pdfOrganize} element={later(<OrganizePage />)} />
                <Route path={ROUTES.pdfRotate} element={later(<RotatePage />)} />
                <Route path={ROUTES.pdfToImages} element={later(<ToImagesPage />)} />
                <Route path={ROUTES.imagesToPdf} element={later(<ImagesToPdfPage />)} />
                <Route path={ROUTES.pdfCompress} element={later(<CompressPdfPage />)} />
                <Route path={ROUTES.pdfWatermark} element={later(<WatermarkPage />)} />
                <Route path={ROUTES.pdfPageNumbers} element={later(<PageNumbersPage />)} />
                <Route path={ROUTES.pdfToText} element={later(<ToTextPage />)} />
                <Route path={ROUTES.pdfToWord} element={later(<ToWordPage />)} />
                <Route path={ROUTES.pdfViewer} element={later(<ViewerPage />)} />
                <Route path={ROUTES.pdfEditor} element={later(<PdfEditorPage />)} />
                <Route path={ROUTES.pdfSign} element={later(<SignPage />)} />
                <Route path={ROUTES.pdfProtect} element={later(<ProtectPage />)} />
                <Route path={ROUTES.pdfUnlock} element={later(<UnlockPage />)} />
                <Route path={ROUTES.textEditor} element={later(<TextEditorPage />)} />
                <Route path={ROUTES.textCleaner} element={later(<TextCleanerPage />)} />
                <Route path={ROUTES.caseConverter} element={later(<CaseConverterPage />)} />
                <Route path={ROUTES.wordCounter} element={later(<WordCounterPage />)} />
                <Route path={ROUTES.compress} element={<CompressorPage />} />
                <Route path={ROUTES.crop} element={<CropperPage />} />
                <Route path={ROUTES.editor} element={<EditorPage />} />
                <Route path="*" element={<Navigate to={ROUTES.home} replace />} />
            </Route>
        </Routes>
    );
}

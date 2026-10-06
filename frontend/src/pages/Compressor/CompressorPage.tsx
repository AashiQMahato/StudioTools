import { Check, Download, RotateCcw, Shrink } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Notice, PanelBody, PanelIntro, StudioActions, StudioCanvas, StudioDropzone, StudioNotice } from "@/components/studio/StudioParts";
import { StudioShell } from "@/components/studio/StudioShell";
import { Button } from "@/components/ui/base/buttons/button";
import { CompressionPreview, type PreviewMode, ResultSummary } from "@/features/compressor/CompressionPreview";
import { CompressionSettings } from "@/features/compressor/CompressionSettings";
import { ImageList } from "@/features/compressor/ImageList";
import { DEFAULT_SETTINGS } from "@/features/compressor/settings";
import { MAX_ITEMS, settingsKey, useCompressionQueue } from "@/features/compressor/useCompressionQueue";
import { formatBytes } from "@/features/image-processing/format";
import { prepareImageFile } from "@/hooks/useImageUpload";
import type { CompressSettings } from "@/lib/api/compressApi";
import { downloadFile } from "@/lib/utils/download";
import { useToolImage } from "@/store/useImageStore";
import { errorMessage, useT } from "@/i18n";

export function CompressorPage() {
    const t = useT();
    const copy = t.compress;
    const { image } = useToolImage();
    const queue = useCompressionQueue();
    const { items, add, remove, clear, compressAll } = queue;
    const [settings, setSettings] = useState<CompressSettings>(DEFAULT_SETTINGS);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [mode, setMode] = useState<PreviewMode>("split");
    const [running, setRunning] = useState(false);
    const [notice, setNotice] = useState<Notice | null>(null);
    const [downloaded, setDownloaded] = useState<string | null>(null);
    const key = settingsKey(settings);

    // The image the user already has open elsewhere starts the list.
    const seeded = useRef(false);
    useEffect(() => {
        if (seeded.current || !image) return;
        seeded.current = true;
        void add([{ file: image.file, dimensions: image.dimensions }]).then(({ added }) => setSelectedId((current) => current ?? added[0] ?? null));
    }, [image, add]);

    /** Picked, dropped or pasted files: checked (and HEIC converted) one by one, then listed. */
    const receive = useCallback(
        async (files: File[]) => {
            const ready: { file: File; dimensions: { width: number; height: number } }[] = [];
            let problem: string | null = null;
            for (const file of files) {
                const prepared = await prepareImageFile(file, t, (status) => status && setNotice({ tone: "info", text: status }));
                if (prepared.ok) ready.push(prepared);
                else problem = `${file.name}: ${prepared.error}`;
            }
            const { added, skipped } = await add(ready);
            setSelectedId((current) => current ?? added[0] ?? null);
            setNotice(skipped ? { tone: "info", text: copy.tooMany(MAX_ITEMS) } : problem ? { tone: "error", text: problem } : null);
        },
        [add, copy, t],
    );

    const selected = items.find((item) => item.id === selectedId) ?? items[0] ?? null;
    const done = items.filter((item) => item.status === "done" && item.result?.settingsKey === key);
    const pending = items.filter((item) => item.status !== "processing" && item.result?.settingsKey !== key);
    const mayHaveAlpha = items.some((item) => item.mimeType !== "image/jpeg");
    const totals = useMemo(() => {
        const original = done.reduce((sum, item) => sum + item.result!.originalSize, 0);
        const compressed = done.reduce((sum, item) => sum + item.result!.size, 0);
        return { original, compressed, saved: original - compressed };
    }, [done]);

    const run = async () => {
        setRunning(true);
        setNotice(null);
        await compressAll(settings);
        setRunning(false);
    };

    useEffect(() => {
        if (!downloaded) return;
        const timer = window.setTimeout(() => setDownloaded(null), 2200);
        return () => window.clearTimeout(timer);
    }, [downloaded]);

    const download = (ids: string[]) => {
        const chosen = items.filter((item) => ids.includes(item.id) && item.result);
        // No archive service on this server: each file downloads on its own, a moment apart.
        chosen.forEach((item, index) => window.setTimeout(() => downloadFile(item.result!.url, item.result!.fileName), index * 350));
        if (chosen.length === 1) setNotice({ tone: "success", text: copy.downloaded(chosen[0]!.result!.fileName) });
        setDownloaded(ids.length > 1 ? "all" : (ids[0] ?? null));
    };

    const startOver = () => {
        clear();
        setSelectedId(null);
        setNotice(null);
    };

    // ------------------------------------------------------------------ status line
    const status: Notice | null =
        notice ??
        (selected?.status === "error"
            ? { tone: "error", text: selected.error?.code && t.errors[selected.error.code] ? errorMessage(t, selected.error) : copy.failed }
            : items.length > 1 && done.length > 0
              ? { tone: "success", text: `${copy.summary(done.length, items.length)} · ${copy.batchSaved(formatBytes(Math.max(0, totals.saved)), Math.round((Math.max(0, totals.saved) / Math.max(1, totals.original)) * 100))}` }
              : null);

    const panel = (
        <PanelBody>
            {items.length > 0 && (
                <ImageList
                    items={items}
                    selectedId={selected?.id ?? null}
                    currentKey={key}
                    onSelect={setSelectedId}
                    onRemove={(id) => {
                        remove(id);
                        if (id === selectedId) setSelectedId(null);
                    }}
                    disabled={running}
                />
            )}
            <CompressionSettings settings={settings} onChange={setSettings} mayHaveAlpha={mayHaveAlpha} disabled={running} />
            {items.length === 0 && <PanelIntro title={t.studio.howItWorks} steps={t.studio.intros.compressor.steps} />}
        </PanelBody>
    );

    const allDone = done.length === items.length && items.length > 0;
    const actions =
        items.length === 0 ? null : (
            <>
                <Button size="lg" color="tertiary" iconLeading={RotateCcw} onPress={startOver} isDisabled={running} className="press-scale pointer-coarse:min-h-12">
                    {copy.startOver}
                </Button>
                {done.length > 1 && (
                    <Button size="lg" color="secondary" iconLeading={downloaded === "all" ? Check : Download} onPress={() => download(done.map((item) => item.id))} className="press-scale pointer-coarse:min-h-12">
                        {copy.downloadAll(done.length)}
                    </Button>
                )}
                {selected?.result && selected.result.settingsKey === key && (
                    <Button size="lg" color={allDone ? "primary" : "secondary"} iconLeading={downloaded === selected.id ? Check : Download} onPress={() => download([selected.id])} className="press-scale pointer-coarse:min-h-12">
                        {copy.download}
                    </Button>
                )}
                {!allDone && (
                    <Button size="lg" color="primary" iconLeading={Shrink} onPress={() => void run()} isDisabled={running || pending.length === 0} className="press-scale pointer-coarse:min-h-12">
                        {running ? copy.compressing : done.length > 0 || items.some((item) => item.result) ? copy.compressAgain : copy.compressAll(pending.length)}
                    </Button>
                )}
            </>
        );

    return (
        <StudioShell tool="compressor" hasWork={items.length > 0} panel={panel} panelLabel={copy.controlsLabel} onFiles={(files) => void receive(files)}>
            <StudioCanvas>
                {selected ? <CompressionPreview key={selected.id} item={selected} mode={mode} onModeChange={setMode} /> : <StudioDropzone title={copy.dropTitle} hint={copy.dropHint} />}
            </StudioCanvas>
            {selected?.result && selected.result.settingsKey === key && <ResultSummary item={selected} settings={settings} />}
            {status && <StudioNotice notice={status} />}
            {actions && <StudioActions>{actions}</StudioActions>}
        </StudioShell>
    );
}

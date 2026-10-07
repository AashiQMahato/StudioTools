import { LockKeyhole } from "lucide-react";
import { useMemo, useState } from "react";
import { DocumentToolLayout } from "@/features/documents/DocumentToolLayout";
import { MAX_PDF_MB, PDF_ACCEPT } from "@/features/documents/limits";
import { PageGrid, type PageItem } from "@/features/documents/PageGrid";
import { PasswordField } from "@/features/documents/PasswordField";
import { PdfFileSummary, SinglePdfWorkspace } from "@/features/documents/SinglePdfWorkspace";
import { useDocumentJob } from "@/features/documents/useDocumentJob";
import { useSinglePdf } from "@/features/documents/useSinglePdf";
import { useT } from "@/i18n";

type Permission = "allowPrint" | "allowCopy" | "allowEdit";

export function ProtectPage() {
    const t = useT();
    const copy = t.documents.protect;
    const job = useDocumentJob();
    const pdf = useSinglePdf();
    const [password, setPassword] = useState("");
    const [confirm, setConfirm] = useState("");
    const [permissions, setPermissions] = useState<Record<Permission, boolean>>({ allowPrint: true, allowCopy: false, allowEdit: false });
    const count = pdf.ready?.sizes.length ?? 0;
    const items = useMemo<PageItem[]>(() => Array.from({ length: count }, (_, index) => ({ key: String(index + 1), page: index + 1, rotate: 0 })), [count]);
    const mismatch = confirm.length > 0 && confirm !== password;

    const protect = () => {
        if (!pdf.file || !password || password !== confirm) return;
        const form = new FormData();
        form.append("password", password);
        for (const [key, value] of Object.entries(permissions)) form.append(key, String(value));
        form.append("files", pdf.file, pdf.file.name);
        void job.run("/pdf/protect", form);
    };
    const startOver = () => {
        job.reset();
        pdf.clear();
        setPassword("");
        setConfirm("");
    };

    return (
        <DocumentToolLayout
            tool="pdfProtect"
            accept={PDF_ACCEPT}
            onFiles={pdf.receive}
            empty={!pdf.file}
            drop={{ title: t.documents.dropPdf, hint: copy.hint, limits: t.documents.pdfLimits(MAX_PDF_MB) }}
            intro={copy.steps}
            job={job}
            runningTitle={copy.running}
            doneTitle={copy.done}
            onStartOver={startOver}
            notice={pdf.problem ? { tone: "error", text: pdf.problem } : null}
            result={<p className="text-sm text-tertiary">{copy.remember}</p>}
            options={
                <>
                    <PdfFileSummary name={pdf.file?.name ?? ""} pages={count || null} />
                    <section className="flex flex-col gap-3">
                        <PasswordField label={copy.password} value={password} onChange={setPassword} hint={password && password.length < 6 ? copy.short : undefined} />
                        <PasswordField label={copy.confirm} value={confirm} onChange={setConfirm} invalid={mismatch ? copy.mismatch : null} />
                    </section>
                    <section className="flex flex-col gap-3">
                        <h3 className="text-sm font-semibold text-primary">{copy.permissions}</h3>
                        <ul className="flex flex-col gap-2.5">
                            {(["allowPrint", "allowCopy", "allowEdit"] as const).map((key) => (
                                <li key={key}>
                                    <label className="flex cursor-pointer items-start gap-2.5 text-sm text-secondary">
                                        <input type="checkbox" checked={permissions[key]} onChange={(event) => setPermissions((all) => ({ ...all, [key]: event.target.checked }))} className="mt-0.5 size-4 shrink-0 accent-[var(--brand)]" />
                                        <span className="min-w-0 flex-1">{copy.allow[key].title}</span>
                                    </label>
                                </li>
                            ))}
                        </ul>
                    </section>
                    <section className="flex flex-col gap-1.5 rounded-xl border border-[var(--card-line)] bg-secondary px-3 py-2.5 text-xs leading-relaxed text-secondary">
                        <p>{copy.explainOpen}</p>
                        <p>{copy.explainPermissions}</p>
                        <p className="font-medium text-primary">{copy.noRecovery}</p>
                    </section>
                </>
            }
            action={{ label: copy.action, icon: LockKeyhole, onPress: protect, disabled: !pdf.ready || !password || password !== confirm }}
        >
            <SinglePdfWorkspace pdf={pdf}>{({ document, sizes }) => <PageGrid document={document} sizes={sizes} items={items} label={copy.gridLabel} />}</SinglePdfWorkspace>
        </DocumentToolLayout>
    );
}

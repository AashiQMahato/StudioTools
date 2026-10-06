import { documentMenu, imageMenu } from "@/components/layout/toolMenus";
import { DocumentsArt } from "@/features/tool-suite/HeroArt";
import { ToolSuitePage } from "@/features/tool-suite/ToolSuitePage";
import { useT } from "@/i18n";

/** The document suite's front door. */
export function DocumentsPage() {
    const copy = useT().documents.landing;
    return <ToolSuitePage menu={documentMenu} other={imageMenu} copy={copy} groups={{ own: copy.groups.documents, other: copy.groups.image }} art={<DocumentsArt note={copy.artNote} />} />;
}

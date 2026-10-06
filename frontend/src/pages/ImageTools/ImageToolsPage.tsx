import { documentMenu, imageMenu } from "@/components/layout/toolMenus";
import { ImagesArt } from "@/features/tool-suite/HeroArt";
import { ToolSuitePage } from "@/features/tool-suite/ToolSuitePage";
import { useT } from "@/i18n";

/** The image suite's front door. */
export function ImageToolsPage() {
    const t = useT();
    const copy = t.imageTools.landing;
    const groups = t.documents.landing.groups;
    return <ToolSuitePage menu={imageMenu} other={documentMenu} copy={copy} groups={{ own: groups.image, other: groups.documents }} art={<ImagesArt note={copy.artNote} />} />;
}

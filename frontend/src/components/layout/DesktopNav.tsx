import { FileText, LayoutGrid, Sparkles } from "lucide-react";
import { useLocation } from "react-router-dom";
import { DOCUMENT_ROUTES, TOOL_ROUTES } from "@/lib/constants/navigation";
import { ROUTES } from "@/lib/constants/routes";
import { useT } from "@/i18n";
import { NavDropdown } from "./NavDropdown";
import { NavItem } from "./NavItem";
import { AiStudioMenu, ToolsMegaMenu } from "./NavMenus";
import { AI_ROUTES } from "./toolRegistry";

/** Three entries only — Tools, AI Studio, PDF Tools — so the bar stays calm however many tools there are. */
export function DesktopNav({ className }: { className?: string }) {
    const t = useT();
    const { pathname } = useLocation();
    const aiCurrent = AI_ROUTES.includes(pathname);
    const toolsCurrent = (TOOL_ROUTES as readonly string[]).includes(pathname) && !aiCurrent;

    return (
        <nav aria-label={t.nav.main} className={className}>
            <ul className="flex items-center gap-1">
                <li>
                    <NavDropdown label={<span className="flex items-center gap-2"><LayoutGrid className="size-4" aria-hidden />{t.nav.mega.tools}</span>} current={toolsCurrent}>
                        {(panel) => <ToolsMegaMenu {...panel} />}
                    </NavDropdown>
                </li>
                {/* Its own positioning context: the small panel hangs from this trigger, not from the bar's centre. */}
                <li className="relative">
                    <NavDropdown label={<span className="flex items-center gap-2"><Sparkles className="size-4" aria-hidden />{t.nav.mega.aiStudio}</span>} current={aiCurrent}>
                        {(panel) => <AiStudioMenu {...panel} />}
                    </NavDropdown>
                </li>
                <li>
                    <NavItem href={ROUTES.documents} active={(DOCUMENT_ROUTES as readonly string[]).includes(pathname)}>
                        <span className="flex items-center gap-2">
                            <FileText className="size-4" aria-hidden />
                            {t.nav.mega.pdfTools}
                        </span>
                    </NavItem>
                </li>
            </ul>
        </nav>
    );
}

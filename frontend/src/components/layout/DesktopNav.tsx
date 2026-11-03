import { FileText, ImageIcon, Presentation } from "lucide-react";
import { useLocation } from "react-router-dom";
import { DOCUMENT_ROUTES, TOOL_ROUTES } from "@/lib/constants/navigation";
import { ROUTES } from "@/lib/constants/routes";
import { useT } from "@/i18n";
import { MegaMenu } from "./MegaMenu";
import { NavDropdown } from "./NavDropdown";
import { NavItem } from "./NavItem";
import { documentMenu, imageMenu } from "./toolMenus";

/**
 * Three destinations — Image Tools, Documents, Whiteboard — so the bar stays calm however many tools
 * there are. The two suites open their menus on hover or ↓; a click goes to the suite's own page.
 */
export function DesktopNav({ className }: { className?: string }) {
    const t = useT();
    const { pathname } = useLocation();
    const label = (Icon: typeof FileText, text: string) => (
        <span className="flex items-center gap-2">
            <Icon className="size-4 opacity-70" strokeWidth={1.9} aria-hidden />
            {text}
        </span>
    );

    return (
        <nav aria-label={t.nav.main} className={className}>
            <ul className="flex items-center gap-0.5">
                <li>
                    <NavDropdown label={label(ImageIcon, t.nav.tools)} href={ROUTES.imageTools} current={(TOOL_ROUTES as readonly string[]).includes(pathname)}>
                        {(panel) => <MegaMenu menu={imageMenu} {...panel} />}
                    </NavDropdown>
                </li>
                <li>
                    <NavDropdown label={label(FileText, t.nav.documents)} href={ROUTES.documents} current={(DOCUMENT_ROUTES as readonly string[]).includes(pathname)}>
                        {(panel) => <MegaMenu menu={documentMenu} {...panel} />}
                    </NavDropdown>
                </li>
                <li>
                    <NavItem href={ROUTES.whiteboard} active={pathname === ROUTES.whiteboard}>
                        {label(Presentation, t.nav.mega.whiteboard)}
                    </NavItem>
                </li>
            </ul>
        </nav>
    );
}

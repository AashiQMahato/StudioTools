import { useLocation } from "react-router-dom";
import { SECTION_LINKS, type SectionKey, DOCUMENT_ROUTES, TOOL_ROUTES } from "@/lib/constants/navigation";
import { ROUTES } from "@/lib/constants/routes";
import { cn } from "@/lib/utils/cn";
import { useT } from "@/i18n";
import { NavDropdown } from "./NavDropdown";
import { NavItem } from "./NavItem";
import { scrollToSection, sectionHref } from "./sections";
import { MegaMenu } from "./MegaMenu";
import { documentMenu, imageMenu } from "./toolMenus";

interface DesktopNavProps {
    activeSection: SectionKey | null;
    className?: string;
}

export function DesktopNav({ activeSection, className }: DesktopNavProps) {
    const t = useT();
    const { pathname } = useLocation();
    const toolsCurrent = (TOOL_ROUTES as readonly string[]).includes(pathname);

    return (
        <nav aria-label={t.nav.main} className={cn("relative", className)}>
            <ul className="flex items-center gap-1">
                <li>
                    <NavDropdown label={t.nav.tools} href={ROUTES.imageTools} current={toolsCurrent}>
                        {(panel) => <MegaMenu menu={imageMenu} {...panel} />}
                    </NavDropdown>
                </li>
                <li>
                    <NavDropdown label={t.nav.documents} href={ROUTES.documents} current={(DOCUMENT_ROUTES as readonly string[]).includes(pathname)}>
                        {(panel) => <MegaMenu menu={documentMenu} {...panel} />}
                    </NavDropdown>
                </li>
                {SECTION_LINKS.map((link) => (
                    <li key={link.key}>
                        <NavItem href={sectionHref(link.id)} active={activeSection === link.key} onNavigate={() => scrollToSection(link.id)}>
                            {t.nav[link.key]}
                        </NavItem>
                    </li>
                ))}
            </ul>
        </nav>
    );
}

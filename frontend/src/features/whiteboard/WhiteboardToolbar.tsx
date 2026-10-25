import type { ToolType } from "@excalidraw/excalidraw/types";
import { Circle, Diamond, Eraser, Frame, Globe, Hand, ImagePlus, Lock, LockOpen, type LucideIcon, Minus, MousePointer2, MoveRight, Pencil, Shapes, Square, Type, WandSparkles, Workflow } from "lucide-react";
import { MenuTrigger, Toolbar } from "react-aria-components";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils/cn";
import { MenuPopover, ToolButton, WbMenu, WbMenuItem } from "./ui";

type ToolKey = keyof ReturnType<typeof useT>["whiteboard"]["tools"];

interface ToolDef {
    type: Extract<ToolType, ToolKey>;
    icon: LucideIcon;
    /** The editor's own shortcuts for it (they keep working; this only shows them). */
    shortcut?: string;
}

/** The editor's tools in three groups — navigate, shapes, then draw/write/insert/erase — in its own order. */
const TOOL_GROUPS: readonly (readonly ToolDef[])[] = [
    [
        { type: "selection", icon: MousePointer2, shortcut: "V" },
        { type: "hand", icon: Hand, shortcut: "H" },
    ],
    [
        { type: "rectangle", icon: Square, shortcut: "R" },
        { type: "diamond", icon: Diamond, shortcut: "D" },
        { type: "ellipse", icon: Circle, shortcut: "O" },
        { type: "arrow", icon: MoveRight, shortcut: "A" },
        { type: "line", icon: Minus, shortcut: "L" },
    ],
    [
        { type: "freedraw", icon: Pencil, shortcut: "P" },
        { type: "text", icon: Type, shortcut: "T" },
        { type: "image", icon: ImagePlus, shortcut: "9" },
        { type: "eraser", icon: Eraser, shortcut: "E" },
    ],
];

/** Less common tools, in a menu: frames, web embeds, the laser pointer, and Mermaid diagrams. */
const EXTRA_TOOLS: readonly ToolDef[] = [
    { type: "frame", icon: Frame, shortcut: "F" },
    { type: "embeddable", icon: Globe },
    { type: "laser", icon: WandSparkles, shortcut: "K" },
];
const EXTRA_TYPES: readonly ToolType[] = EXTRA_TOOLS.map((tool) => tool.type);

interface ToolbarProps {
    activeTool: ToolType;
    locked: boolean;
    onSelect: (tool: ToolType) => void;
    onToggleLock: () => void;
    onMermaid: () => void;
    /** "rail" beside the canvas on wide screens, "row" above it on narrow ones. */
    layout: "rail" | "row";
}

/**
 * The drawing tools as a docked strip that belongs to the page rather than floating on the canvas:
 * a vertical rail on wide screens, a scrollable row on narrow ones. Each tool is a toggle that is
 * pressed while active, with its name and shortcut in a tooltip.
 */
export function WhiteboardToolbar({ activeTool, locked, onSelect, onToggleLock, onMermaid, layout }: ToolbarProps) {
    const t = useT().whiteboard.tools;
    const rail = layout === "rail";
    const tipPlacement = rail ? "end" : "bottom";
    const extraActive = EXTRA_TYPES.includes(activeTool);
    const ExtraIcon = EXTRA_TOOLS.find((tool) => tool.type === activeTool)?.icon ?? Shapes;
    const divider = <span aria-hidden className={cn("shrink-0 bg-[var(--color-border-secondary)]", rail ? "my-1 h-px w-6" : "mx-1 h-6 w-px")} />;

    return (
        <Toolbar
            aria-label={t.label}
            orientation={rail ? "vertical" : "horizontal"}
            className={cn(
                "whiteboard-toolbar flex shrink-0 items-center gap-1 bg-primary",
                rail ? "w-14 flex-col border-r border-secondary py-2" : "h-12 flex-row overflow-x-auto border-b border-secondary px-2 [scrollbar-width:none]",
            )}
        >
            {TOOL_GROUPS.map((group, index) => (
                <div key={index} className="contents">
                    {index > 0 && divider}
                    {group.map((tool) => (
                        <ToolButton
                            key={tool.type}
                            icon={tool.icon}
                            label={t[tool.type]}
                            shortcut={tool.shortcut}
                            tipPlacement={tipPlacement}
                            isSelected={activeTool === tool.type}
                            // A second press on the image tool opens the picker again, like the editor's own button.
                            onChange={() => onSelect(tool.type)}
                        />
                    ))}
                </div>
            ))}
            {divider}
            <MenuTrigger>
                <ToolButton icon={ExtraIcon} label={t.more} tipPlacement={tipPlacement} isSelected={extraActive} />
                <MenuPopover placement={rail ? "end top" : "bottom"}>
                    <WbMenu
                        aria-label={t.more}
                        onAction={(key) => (key === "mermaid" ? onMermaid() : onSelect(key as ToolType))}
                    >
                        {EXTRA_TOOLS.map((tool) => (
                            <WbMenuItem key={tool.type} id={tool.type} icon={tool.icon} shortcut={tool.shortcut} checked={activeTool === tool.type}>
                                {t[tool.type]}
                            </WbMenuItem>
                        ))}
                        <WbMenuItem id="mermaid" icon={Workflow}>
                            {t.mermaid}
                        </WbMenuItem>
                    </WbMenu>
                </MenuPopover>
            </MenuTrigger>
            <span aria-hidden className={cn(rail ? "flex-1" : "min-w-2 flex-1")} />
            <ToolButton icon={locked ? Lock : LockOpen} label={t.lock} shortcut="Q" tipPlacement={tipPlacement} isSelected={locked} onChange={onToggleLock} />
        </Toolbar>
    );
}

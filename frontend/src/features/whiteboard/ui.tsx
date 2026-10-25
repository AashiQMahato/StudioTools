import type { LucideIcon } from "lucide-react";
import { Check, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import {
    Button,
    type ButtonProps,
    Dialog,
    Heading,
    Menu,
    MenuItem,
    type MenuItemProps,
    type MenuProps,
    Modal,
    ModalOverlay,
    Popover,
    type PopoverProps,
    Separator,
    ToggleButton,
    type ToggleButtonProps,
    Tooltip,
    TooltipTrigger,
} from "react-aria-components";
import { cn } from "@/lib/utils/cn";

/*
 * The whiteboard shell's controls: Studio Tools tokens (neutral surfaces, hairline borders, the brand
 * accent only for what's selected or focused) on React Aria, so menus, tooltips and dialogs get
 * keyboard support, focus management and screen-reader semantics for free.
 */

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
    return <kbd className={cn("rounded border border-secondary bg-secondary px-1 font-sans text-[0.6875rem] leading-4 font-medium text-tertiary", className)}>{children}</kbd>;
}

/** A short label with its keyboard shortcut, shown after a pause on hover or keyboard focus. */
export function Tip({ label, shortcut, placement = "bottom", children }: { label: string; shortcut?: string; placement?: PopoverProps["placement"]; children: ReactNode }) {
    return (
        <TooltipTrigger delay={450} closeDelay={0}>
            {children}
            <Tooltip
                placement={placement}
                offset={8}
                className="z-[2000] flex items-center gap-2 rounded-lg bg-[var(--color-text-primary)] px-2 py-1 text-xs font-medium text-[var(--color-bg-primary)] shadow-md entering:animate-in entering:fade-in exiting:animate-out exiting:fade-out"
            >
                {label}
                {shortcut && <span className="text-[0.6875rem] opacity-60">{shortcut}</span>}
            </Tooltip>
        </TooltipTrigger>
    );
}

const iconButton =
    "grid size-9 shrink-0 cursor-default place-items-center rounded-lg text-secondary outline-none transition-colors duration-100 hovered:bg-primary_hover hovered:text-primary pressed:bg-[var(--color-bg-active)] focus-visible:outline-2 focus-visible:outline-offset-[-1px] focus-visible:outline-[var(--brand)] disabled:text-[var(--color-fg-quaternary)] disabled:hover:bg-transparent pointer-coarse:size-10";

/** An icon-only button with a tooltip. */
export function IconButton({ icon: Icon, label, shortcut, className, tipPlacement, ...props }: ButtonProps & { icon: LucideIcon; label: string; shortcut?: string; tipPlacement?: PopoverProps["placement"] }) {
    return (
        <Tip label={label} shortcut={shortcut} placement={tipPlacement}>
            <Button aria-label={label} aria-keyshortcuts={shortcut} className={cn(iconButton, className as string)} {...props}>
                <Icon className="size-[1.125rem]" strokeWidth={1.75} aria-hidden />
            </Button>
        </Tip>
    );
}

/** A drawing tool: pressed while it's the active tool. */
export function ToolButton({ icon: Icon, label, shortcut, tipPlacement, className, ...props }: ToggleButtonProps & { icon: LucideIcon; label: string; shortcut?: string; tipPlacement?: PopoverProps["placement"] }) {
    return (
        <Tip label={label} shortcut={shortcut} placement={tipPlacement}>
            <ToggleButton
                aria-label={label}
                className={cn(
                    "relative grid size-10 shrink-0 cursor-default place-items-center rounded-lg text-secondary outline-none transition-colors duration-100",
                    "hovered:bg-primary_hover hovered:text-primary pressed:bg-[var(--color-bg-active)]",
                    "selected:bg-[var(--brand-soft)] selected:text-[var(--brand)] selected:shadow-[inset_0_0_0_1px_var(--brand-line)] selected:hovered:bg-[var(--brand-soft)]",
                    "focus-visible:outline-2 focus-visible:outline-offset-[-1px] focus-visible:outline-[var(--brand)]",
                    className as string,
                )}
                {...props}
            >
                <Icon className="size-[1.125rem]" strokeWidth={1.75} aria-hidden />
            </ToggleButton>
        </Tip>
    );
}

export const menuPopover = "min-w-56 overflow-auto rounded-xl border border-secondary bg-primary p-1 text-primary shadow-lg outline-none entering:animate-in entering:fade-in entering:zoom-in-[0.98] exiting:animate-out exiting:fade-out";

export function MenuPopover({ className, ...props }: PopoverProps) {
    return <Popover offset={6} className={cn(menuPopover, "z-[1500] max-h-[min(32rem,var(--visual-viewport-height))]", className as string)} {...props} />;
}

export function WbMenu<T extends object>({ className, ...props }: MenuProps<T>) {
    return <Menu className={cn("outline-none", className as string)} {...props} />;
}

/** A menu row: icon, label, then a shortcut, a check (for toggles) or a submenu arrow. */
export function WbMenuItem({ icon: Icon, children, shortcut, checked, submenu, swatch, className, ...props }: MenuItemProps & { icon?: LucideIcon; children: ReactNode; shortcut?: string; checked?: boolean; submenu?: boolean; swatch?: string }) {
    return (
        <MenuItem
            className={cn(
                "flex min-h-9 cursor-default items-center gap-2.5 rounded-lg px-2.5 text-sm text-secondary outline-none select-none",
                "focus:bg-primary_hover focus:text-primary disabled:text-[var(--color-fg-quaternary)] pointer-coarse:min-h-11",
                className as string,
            )}
            {...props}
        >
            {Icon && <Icon className="size-4 shrink-0 text-tertiary" strokeWidth={1.75} aria-hidden />}
            {swatch && <span aria-hidden className="size-4 shrink-0 rounded-full border border-primary" style={{ background: swatch }} />}
            <span className="min-w-0 flex-1 truncate">{children}</span>
            {shortcut && <span className="text-xs text-quaternary">{shortcut}</span>}
            {checked !== undefined && <Check className={cn("size-4 shrink-0 text-[var(--brand)]", !checked && "invisible")} aria-hidden />}
            {submenu && <ChevronRight className="size-4 shrink-0 text-quaternary" aria-hidden />}
        </MenuItem>
    );
}

export function MenuDivider() {
    return <Separator className="mx-1 my-1 h-px bg-[var(--color-border-secondary)]" />;
}

/** A small confirmation dialog: a title, one sentence, Cancel and the action. */
export function ConfirmDialog({ open, onOpenChange, title, body, confirm, cancel, onConfirm }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; body: string; confirm: string; cancel: string; onConfirm: () => void }) {
    return (
        <ModalOverlay isOpen={open} onOpenChange={onOpenChange} isDismissable className="fixed inset-0 z-[2000] grid place-items-center bg-overlay/30 p-4 entering:animate-in entering:fade-in exiting:animate-out exiting:fade-out">
            <Modal className="w-full max-w-sm rounded-2xl border border-secondary bg-primary p-5 text-primary shadow-xl entering:animate-in entering:zoom-in-[0.98]">
                <Dialog role="alertdialog" className="outline-none">
                    {({ close }) => (
                        <>
                            <Heading slot="title" className="text-md font-semibold text-primary">
                                {title}
                            </Heading>
                            <p className="mt-1.5 text-sm text-tertiary">{body}</p>
                            <div className="mt-5 flex justify-end gap-2">
                                <Button onPress={close} className="h-9 cursor-default rounded-lg border border-secondary px-3.5 text-sm font-medium text-secondary outline-none hovered:bg-primary_hover focus-visible:outline-2 focus-visible:outline-[var(--brand)]">
                                    {cancel}
                                </Button>
                                <Button
                                    autoFocus
                                    onPress={() => {
                                        onConfirm();
                                        close();
                                    }}
                                    className="h-9 cursor-default rounded-lg bg-[var(--color-bg-brand-solid)] px-3.5 text-sm font-semibold text-[var(--color-text-primary_on-brand)] outline-none hovered:bg-[var(--color-bg-brand-solid_hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)]"
                                >
                                    {confirm}
                                </Button>
                            </div>
                        </>
                    )}
                </Dialog>
            </Modal>
        </ModalOverlay>
    );
}

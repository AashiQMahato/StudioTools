import { type LucideIcon, Upload } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/base/buttons/button";
import { useImageUpload } from "@/hooks/useImageUpload";
import type { AppRoute } from "@/lib/constants/routes";
import { cn } from "@/lib/utils/cn";
import { useT } from "@/i18n";

interface UploadButtonProps {
    size?: "sm" | "md" | "lg" | "xl";
    className?: string;
    /** Classes for the button itself (e.g. shape), as opposed to its wrapper. */
    buttonClassName?: string;
    label?: string;
    showIcon?: boolean;
    /** Replaces the upload icon, and an optional icon after the label (the navbar's "Open Studio"). */
    icon?: LucideIcon;
    trailingIcon?: LucideIcon;
    /** Where to go after picking an image. Defaults to the background remover; `null` stays put. */
    navigateTo?: AppRoute | null;
    /** Show validation errors yourself (e.g. in place of a hint) instead of the built-in note. */
    onErrorChange?: (error: string | null) => void;
}

/** Primary "Upload image" action. Validation errors appear in a small note beneath the button. */
export function UploadButton({ size = "xl", className, buttonClassName, label, showIcon = true, icon, trailingIcon, onErrorChange, navigateTo }: UploadButtonProps) {
    const t = useT();
    const { openPicker, inputProps, error, clearError } = useImageUpload({ navigateTo });

    useEffect(() => {
        onErrorChange?.(error);
    }, [error, onErrorChange]);

    useEffect(() => {
        if (!error) return;
        const timeout = window.setTimeout(clearError, 5000);
        return () => window.clearTimeout(timeout);
    }, [error, clearError]);

    return (
        <span className={cn("relative inline-flex", className)}>
            <Button
                size={size}
                color="primary"
                iconLeading={showIcon ? (icon ?? Upload) : undefined}
                iconTrailing={trailingIcon}
                onPress={openPicker}
                className={cn("press-scale w-full", buttonClassName)}
            >
                {label ?? t.common.uploadImage}
            </Button>
            <input {...inputProps} aria-hidden />
            {!onErrorChange && (
            <span
                role="alert"
                className={cn(
                    "pointer-events-none absolute top-full left-1/2 mt-2 -translate-x-1/2 whitespace-nowrap text-xs font-medium text-error-primary transition-opacity duration-200",
                    error ? "opacity-100" : "opacity-0",
                )}
            >
                {error}
            </span>
            )}
        </span>
    );
}

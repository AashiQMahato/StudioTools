import type { ComponentProps } from "react";
import { StudioShell } from "@/components/studio/StudioShell";
import { isOrganizeMode } from "@/lib/constants/navigation";
import { ImageStoreContext, useNoImageStore } from "@/store/useImageStore";
import { OrganizeModeBar } from "./OrganizeModeBar";

/**
 * The studio frame for document tools. They manage their own files (PDFs, several images), so the
 * shared working image is neither shown nor replaced here; picked, dropped or pasted files come to
 * `onFiles`.
 */
export function DocumentStudio({ children, ...props }: ComponentProps<typeof StudioShell> & { onFiles: (files: File[]) => void; accept: string }) {
    return (
        <ImageStoreContext.Provider value={useNoImageStore}>
            <StudioShell mobilePanel="stack" hasWork {...props}>
                {/* Organize PDF is one feature in several modes: its mode bar heads each of them. */}
                {isOrganizeMode(props.tool) && <OrganizeModeBar current={props.tool} />}
                {children}
            </StudioShell>
        </ImageStoreContext.Provider>
    );
}

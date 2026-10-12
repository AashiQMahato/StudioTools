import { create } from "zustand";

/** Whether the support (eSewa QR) dialog is open: the footer and the "result is ready" notices open it. */
export const useSupport = create<{ open: boolean; setOpen: (open: boolean) => void }>()((set) => ({ open: false, setOpen: (open) => set({ open }) }));

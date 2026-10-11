import { create } from "zustand";

/** Whether the tool search dialog is open (the navbar, the Tools menu and ⌘K all open it). */
export const useToolSearch = create<{ open: boolean; setOpen: (open: boolean) => void }>()((set) => ({ open: false, setOpen: (open) => set({ open }) }));

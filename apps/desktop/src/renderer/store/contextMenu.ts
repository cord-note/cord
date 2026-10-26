import { create } from 'zustand';
import type { LucideIcon } from 'lucide-react';

export interface MenuAction {
  label: string;
  icon?: LucideIcon;
  kbd?: string;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => unknown;
}

/** A menu entry; `'divider'` draws a separator. */
export type MenuEntry = MenuAction | 'divider';

interface OpenMenu {
  x: number;
  y: number;
  items: MenuEntry[];
}

interface ContextMenuStore {
  menu: OpenMenu | null;
  open:  (at: { clientX: number; clientY: number }, items: MenuEntry[]) => void;
  close: () => void;
}

export const useContextMenu = create<ContextMenuStore>((set) => ({
  menu: null,
  open:  (at, items) => set({ menu: { x: at.clientX, y: at.clientY, items } }),
  close: () => set({ menu: null }),
}));

/** onContextMenu helper: claims the event and opens `items` at the pointer. */
export function openContextMenu(e: React.MouseEvent, items: MenuEntry[]): void {
  e.preventDefault();
  e.stopPropagation();
  useContextMenu.getState().open(e, items);
}

import type { ComponentType } from 'react';

export type Surface = 'sidebar' | 'main' | 'settings';

export interface UIRegistration {
  id: string;
  label: string;
  icon?: ComponentType<{ className?: string }>;
  component: ComponentType;
  // For main-surface registrations — the react-router path this page lives at.
  path?: string;
  // Lower number renders first within a surface.
  position?: number;
  // Only render if this module id is active. Omit for always-visible.
  requiredModule?: string;
}

export class UIRegistry {
  private pages = new Map<Surface, UIRegistration[]>();

  addPage(surface: Surface, reg: UIRegistration): void {
    const existing = this.pages.get(surface) ?? [];
    const sorted = [...existing, reg].sort(
      (a, b) => (a.position ?? 99) - (b.position ?? 99),
    );
    this.pages.set(surface, sorted);
  }

  removePage(surface: Surface, id: string): void {
    const existing = this.pages.get(surface) ?? [];
    this.pages.set(surface, existing.filter((r) => r.id !== id));
  }

  getPages(surface: Surface): UIRegistration[] {
    return this.pages.get(surface) ?? [];
  }
}

// Singleton — import this everywhere, never construct directly.
export const registry = new UIRegistry();

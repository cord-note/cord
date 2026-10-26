import type { ComponentType } from 'react';
import type { SettingDefinition } from './schema';
import { MODIFIED_FILTER } from './search';

interface ChapterSpec {
  id: string;
  label: string;
  /** Registered settings page shown at the top of the chapter. */
  page?: string;
  /** Setting sections listed in the chapter (after the page, if any). */
  sections?: string[];
  /** Sections the page draws itself; they count for search but aren't listed. */
  embeds?: string[];
}

interface GroupSpec {
  label: string;
  chapters: ChapterSpec[];
}

/** Where everything goes in the Settings nav. Unplaced sections and pages land in "Other". */
export const SETTINGS_LAYOUT: readonly GroupSpec[] = [
  {
    label: 'App',
    chapters: [
      { id: 'appearance', label: 'Appearance', sections: ['Appearance'] },
      { id: 'editor',     label: 'Editor',     sections: ['Editor'] },
      { id: 'general',    label: 'General',    sections: ['Notes', 'General'] },
      { id: 'keyboard',   label: 'Keyboard',   page: 'keyboard' },
    ],
  },
  {
    label: 'This vault',
    chapters: [
      { id: 'vault', label: 'Vault', page: 'vault', embeds: ['Vaults'] },
      { id: 'tags',  label: 'Tags',  page: 'tags' },
    ],
  },
  {
    label: 'Account',
    chapters: [
      { id: 'account', label: 'Account', page: 'account', sections: ['Security'] },
    ],
  },
];

export interface SettingsPageRef {
  id: string;
  label: string;
  component: ComponentType;
}

export interface Chapter {
  anchor: string;
  label: string;
  page?: ComponentType;
  settings: SettingDefinition[];
}

export interface ChapterGroup {
  label: string;
  chapters: Chapter[];
}

export function chapterAnchor(id: string): string {
  return `chapter:${id}`;
}

/** Builds the nav groups, keeping only chapters with something that matches `query`. */
export function buildSettingsNav(
  definitions: readonly SettingDefinition[],
  matching: readonly SettingDefinition[],
  pages: readonly SettingsPageRef[],
  query: string,
): ChapterGroup[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const onlyModified = tokens.includes(MODIFIED_FILTER);
  const words = tokens.filter((t) => t !== MODIFIED_FILTER);
  const labelMatches = (label: string): boolean =>
    !onlyModified && words.every((w) => label.toLowerCase().includes(w));

  const matchingBySection = groupBySection(matching);
  const pageById = new Map(pages.map((p) => [p.id, p]));
  const placedSections = new Set<string>();
  const placedPages = new Set<string>();

  const specs: GroupSpec[] = SETTINGS_LAYOUT.map((g) => ({ label: g.label, chapters: [...g.chapters] }));
  for (const g of specs) {
    for (const c of g.chapters) {
      for (const s of [...(c.sections ?? []), ...(c.embeds ?? [])]) placedSections.add(s);
      if (c.page) placedPages.add(c.page);
    }
  }

  // Anything a module added that the layout doesn't know about.
  const other: ChapterSpec[] = [
    ...[...new Set(definitions.map((d) => d.section))]
      .filter((s) => !placedSections.has(s))
      .sort()
      .map((s) => ({ id: `section-${s}`, label: s, sections: [s] })),
    ...pages
      .filter((p) => !placedPages.has(p.id))
      .map((p) => ({ id: `page-${p.id}`, label: p.label, page: p.id })),
  ];
  if (other.length > 0) specs.push({ label: 'Other', chapters: other });

  const groups: ChapterGroup[] = [];
  for (const g of specs) {
    const chapters: Chapter[] = [];
    for (const spec of g.chapters) {
      const page = spec.page ? pageById.get(spec.page) : undefined;
      const settings = (spec.sections ?? [])
        .flatMap((s) => matchingBySection.get(s) ?? [])
        .sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
      const embedHit = (spec.embeds ?? []).some((s) => (matchingBySection.get(s)?.length ?? 0) > 0);
      const showPage = page !== undefined && (embedHit || labelMatches(spec.label) || labelMatches(page.label));
      if (!showPage && settings.length === 0) continue;
      chapters.push({
        anchor: chapterAnchor(spec.id),
        label: spec.label,
        ...(showPage ? { page: page.component } : {}),
        settings,
      });
    }
    if (chapters.length > 0) groups.push({ label: g.label, chapters });
  }
  return groups;
}

function groupBySection(defs: readonly SettingDefinition[]): Map<string, SettingDefinition[]> {
  const map = new Map<string, SettingDefinition[]>();
  for (const d of defs) map.set(d.section, [...(map.get(d.section) ?? []), d]);
  return map;
}

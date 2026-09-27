import type { SettingDefinition } from './schema';

export const MODIFIED_FILTER = '@modified';

function haystack(def: SettingDefinition): string {
  return [def.title, def.description, def.key, def.section, ...(def.keywords ?? [])].join(' ').toLowerCase();
}

/**
 * Settings matching `query`: every word must appear in the title, description,
 * key, section or keywords. `@modified` limits the result to changed settings.
 */
export function filterSettings(
  defs: readonly SettingDefinition[],
  query: string,
  modified: ReadonlySet<string>,
): SettingDefinition[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const onlyModified = tokens.includes(MODIFIED_FILTER);
  const words = tokens.filter((t) => t !== MODIFIED_FILTER);
  return defs.filter((def) => {
    if (onlyModified && !modified.has(def.key)) return false;
    const text = haystack(def);
    return words.every((w) => text.includes(w));
  });
}

export function modifiedKeys(
  defs: readonly SettingDefinition[],
  values: Readonly<Record<string, unknown>>,
): Set<string> {
  return new Set(defs.filter((d) => !Object.is(values[d.key], d.default)).map((d) => d.key));
}

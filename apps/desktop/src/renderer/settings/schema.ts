import type { ComponentType } from 'react';
import type { SettingsProblem } from './jsonText';

/**
 * Setting declarations. Each option is declared once; its control, search
 * entry, validation and default all derive from the declaration.
 */

/**
 * Every setting's value type, keyed by setting key. Modules that declare
 * settings extend this interface with `declare module` so keys and values
 * are checked at compile time.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface SettingValues {}

export type SettingKey = keyof SettingValues & string;

export interface SettingControlProps<T> {
  value: T;
  onChange: (value: T) => void;
  definition: SettingDefinition;
}

interface SettingDefinitionBase<T> {
  /** `section.name`, lowercase camelCase segments: `editor.fontSize`. */
  key: string;
  title: string;
  /** One sentence, shown under the title and matched by search. */
  description: string;
  /** Nav section the setting appears under: `Editor`, `Appearance`, … */
  section: string;
  default: T;
  /** Position within the section, lower first. */
  order?: number;
  /** Extra search terms. */
  keywords?: readonly string[];
  /** Replaces the control derived from the type. */
  control?: ComponentType<SettingControlProps<T>>;
  /**
   * Runs after the user changes the value (from the UI or a setter), never
   * when values are loaded from the file — so it is safe for side effects.
   */
  onUserChange?: (value: T, previous: T) => void;
}

export type BooleanSetting = SettingDefinitionBase<boolean> & { type: 'boolean' };

export type NumberSetting = SettingDefinitionBase<number> & {
  type: 'number';
  min: number;
  max: number;
  step: number;
  /** Shown after the value, e.g. `px`. */
  unit?: string;
  /** Spacing between slider notches when `step` is too fine to mark each one. */
  notchStep?: number;
};

export type StringSetting = SettingDefinitionBase<string> & {
  type: 'string';
  maxLength?: number;
  pattern?: RegExp;
};

export type EnumSetting = SettingDefinitionBase<string> & {
  type: 'enum';
  options: readonly { value: string; label: string }[];
};

export type SettingDefinition = BooleanSetting | NumberSetting | StringSetting | EnumSetting;

const KEY = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/;

/** Why `value` is not acceptable for `def`, or null when it is. */
export function validateValue(def: SettingDefinition, value: unknown): string | null {
  switch (def.type) {
    case 'boolean':
      return typeof value === 'boolean' ? null : 'expected true or false';
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return 'expected a number';
      if (value < def.min || value > def.max) return `expected ${def.min}–${def.max}`;
      const steps = (value - def.min) / def.step;
      if (Math.abs(steps - Math.round(steps)) > 1e-9) return `expected steps of ${def.step} from ${def.min}`;
      return null;
    }
    case 'string':
      if (typeof value !== 'string') return 'expected a string';
      if (def.maxLength !== undefined && value.length > def.maxLength) {
        return `expected at most ${def.maxLength} characters`;
      }
      if (def.pattern && !def.pattern.test(value)) return 'invalid format';
      return null;
    case 'enum':
      return typeof value === 'string' && def.options.some((o) => o.value === value)
        ? null
        : `expected one of ${def.options.map((o) => `"${o.value}"`).join(', ')}`;
  }
}

/** Throws when a declaration is malformed, so mistakes fail at startup. */
export function validateDefinition(def: SettingDefinition): void {
  if (!KEY.test(def.key)) {
    throw new Error(`Setting key "${def.key}" must look like "section.name" (lowercase camelCase segments)`);
  }
  if (def.type === 'number') {
    if (!(def.min < def.max)) throw new Error(`${def.key}: min must be below max`);
    if (!(def.step > 0)) throw new Error(`${def.key}: step must be positive`);
  }
  if (def.type === 'enum') {
    if (def.options.length === 0) throw new Error(`${def.key}: an enum needs at least one option`);
    if (new Set(def.options.map((o) => o.value)).size !== def.options.length) {
      throw new Error(`${def.key}: option values must be unique`);
    }
  }
  const error = validateValue(def, def.default);
  if (error) throw new Error(`${def.key}: default is invalid (${error})`);
}

/**
 * Effective values for `defs` given parsed file `data`: valid file values win,
 * everything else falls back to its default. Invalid values and unknown keys
 * are reported, never thrown.
 */
export function resolveValues(
  defs: readonly SettingDefinition[],
  data: Readonly<Record<string, unknown>>,
): { values: Record<string, unknown>; problems: SettingsProblem[] } {
  const values: Record<string, unknown> = {};
  const problems: SettingsProblem[] = [];
  const known = new Set<string>();

  for (const def of defs) {
    known.add(def.key);
    if (!Object.prototype.hasOwnProperty.call(data, def.key)) {
      values[def.key] = def.default;
      continue;
    }
    const error = validateValue(def, data[def.key]);
    if (error) {
      values[def.key] = def.default;
      problems.push({ key: def.key, severity: 'error', message: `${def.key}: ${error}; using the default` });
    } else {
      values[def.key] = data[def.key];
    }
  }

  for (const key of Object.keys(data)) {
    if (!known.has(key)) {
      problems.push({ key, severity: 'warning', message: `${key}: unknown setting, kept in the file` });
    }
  }
  return { values, problems };
}

import type { ComponentType } from 'react';
import { StepSlider } from '../StepSlider';
import type { SettingControlProps, SettingDefinition } from '../../settings/schema';
import styles from '../SettingsPage.module.css';

// Default controls, chosen from a setting's type. A declaration can replace
// its control with `control`.

export function ToggleControl({ value, onChange, definition }: SettingControlProps<boolean>) {
  return (
    <button
      role="switch"
      aria-checked={value}
      aria-label={definition.title}
      className={`${styles.toggle} ${value ? styles.toggleOn : ''}`}
      onClick={() => onChange(!value)}
    >
      <span className={styles.toggleThumb} />
    </button>
  );
}

export function SliderControl({ value, onChange, definition }: SettingControlProps<number>) {
  if (definition.type !== 'number') return null;
  return (
    <div className={styles.sliderRow}>
      <StepSlider
        label={definition.title}
        min={definition.min}
        max={definition.max}
        step={definition.step}
        notchStep={definition.notchStep}
        value={value}
        onChange={onChange}
      />
      <span className={styles.sliderValue}>{value}{definition.unit ?? ''}</span>
    </div>
  );
}

export function SegmentedControl({ value, onChange, definition }: SettingControlProps<string>) {
  if (definition.type !== 'enum') return null;
  return (
    <div className={styles.schemeRow} role="radiogroup" aria-label={definition.title}>
      {definition.options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          className={`${styles.schemeBtn} ${value === o.value ? styles.schemeBtnActive : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function SelectControl({ value, onChange, definition }: SettingControlProps<string>) {
  if (definition.type !== 'enum') return null;
  return (
    <select
      className={styles.selectInput}
      aria-label={definition.title}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {definition.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function TextControl({ value, onChange, definition }: SettingControlProps<string>) {
  return (
    <input
      className={styles.textInput}
      aria-label={definition.title}
      value={value}
      maxLength={definition.type === 'string' ? definition.maxLength : undefined}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/** The control for a declaration: its own `control`, else one derived from its type. */
// The union of per-type prop types cannot be expressed as one ComponentType, so
// callers pass the matching value; SettingRow is the only caller.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function controlFor(def: SettingDefinition): ComponentType<SettingControlProps<any>> {
  if (def.control) return def.control as ComponentType<SettingControlProps<unknown>>;
  switch (def.type) {
    case 'boolean': return ToggleControl;
    case 'number':  return SliderControl;
    case 'enum':    return def.options.length <= 4 ? SegmentedControl : SelectControl;
    case 'string':  return TextControl;
  }
}

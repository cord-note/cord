import styles from '../SettingsPage.module.css';

interface ColorSwatchProps {
  color: string;
  selected: boolean;
  onPick: (color: string) => void;
  title?: string;
}

export function ColorSwatch({ color, selected, onPick, title }: ColorSwatchProps) {
  return (
    <button
      className={`${styles.colorSwatch} ${selected ? styles.colorSelected : ''}`}
      style={{ background: color }}
      onClick={() => onPick(color)}
      title={title ?? color}
      aria-label={title ?? color}
      aria-pressed={selected}
    />
  );
}

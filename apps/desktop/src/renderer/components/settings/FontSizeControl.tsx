import type { SettingControlProps } from '../../settings/schema';
import { SliderControl } from './controls';
import styles from '../SettingsPage.module.css';

const FONT_PREVIEW_TEXT =
  'The quick brown fox jumps over the lazy dog while the editor renders at this size.';

/** The size slider with a line of text at the chosen size. */
export function FontSizeControl(props: SettingControlProps<number>) {
  return (
    <>
      <SliderControl {...props} />
      <div className={styles.fontPreview} style={{ fontSize: `${props.value}px` }}>
        {FONT_PREVIEW_TEXT}
      </div>
    </>
  );
}

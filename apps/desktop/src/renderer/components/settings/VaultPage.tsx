import { useEffect, useState } from 'react';
import { api } from '../../ipc';
import { log } from '../../lib/log';
import { useSetting } from '../../settings';
import { holdDuration } from '../../settings/derived';
import { useUIStore } from '../../store/ui';
import { useVaultStore } from '../../store/vaults';
import { HoldButton } from '../HoldButton';
import { HOLD_ARCHIVE_MS } from '@shared/constants';
import {
  VAULT_COLOR_FAMILIES,
  VAULT_SHADE_LABELS,
  DISTINCT_VAULT_COLORS,
  DEFAULT_VAULT_COLOR,
} from '@shared/constants/vaultColors';
import styles from '../SettingsPage.module.css';

/** Debounce before a typed vault name is written back to the sidecar. */
const NAME_SAVE_DEBOUNCE_MS = 600;

export default function VaultPage() {
  const { vaults, activeVaultId, archiveVault, loadVaults } = useVaultStore();
  const { setView } = useUIStore();
  const distinctVaultColors = useSetting('vaults.distinctColors');
  const holdSpeed = useSetting('general.holdToConfirm');
  const vault = vaults.find((v) => v.id === activeVaultId);

  const [name, setName] = useState(vault?.name ?? '');
  const [color, setColor] = useState<string>(vault?.color ?? DEFAULT_VAULT_COLOR);

  // Re-seed the local mirrors when the selected vault changes, so editing one
  // vault's name doesn't leak into the next.
  useEffect(() => {
    setName(vault?.name ?? '');
    setColor(vault?.color ?? DEFAULT_VAULT_COLOR);
  }, [vault?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Autosave the name. The equality check means this never fires on mount or
  // immediately after a save round-trips back through the store.
  useEffect(() => {
    if (!activeVaultId) return;
    const trimmed = name.trim();
    if (!trimmed || trimmed === vault?.name) return;
    const timer = setTimeout(async () => {
      try {
        await api.vaults.update(activeVaultId, { name: trimmed });
        await loadVaults();
      } catch (err) {
        log('error', 'settings', 'Failed to rename vault', err);
      }
    }, NAME_SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [name, activeVaultId, vault?.name, loadVaults]);

  if (!vault) {
    return (
      <>
        <div className={styles.empty}>No vault selected.</div>
      </>
    );
  }

  async function handlePickColor(c: string) {
    if (!activeVaultId) return;
    setColor(c); // optimistic — the swatch highlights before the write lands
    try {
      await api.vaults.update(activeVaultId, { color: c });
      await loadVaults();
    } catch (err) {
      log('error', 'settings', 'Failed to update vault color', err);
    }
  }

  async function handleArchive() {
    if (!activeVaultId) return;
    try {
      await archiveVault(activeVaultId);
      setView('notes');
    } catch (err) {
      log('error', 'settings', 'Failed to archive vault', err);
    }
  }

  return (
    <>

      <div className={`${styles.field} cord-settings__field`}>
        <div className={styles.fieldLabel}>Vault name</div>
        <input
          className={styles.textInput}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div className={`${styles.field} cord-settings__field`}>
        <div className={styles.fieldLabel}>Color</div>
        <div className={styles.fieldHint}>
          {distinctVaultColors
            ? 'Showing the curated high-contrast set. Turn off “Use distinct vault colors” for the full palette.'
            : 'Hues across, shades down.'}
        </div>
        {distinctVaultColors ? (
          <div className={styles.distinctPalette}>
            {DISTINCT_VAULT_COLORS.map((c) => (
              <ColorSwatch key={c} color={c} selected={c === color} onPick={handlePickColor} />
            ))}
          </div>
        ) : (
          <div className={styles.palette}>
            {VAULT_COLOR_FAMILIES.map((family) => (
              <div key={family.name} className={styles.paletteColumn}>
                {family.shades.map((c, i) => (
                  <ColorSwatch
                    key={c}
                    color={c}
                    title={`${family.name} ${VAULT_SHADE_LABELS[i]}`}
                    selected={c === color}
                    onPick={handlePickColor}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={`${styles.field} cord-settings__field`}>
        <div className={styles.dangerLabel}>Danger zone</div>
        <div className={styles.fieldHint}>
          Press and hold to archive “{vault.name}”. You can restore it later.
        </div>
        <HoldButton
          variant="text"
          durationMs={holdDuration(HOLD_ARCHIVE_MS, holdSpeed)}
          onComplete={handleArchive}
          holdingLabel="Keep holding…"
          className={styles.inlineHoldBtn}
          title={`Hold to archive vault "${vault.name}"`}
        >
          Archive vault
        </HoldButton>
      </div>
    </>
  );
}

interface ColorSwatchProps {
  color: string;
  selected: boolean;
  onPick: (color: string) => void;
  title?: string;
}

function ColorSwatch({ color, selected, onPick, title }: ColorSwatchProps) {
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

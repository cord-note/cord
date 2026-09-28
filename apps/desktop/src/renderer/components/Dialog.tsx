import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import styles from './Dialog.module.css';

interface DialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * A modal on the native `<dialog>`: `showModal()` gives focus containment,
 * Escape and a backdrop for free. Children mount only while open, so every
 * opening starts from a clean state.
 */
export function Dialog({ open, title, onClose, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={`${styles.dialog} cord-dialog`}
      aria-labelledby={titleId}
      // Escape: let React state decide, so the dialog and `open` never disagree.
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      // The dialog element has no padding, so a click on it itself is a click on the backdrop.
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {open && (
        <div className={styles.panel}>
          <header className={styles.header}>
            <h2 id={titleId} className={`${styles.title} cord-dialog__title`}>{title}</h2>
            <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
              <X size={16} strokeWidth={1.75} />
            </button>
          </header>
          {children}
        </div>
      )}
    </dialog>
  );
}

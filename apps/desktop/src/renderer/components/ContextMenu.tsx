import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Clipboard, Copy, Scissors, TextSelect } from 'lucide-react';
import { useContextMenu, type MenuAction, type MenuEntry } from '../store/contextMenu';
import { log } from '../lib/log';
import styles from './ContextMenu.module.css';

type TextField = HTMLInputElement | HTMLTextAreaElement;

const TEXT_INPUT_TYPES = new Set(['text', 'search', 'email', 'url', 'tel', 'number', 'password', '']);

function textFieldAt(target: EventTarget | null): TextField | null {
  if (target instanceof HTMLTextAreaElement) return target;
  if (target instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(target.type)) return target;
  return null;
}

/** Cut / Copy / Paste / Select all for a plain input or textarea. */
function textFieldItems(field: TextField): MenuEntry[] {
  const hasSelection = (field.selectionStart ?? 0) !== (field.selectionEnd ?? 0);
  const editable = !field.readOnly && !field.disabled;
  // Passwords can be typed into but never read back out.
  const secret = field instanceof HTMLInputElement && field.type === 'password';

  return [
    { label: 'Cut',   icon: Scissors, kbd: 'Ctrl+X', disabled: !hasSelection || !editable || secret,
      onSelect: () => { field.focus(); document.execCommand('cut'); } },
    { label: 'Copy',  icon: Copy, kbd: 'Ctrl+C', disabled: !hasSelection || secret,
      onSelect: () => { field.focus(); document.execCommand('copy'); } },
    { label: 'Paste', icon: Clipboard, kbd: 'Ctrl+V', disabled: !editable,
      onSelect: async () => {
        field.focus();
        try {
          const text = await navigator.clipboard.readText();
          // insertText keeps the field's undo history and fires its onChange.
          document.execCommand('insertText', false, text);
        } catch (err) {
          log('warn', 'menu', 'Reading the clipboard failed', err);
        }
      } },
    'divider',
    { label: 'Select all', icon: TextSelect, kbd: 'Ctrl+A',
      onSelect: () => { field.focus(); field.select(); } },
  ];
}

/**
 * The app's one context menu. Also owns right-click for the whole window:
 * anything that doesn't open its own menu gets no browser menu, and text
 * fields get a clipboard menu.
 */
export function ContextMenu() {
  const { menu, open, close } = useContextMenu();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [index, setIndex] = useState(-1);

  // Bubble phase, so menus that claimed the event (editor, rows) win.
  useEffect(() => {
    function onContextMenu(e: MouseEvent) {
      if (e.defaultPrevented) return;
      e.preventDefault();
      const field = textFieldAt(e.target);
      if (field) open(e, textFieldItems(field));
      else close();
    }
    document.addEventListener('contextmenu', onContextMenu);
    return () => document.removeEventListener('contextmenu', onContextMenu);
  }, [open, close]);

  // Keep the menu inside the window once its size is known.
  useLayoutEffect(() => {
    if (!menu || !ref.current) { setPos(null); return; }
    const { width, height } = ref.current.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(menu.x, window.innerWidth - width - 8)),
      top:  Math.max(8, Math.min(menu.y, window.innerHeight - height - 8)),
    });
    setIndex(-1);
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) close(); };
    const actions = menu.items.filter((i): i is MenuAction => i !== 'divider');
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const step = e.key === 'ArrowDown' ? 1 : -1;
        setIndex((i) => {
          for (let n = 1; n <= actions.length; n++) {
            const next = (i + step * n + actions.length) % actions.length;
            if (!actions[next]?.disabled) return next;
          }
          return i;
        });
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        setIndex((i) => { const a = actions[i]; if (a && !a.disabled) void run(a); return i; });
      }
    };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    window.addEventListener('wheel', close, { passive: true });
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('wheel', close);
    };
  }, [menu, close]); // eslint-disable-line react-hooks/exhaustive-deps

  async function run(action: MenuAction) {
    close();
    try {
      await action.onSelect();
    } catch (err) {
      log('error', 'menu', `Menu action "${action.label}" failed`, err);
    }
  }

  if (!menu) return null;

  let actionIndex = -1;
  return (
    <div
      ref={ref}
      role="menu"
      className={`${styles.menu} cord-menu`}
      // Measured invisibly first, then placed.
      style={pos ? { left: pos.left, top: pos.top } : { left: menu.x, top: menu.y, visibility: 'hidden' }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {menu.items.map((item, i) => {
        if (item === 'divider') return <div key={`d${i}`} className={`${styles.divider} cord-menu__divider`} />;
        actionIndex += 1;
        const mine = actionIndex;
        const Icon = item.icon;
        const active = mine === index;
        return (
          <button
            key={item.label}
            role="menuitem"
            disabled={item.disabled}
            className={[
              styles.item, 'cord-menu__item',
              item.danger ? styles.danger : '',
              active ? `${styles.active} cord-menu__item--active` : '',
            ].filter(Boolean).join(' ')}
            onMouseEnter={() => setIndex(mine)}
            onClick={() => void run(item)}
          >
            <span className={styles.icon}>{Icon && <Icon size={13} strokeWidth={1.75} />}</span>
            <span className={styles.label}>{item.label}</span>
            {item.kbd && <span className={styles.kbd}>{item.kbd}</span>}
          </button>
        );
      })}
    </div>
  );
}

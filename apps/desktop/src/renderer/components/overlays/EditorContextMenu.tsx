import { useEffect, useState, useRef, useCallback } from 'react';
import type { Editor, ShuttleControls } from 'shuttle-editor';
import { ArrowLeft, Tag as TagIcon, Link2, Plus, Copy, Scissors, Clipboard, FileText } from 'lucide-react';
import { useFragmentStore } from '../../store/fragments';
import { useTagStore } from '../../store/tags';
import { useVaultStore } from '../../store/vaults';
import { log } from '../../lib/log';
import { blockElement, topLevelBlockId } from './blockDom';
import styles from './EditorContextMenu.module.css';

interface MenuState {
  x: number;
  y: number;
  blockId: string | null;
}

type SubView = null | { kind: 'tag' };

type FragmentAction = 'tag' | 'noteLink' | 'fragmentLink';

interface Props {
  editor: Editor;
  noteId: string;
  /** Shuttle's pickers, which the link actions use. */
  controls: ShuttleControls | null;
}

export function EditorContextMenu({ editor, noteId, controls }: Props) {
  const { annotations, attachTag, createLink } = useFragmentStore();
  const { tags, createTag } = useTagStore();
  const { activeVaultId } = useVaultStore();

  const [menu, setMenu]         = useState<MenuState | null>(null);
  const [sub, setSub]           = useState<SubView>(null);
  const [query, setQuery]       = useState('');
  const [listIndex, setListIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef  = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setMenu(null);
    setSub(null);
    setQuery('');
  }, []);

  /** Link a block to a note, chosen in Shuttle's picker. */
  const linkToNote = useCallback(async (fromBlockId: string) => {
    const target = await controls?.pickNote({ title: 'Link block to a note' });
    if (!target) return;
    try {
      const link = await createLink({ fromFragmentId: fromBlockId, fromNoteId: noteId, vaultId: activeVaultId ?? '', toNoteId: target.id });
      editor.chain().focus().insertFragmentLink({ linkId: link.id, toNoteId: target.id, toFragmentId: null, label: target.title || 'Untitled' }).run();
    } catch (error) {
      log('error', 'links', 'Linking the block to a note failed', { error: String(error) });
    }
  }, [controls, createLink, noteId, activeVaultId, editor]);

  /** Link a block to another note's block, chosen in Shuttle's picker. */
  const linkToFragment = useCallback(async (fromBlockId: string) => {
    const picked = await controls?.pickBlock({ title: 'Link block to a block' });
    if (!picked) return;
    const { note, block } = picked;
    try {
      const link = await createLink({
        fromFragmentId:   fromBlockId,
        fromNoteId:       noteId,
        vaultId:          activeVaultId ?? '',
        toNoteId:         note.id,
        toFragmentId:     block.id,
        toFragmentNoteId: note.id,
      });
      editor.chain().focus().insertFragmentLink({
        linkId: link.id, toNoteId: note.id, toFragmentId: block.id, label: (block.text || note.title || 'block').slice(0, 30),
      }).run();
    } catch (error) {
      log('error', 'links', 'Linking the block to a block failed', { error: String(error) });
    }
  }, [controls, createLink, noteId, activeVaultId, editor]);

  useEffect(() => {
    const pm = editor?.view.dom as HTMLElement | undefined;
    if (!pm) return;

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      setMenu({ x: e.clientX, y: e.clientY, blockId: topLevelBlockId(pm, e.target) });
      setSub(null);
      setQuery('');
    };

    pm.addEventListener('contextmenu', handleContextMenu);
    return () => pm.removeEventListener('contextmenu', handleContextMenu);
  }, [editor]);

  useEffect(() => {
    if (!menu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) close();
    };
    const keyHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', keyHandler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', keyHandler);
    };
  }, [menu, close]);

  useEffect(() => {
    setListIndex(0);
    if (sub) setTimeout(() => inputRef.current?.focus(), 30);
  }, [sub]);

  useEffect(() => { setListIndex(0); }, [query]);

  // Block actions from Shuttle's slash menu and block menu. Links open the
  // picker directly; tagging opens this menu's tag view under the block.
  useEffect(() => {
    const handler = (e: Event) => {
      const { type, blockId } = (e as CustomEvent<{ type: FragmentAction; blockId: string }>).detail;
      if (type === 'noteLink') { void linkToNote(blockId); return; }
      if (type === 'fragmentLink') { void linkToFragment(blockId); return; }
      const pm = editor?.view.dom as HTMLElement | undefined;
      const rect = (pm ? blockElement(pm, blockId) : null)?.getBoundingClientRect();
      setMenu({ x: rect ? rect.left : 200, y: rect ? rect.bottom + 4 : 200, blockId });
      setSub({ kind: 'tag' });
      setQuery('');
    };
    window.addEventListener('corddb:fragment-action', handler);
    return () => window.removeEventListener('corddb:fragment-action', handler);
  }, [editor, linkToNote, linkToFragment]);

  function execCopy()  { document.execCommand('copy');  close(); }
  function execCut()   { document.execCommand('cut');   close(); }
  async function execPaste() {
    try {
      const text = await navigator.clipboard.readText();
      editor.chain().focus().insertContent(text).run();
    } catch {
      document.execCommand('paste');
    }
    close();
  }

  const blockId = menu?.blockId ?? null;
  const annotation = blockId ? (annotations[blockId] ?? { tags: [], links: [], backlinks: [] }) : { tags: [], links: [], backlinks: [] };

  async function doAttachTag(tagId: string) {
    if (!blockId) return;
    await attachTag(blockId, noteId, activeVaultId ?? '', tagId);
    close();
  }

  async function doCreateTag() {
    if (!query.trim() || !activeVaultId) return;
    const tag = await createTag({ vaultId: activeVaultId, name: query.trim() });
    await doAttachTag(tag.id);
  }

  const q = query.toLowerCase();
  const attachedTagIds = new Set(annotation.tags.map((t) => t.id));
  const filteredTags = tags.filter((t) => !attachedTagIds.has(t.id) && t.name.toLowerCase().includes(q));
  const tagExists = tags.some((t) => t.name.toLowerCase() === query.trim().toLowerCase());

  if (!menu) return null;

  const MENU_W = 200;
  const MENU_H = sub ? 280 : 180;
  const left = Math.min(menu.x, window.innerWidth  - MENU_W - 8);
  const top  = Math.min(menu.y, window.innerHeight - MENU_H - 8);

  return (
    <div ref={menuRef} className={`${styles.menu} cord-menu`} style={{ left, top }} onContextMenu={(e) => e.preventDefault()}>

      {!sub && (
        <>
          <button className={`${styles.item} cord-menu__item`} onClick={execCopy}>
            <Copy size={13} strokeWidth={1.75} className={styles.itemIcon} />
            <span className={styles.itemLabel}>Copy</span>
            <span className={styles.itemKbd}>Ctrl+C</span>
          </button>
          <button className={`${styles.item} cord-menu__item`} onClick={execCut}>
            <Scissors size={13} strokeWidth={1.75} className={styles.itemIcon} />
            <span className={styles.itemLabel}>Cut</span>
            <span className={styles.itemKbd}>Ctrl+X</span>
          </button>
          <button className={`${styles.item} cord-menu__item`} onClick={execPaste}>
            <Clipboard size={13} strokeWidth={1.75} className={styles.itemIcon} />
            <span className={styles.itemLabel}>Paste</span>
            <span className={styles.itemKbd}>Ctrl+V</span>
          </button>

          {blockId && (
            <>
              <div className={`${styles.divider} cord-menu__divider`} />
              <button className={`${styles.item} cord-menu__item`} onClick={() => { setSub({ kind: 'tag' }); setQuery(''); }}>
                <TagIcon size={13} strokeWidth={1.75} className={styles.itemIcon} />
                <span className={styles.itemLabel}>Add tag to block</span>
              </button>
              <button className={`${styles.item} cord-menu__item`} onClick={() => { close(); void linkToNote(blockId); }}>
                <FileText size={13} strokeWidth={1.75} className={styles.itemIcon} />
                <span className={styles.itemLabel}>Link block → note</span>
              </button>
              <button className={`${styles.item} cord-menu__item`} onClick={() => { close(); void linkToFragment(blockId); }}>
                <Link2 size={13} strokeWidth={1.75} className={styles.itemIcon} />
                <span className={styles.itemLabel}>Link block → fragment</span>
              </button>
            </>
          )}
        </>
      )}

      {sub?.kind === 'tag' && (
        <>
          <SubHeader label="Add tag" onBack={() => { setSub(null); setQuery(''); }} />
          <input
            ref={inputRef}
            className={styles.input}
            placeholder="Search or create tag…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setListIndex((i) => Math.min(i + 1, filteredTags.length - 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setListIndex((i) => Math.max(i - 1, 0)); }
              else if (e.key === 'Enter') { if (filteredTags[listIndex]) doAttachTag(filteredTags[listIndex].id); else doCreateTag(); }
              else if (e.key === 'Escape') close();
            }}
          />
          <div className={styles.list}>
            {filteredTags.map((tag, i) => (
              <button key={tag.id} className={`${styles.item} cord-menu__item ${i === listIndex ? `${styles.itemActive} cord-menu__item--active` : ''}`} onClick={() => doAttachTag(tag.id)} onMouseEnter={() => setListIndex(i)}>
                <span className={styles.dot} style={{ background: tag.color ?? 'var(--text-muted)' }} />
                {tag.name}
              </button>
            ))}
            {query.trim() && !tagExists && (
              <button className={styles.itemAccent} onClick={doCreateTag}>
                <Plus size={11} strokeWidth={2} /> Create &quot;{query.trim()}&quot;
              </button>
            )}
            {filteredTags.length === 0 && !query.trim() && (
              <div className={styles.empty}>No tags yet</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function SubHeader({ label, onBack }: { label: string; onBack: () => void }) {
  return (
    <div className={styles.subHeader}>
      <button className={styles.backBtn} onClick={onBack}><ArrowLeft size={12} strokeWidth={2} /></button>
      <span>{label}</span>
    </div>
  );
}

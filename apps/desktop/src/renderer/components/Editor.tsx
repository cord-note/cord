import { useEffect, useRef, useCallback, useMemo, useState } from 'react';
import { X, Tag } from 'lucide-react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { ShuttleEditor, type Editor as ShuttleEditorInstance, type JSONContent, type ShuttleControls } from 'shuttle-editor';
import { FragmentOverlay } from './overlays/FragmentOverlay';
import { EditorContextMenu } from './overlays/EditorContextMenu';
import { WikiLinkPills } from './overlays/WikiLinkPills';
import { blockElement } from './overlays/blockDom';
import { useFragmentStore } from '../store/fragments';
import { useNoteStore } from '../store/notes';
import { useTagStore } from '../store/tags';
import { useVaultStore } from '../store/vaults';
import { useSettingsStore } from '../store/settings';
import { useUIStore } from '../store/ui';
import { useThemeStore, resolveScheme } from '../store/theme';
import { useKeybindingStore, shuttleOverrides } from '../store/keybindings';
import { api } from '../ipc';
import { log } from '../lib/log';
import { createCordHost } from '../shuttle/cordHost';
import { outboundMentions as findOutboundMentions } from '../shuttle/outboundMentions';
import type { Note } from '@shared/types';
import styles from './Editor.module.css';

const SAVE_DEBOUNCE_MS = 750;
/** The ruler's limits, matching the Line width slider in Settings. */
const LINE_WIDTH_RANGE = { min: 480, max: 1200, step: 40 };

interface Props {
  note: Note;
}

/**
 * The stored body as a document for Shuttle, or null for an empty note. A
 * document from before Shuttle passes through unchanged: Shuttle opens it
 * read-only and never saves it.
 */
function parseStoredDoc(bodyJson: string): JSONContent | null {
  try {
    const parsed: unknown = JSON.parse(bodyJson);
    if (typeof parsed === 'object' && parsed !== null && (parsed as JSONContent).type === 'doc') {
      return parsed as JSONContent;
    }
  } catch {
    // Unreadable body — open as an empty document.
  }
  return null;
}

/** Cord's light/dark scheme, following the system when set to `system`. */
function useResolvedScheme(): 'light' | 'dark' {
  const colorScheme = useThemeStore((s) => s.colorScheme);
  const [resolved, setResolved] = useState(() => resolveScheme(colorScheme));
  useEffect(() => {
    setResolved(resolveScheme(colorScheme));
    if (colorScheme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (): void => setResolved(resolveScheme('system'));
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [colorScheme]);
  return resolved;
}

export default function Editor({ note }: Props) {
  const { updateNote, backlinks, notes, setActiveNote, loadLinks,
          activeNoteTags, loadNoteTags, attachTag, detachTag,
          unlinkedMentions, loadUnlinkedMentions } = useNoteStore();
  const { unlinkedMentions: mentionsEnabled, spellCheck, editorLineWidth, update: updateSettings } = useSettingsStore();
  const { tags, createTag } = useTagStore();
  const { activeVaultId } = useVaultStore();
  const { setView } = useUIStore();
  const bindings = useKeybindingStore((s) => s.bindings);
  const colorScheme = useResolvedScheme();
  const [showTagPicker, setShowTagPicker] = useState(false);
  const [newTagName, setNewTagName] = useState('');

  const [editor, setEditor] = useState<ShuttleEditorInstance | null>(null);
  const [controls, setControls] = useState<ShuttleControls | null>(null);
  const [stats, setStats] = useState({ words: 0, characters: 0 });
  const [outboundMentions, setOutboundMentions] = useState<Note[]>([]);
  /** Set when wiki links changed; the save that follows re-derives note_links. */
  const linksDirty = useRef(false);

  const noteIdRef = useRef(note.id);
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const tagPickerRef = useRef<HTMLDivElement>(null);

  const { loadForNote: loadFragments, pendingScroll, setPendingScroll } = useFragmentStore();

  const [localTitle, setLocalTitle] = useState(note.title);
  const isNotepad = note.kind === 'notepad';

  // Read only when the note changes: Shuttle owns the document after that.
  const doc = useMemo(() => parseStoredDoc(note.bodyJson), [note.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const openNote = useCallback((id: string, blockId?: string) => {
    setView('notes');
    void setActiveNote(id);
    void loadLinks(id);
    if (blockId) setPendingScroll(blockId);
  }, [setView, setActiveNote, loadLinks, setPendingScroll]);

  // A new host whenever the note list changes, so Shuttle refreshes the
  // unlinked-mention highlighting it derives from the titles.
  const host = useMemo(() => createCordHost({
    getNotes: () => notes,
    getActiveVaultId: () => activeVaultId,
    api,
    convertFileSrc,
    openNote,
    onFragmentAction: ({ type, blockId }) => {
      window.dispatchEvent(new CustomEvent('corddb:fragment-action', { detail: { type, blockId } }));
    },
    reloadFragments: (noteId) => { void loadFragments(noteId); },
    onLinksMaybeChanged: () => { linksDirty.current = true; },
    keybindingOverrides: shuttleOverrides(bindings),
    log,
  }), [notes, activeVaultId, openNote, loadFragments, bindings]);

  const handleChange = useCallback((id: string, json: JSONContent) => {
    void updateNote(id, { bodyJson: JSON.stringify(json) })
      .then(() => {
        // note_links is derived by the sidecar on save, so reload after it lands.
        if (linksDirty.current) {
          linksDirty.current = false;
          void loadLinks(id);
        }
      })
      .catch((error: unknown) => log('error', 'editor', 'Saving the note failed', { noteId: id, error: String(error) }));
    setOutboundMentions(findOutboundMentions(json, useNoteStore.getState().notes, id));
  }, [updateNote, loadLinks]);

  const handleReady = useCallback((e: ShuttleEditorInstance | null, c: ShuttleControls | null) => {
    setEditor(e);
    setControls(c);
  }, []);

  useEffect(() => {
    noteIdRef.current = note.id;
    setLocalTitle(note.title);
    loadNoteTags(note.id);
    loadFragments(note.id);
    if (mentionsEnabled) loadUnlinkedMentions(note.id, note.vaultId);
    setShowTagPicker(false);
  }, [note.id, note.title]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    linksDirty.current = false;
    setOutboundMentions(doc ? findOutboundMentions(doc, useNoteStore.getState().notes, note.id) : []);
  }, [note.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clicking away is a dismissal, same as Escape. Without this the picker
  // stayed open — and kept its half-typed draft — until Enter or Escape.
  useEffect(() => {
    if (!showTagPicker) return;
    function onPointerDown(e: PointerEvent) {
      if (tagPickerRef.current?.contains(e.target as Node)) return;
      setShowTagPicker(false);
      setNewTagName('');
    }
    // Capture, so the picker closes even when the click lands on something
    // that stops propagation (the editor surface does).
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [showTagPicker]);

  useEffect(() => {
    if (!pendingScroll || !editor) return;
    setPendingScroll(null);
    const t = setTimeout(() => {
      blockElement(editor.view.dom, pendingScroll)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 80);
    return () => clearTimeout(t);
  }, [pendingScroll, editor, setPendingScroll]);

  useEffect(() => {
    function onCmd(e: Event) {
      const { cmd } = (e as CustomEvent<{ cmd: string }>).detail;
      if (!editor || editor.isDestroyed) return;
      const at = editor.state.selection.from;
      switch (cmd) {
        case 'bold':      editor.chain().focus().toggleBold().run(); break;
        case 'italic':    editor.chain().focus().toggleItalic().run(); break;
        case 'h1':        editor.chain().focus().toggleHeading({ level: 1 }).run(); break;
        case 'h2':        editor.chain().focus().toggleHeading({ level: 2 }).run(); break;
        case 'h3':        editor.chain().focus().toggleHeading({ level: 3 }).run(); break;
        case 'codeBlock': editor.chain().focus().toggleCodeBlock().run(); break;
        case 'taskList':  editor.chain().focus().toggleTaskList().run(); break;
        case 'hr':        editor.chain().focus().setHorizontalRule().run(); break;

        // Notepad-only. The command bar hides these for a plain note, but guard
        // anyway — the event is on `window` and anything can dispatch it.
        case 'block:moveUp':    if (isNotepad) editor.commands.moveBlock(at, -1); break;
        case 'block:moveDown':  if (isNotepad) editor.commands.moveBlock(at, 1); break;
        case 'block:duplicate': if (isNotepad) editor.commands.duplicateBlock(at); break;
        case 'block:delete':    if (isNotepad) editor.commands.deleteBlock(at); break;
        case 'block:insertRef': if (isNotepad) controls?.openRefPicker(); break;
      }
    }
    window.addEventListener('corddb:editor-command', onCmd);
    return () => window.removeEventListener('corddb:editor-command', onCmd);
  }, [editor, controls, isNotepad]);

  useEffect(() => {
    return () => {
      if (titleTimer.current) clearTimeout(titleTimer.current);
    };
  }, []);

  const handleTitleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      setLocalTitle(val);
      if (titleTimer.current) clearTimeout(titleTimer.current);
      titleTimer.current = setTimeout(() => {
        updateNote(noteIdRef.current, { title: val });
      }, SAVE_DEBOUNCE_MS);
    },
    [updateNote],
  );

  const handleTitleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        editor?.commands.focus();
      }
    },
    [editor],
  );

  const backlinkNotes = backlinks
    .map((l) => notes.find((n) => n.id === l.fromNoteId))
    .filter(Boolean);

  return (
    <div className={styles.editor}>
      <div className={styles.titleRow}>
        <input
          className={styles.title}
          value={localTitle}
          onChange={handleTitleChange}
          onKeyDown={handleTitleKeyDown}
          placeholder="Untitled"
        />
        <button
          className={styles.addTagBtn}
          onClick={() => setShowTagPicker(true)}
          title="Add tag"
          style={{ marginTop: 6, flexShrink: 0 }}
        >
          <Tag size={10} strokeWidth={2} /> tag
        </button>
      </div>

      <div className={styles.tagPanel}>
        {activeNoteTags.map((tag) => (
          <span
            key={tag.id}
            className={styles.tagChip}
            style={{ borderColor: tag.color ?? 'var(--text-muted)' }}
          >
            <span
              className={styles.tagChipDot}
              style={{ background: tag.color ?? 'var(--text-muted)' }}
            />
            {tag.name}
            <button
              className={styles.tagChipRemove}
              onClick={() => detachTag(note.id, tag.id)}
              title="Remove tag"
            ><X size={11} strokeWidth={2} /></button>
          </span>
        ))}

        {showTagPicker ? (
          <div className={styles.tagPickerInline} ref={tagPickerRef}>
            {tags
              .filter((t) => !activeNoteTags.some((at) => at.id === t.id))
              .map((t) => (
                <button
                  key={t.id}
                  className={styles.tagPickerItem}
                  onClick={async () => {
                    await attachTag(note.id, t.id);
                    setShowTagPicker(false);
                  }}
                >
                  <span style={{ background: t.color ?? 'var(--text-muted)' }} className={styles.tagPickerDot} />
                  {t.name}
                </button>
              ))
            }
            <input
              autoFocus
              className={styles.tagPickerInput}
              placeholder="New tag name…"
              value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === 'Enter' && newTagName.trim() && activeVaultId) {
                  const tag = await createTag({ vaultId: activeVaultId, name: newTagName.trim() });
                  await attachTag(note.id, tag.id);
                  setNewTagName('');
                  setShowTagPicker(false);
                }
                if (e.key === 'Escape') { setShowTagPicker(false); setNewTagName(''); }
              }}
            />
          </div>
        ) : null}
      </div>

      <div className={styles.content} ref={contentRef}>
        <ShuttleEditor
          docKey={note.id}
          doc={doc}
          mode={note.kind}
          host={host}
          twitch={false}
          colorScheme={colorScheme}
          spellCheck={spellCheck}
          lineWidth={editorLineWidth}
          lineWidthRange={LINE_WIDTH_RANGE}
          onLineWidthChange={(w: number) => { void updateSettings({ editorLineWidth: w }); }}
          saveDebounceMs={SAVE_DEBOUNCE_MS}
          onChange={handleChange}
          onStats={setStats}
          onReady={handleReady}
        >
          {editor && <FragmentOverlay editor={editor} noteId={note.id} contentEl={contentRef.current} />}
          {editor && <WikiLinkPills editor={editor} contentEl={contentRef.current} />}
        </ShuttleEditor>
      </div>

      {editor && <EditorContextMenu editor={editor} noteId={note.id} controls={controls} />}

      <div className={styles.statusBar}>
        <div className={styles.statusBacklinks}>
          {backlinkNotes.length > 0 ? (
            <>
              <span className={styles.statusBacklinkCount}>{backlinkNotes.length} backlink{backlinkNotes.length !== 1 ? 's' : ''}</span>
              {backlinkNotes.map((n) => (
                <button
                  key={n!.id}
                  className={styles.backlinkChip}
                  onClick={() => { setActiveNote(n!.id); loadLinks(n!.id); }}
                  title={`Open "${n!.title || 'Untitled'}"`}
                >
                  {n!.title || 'Untitled'}
                </button>
              ))}
            </>
          ) : (
            <span className={styles.statusDim}>0 backlinks</span>
          )}

          {mentionsEnabled && unlinkedMentions.length > 0 && (
            <>
              <span className={styles.statusDividerDot}>·</span>
              <span className={styles.statusUnlinkedLabel}>
                mentioned by {unlinkedMentions.length}
              </span>
              {unlinkedMentions.map((m) => (
                <button
                  key={m.noteId}
                  className={`${styles.backlinkChip} ${styles.unlinkedChip}`}
                  onClick={() => { setView('notes'); setActiveNote(m.noteId); loadLinks(m.noteId); }}
                  title={m.excerpt || `Mentions "${note.title}" without a link`}
                >
                  {m.noteTitle}
                </button>
              ))}
            </>
          )}

          {mentionsEnabled && outboundMentions.length > 0 && (
            <>
              <span className={styles.statusDividerDot}>·</span>
              <span className={styles.statusUnlinkedLabel}>
                mentions {outboundMentions.length}
              </span>
              {outboundMentions.map((n) => (
                <button
                  key={n.id}
                  className={`${styles.backlinkChip} ${styles.unlinkedChip}`}
                  onClick={() => { setView('notes'); setActiveNote(n.id); loadLinks(n.id); }}
                  title={`This note mentions "${n.title}" without a link`}
                >
                  {n.title || 'Untitled'}
                </button>
              ))}
            </>
          )}
        </div>
        <div className={styles.statusStats}>
          <span className={styles.statusDim}>{stats.words} words</span>
          <span className={styles.statusDot} />
          <span className={styles.statusDim}>{stats.characters} chars</span>
        </div>
      </div>
    </div>
  );
}

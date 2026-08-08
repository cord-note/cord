import { useEffect, useRef, useCallback, useState } from 'react';
import { X, List, ListOrdered, CheckSquare, Quote, Code2, Minus, Sigma, Tag } from 'lucide-react';
import { EditorContent } from '@tiptap/react';
import { FragmentOverlay } from './editor/FragmentOverlay';
import { EditorContextMenu } from './editor/EditorContextMenu';
import { useFragmentStore } from '../store/fragments';
import { useNoteStore } from '../store/notes';
import { useTagStore } from '../store/tags';
import { useVaultStore } from '../store/vaults';
import { useSettingsStore } from '../store/settings';
import { useUIStore } from '../store/ui';
import type { Note } from '@shared/types';
import styles from './Editor.module.css';

import { WikiLinkPills } from './editor/WikiLinkPills';
import { useNoteDoc } from './editor/useNoteDoc';
import BlockChrome from './editor/BlockChrome';
import BlockRefPicker from './editor/BlockRefPicker';
import { OPEN_REF_PICKER_EVENT } from './editor/blockTarget';

const SAVE_DEBOUNCE_MS = 750;

interface Props {
  note: Note;
}

export default function Editor({ note }: Props) {
  const { updateNote, backlinks, notes, setActiveNote, loadLinks,
          activeNoteTags, loadNoteTags, attachTag, detachTag,
          unlinkedMentions, loadUnlinkedMentions } = useNoteStore();
  const { unlinkedMentions: mentionsEnabled } = useSettingsStore();
  const { tags, createTag } = useTagStore();
  const { activeVaultId } = useVaultStore();
  const { setView } = useUIStore();
  const [showTagPicker, setShowTagPicker] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [showRefPicker, setShowRefPicker] = useState(false);

  const noteIdRef = useRef(note.id);
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const { loadForNote: loadFragments, pendingScroll, setPendingScroll } = useFragmentStore();

  const [localTitle, setLocalTitle] = useState(note.title);

  // The editor instance, its save cycle and its counters.
  const { editor, wordCount, charCount, outboundMentions } = useNoteDoc(note);
  const isNotepad = note.kind === 'notepad';

  useEffect(() => {
    noteIdRef.current = note.id;
    setLocalTitle(note.title);
    loadNoteTags(note.id);
    loadFragments(note.id);
    if (mentionsEnabled) loadUnlinkedMentions(note.id, note.vaultId);
    setShowTagPicker(false);
  }, [note.id, note.title]); // eslint-disable-line react-hooks/exhaustive-deps

  // The slash menu cannot open a React modal itself, so it asks for one.
  useEffect(() => {
    function onOpen() { setShowRefPicker(true); }
    window.addEventListener(OPEN_REF_PICKER_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_REF_PICKER_EVENT, onOpen);
  }, []);

  useEffect(() => {
    if (!pendingScroll || !editor) return;
    setPendingScroll(null);
    const t = setTimeout(() => {
      const el = editor.view.dom.querySelector(`[data-block-id="${pendingScroll}"]`) as HTMLElement | null;
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 80);
    return () => clearTimeout(t);
  }, [pendingScroll, editor, setPendingScroll]);

  useEffect(() => {
    function onCmd(e: Event) {
      const { cmd } = (e as CustomEvent<{ cmd: string }>).detail;
      if (!editor || editor.isDestroyed) return;
      switch (cmd) {
        case 'bold':      editor.chain().focus().toggleBold().run(); break;
        case 'italic':    editor.chain().focus().toggleItalic().run(); break;
        case 'h1':        editor.chain().focus().toggleHeading({ level: 1 }).run(); break;
        case 'h2':        editor.chain().focus().toggleHeading({ level: 2 }).run(); break;
        case 'h3':        editor.chain().focus().toggleHeading({ level: 3 }).run(); break;
        case 'codeBlock': editor.chain().focus().toggleCodeBlock().run(); break;
        case 'taskList':  editor.chain().focus().toggleTaskList().run(); break;
        case 'hr':
          // In a notepad a divider is its own block; setHorizontalRule would
          // try to place one inside the current block, where it cannot go.
          if (isNotepad) {
            editor.chain().focus().command(({ commands, state }) =>
              commands.replaceBlockWith(state.selection.from, [{ type: 'horizontalRule' }]),
            ).run();
          } else {
            editor.chain().focus().setHorizontalRule().run();
          }
          break;

        // Notepad-only. The command bar hides these for a plain note, but guard
        // anyway — the event is on `window` and anything can dispatch it.
        case 'block:moveUp':    if (isNotepad) editor.commands.moveBlock(editor.state.selection.from, -1); break;
        case 'block:moveDown':  if (isNotepad) editor.commands.moveBlock(editor.state.selection.from, 1); break;
        case 'block:duplicate': if (isNotepad) editor.commands.duplicateBlock(editor.state.selection.from); break;
        case 'block:delete':    if (isNotepad) editor.commands.deleteBlock(editor.state.selection.from); break;
        case 'block:insertRef': if (isNotepad) setShowRefPicker(true); break;
      }
    }
    window.addEventListener('corddb:editor-command', onCmd);
    return () => window.removeEventListener('corddb:editor-command', onCmd);
  }, [editor, isNotepad]);

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

  function ToolbarBtn({
    onClick,
    active,
    title,
    children,
  }: {
    onClick: () => void;
    active?: boolean;
    title: string;
    children: React.ReactNode;
  }) {
    return (
      <button
        className={`${styles.toolbarBtn} ${active ? styles.toolbarBtnActive : ''}`}
        onMouseDown={(e) => {
          e.preventDefault();
          onClick();
        }}
        title={title}
      >
        {children}
      </button>
    );
  }

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
          <div className={styles.tagPickerInline}>
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

      {editor && (
        <div className={styles.toolbar}>
          <ToolbarBtn
            onClick={() => editor.chain().focus().toggleBold().run()}
            active={editor.isActive('bold')}
            title="Bold (Ctrl+B)"
          >
            <strong>B</strong>
          </ToolbarBtn>
          <ToolbarBtn
            onClick={() => editor.chain().focus().toggleItalic().run()}
            active={editor.isActive('italic')}
            title="Italic (Ctrl+I)"
          >
            <em>I</em>
          </ToolbarBtn>
          <ToolbarBtn
            onClick={() => editor.chain().focus().toggleCode().run()}
            active={editor.isActive('code')}
            title="Inline code"
          >
            {'</>'}
          </ToolbarBtn>
          <div className={styles.toolbarDivider} />
          <ToolbarBtn
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
            active={editor.isActive('heading', { level: 1 })}
            title="Heading 1"
          >
            H1
          </ToolbarBtn>
          <ToolbarBtn
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            active={editor.isActive('heading', { level: 2 })}
            title="Heading 2"
          >
            H2
          </ToolbarBtn>
          <ToolbarBtn
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
            active={editor.isActive('heading', { level: 3 })}
            title="Heading 3"
          >
            H3
          </ToolbarBtn>
          <div className={styles.toolbarDivider} />
          <ToolbarBtn
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            active={editor.isActive('bulletList')}
            title="Bullet list"
          >
            <List size={14} strokeWidth={1.75} />
          </ToolbarBtn>
          <ToolbarBtn
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            active={editor.isActive('orderedList')}
            title="Ordered list"
          >
            <ListOrdered size={14} strokeWidth={1.75} />
          </ToolbarBtn>
          <ToolbarBtn
            onClick={() => editor.chain().focus().toggleTaskList().run()}
            active={editor.isActive('taskList')}
            title="Task list (Ctrl+Enter to toggle)"
          >
            <CheckSquare size={14} strokeWidth={1.75} />
          </ToolbarBtn>
          <ToolbarBtn
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            active={editor.isActive('blockquote')}
            title="Blockquote"
          >
            <Quote size={14} strokeWidth={1.75} />
          </ToolbarBtn>
          <ToolbarBtn
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
            active={editor.isActive('codeBlock')}
            title="Code block"
          >
            <Code2 size={14} strokeWidth={1.75} />
          </ToolbarBtn>
          <div className={styles.toolbarDivider} />
          <ToolbarBtn
            onClick={() => editor.chain().focus().setHorizontalRule().run()}
            active={false}
            title="Divider"
          >
            <Minus size={14} strokeWidth={1.75} />
          </ToolbarBtn>
          <ToolbarBtn
            onClick={() =>
              editor
                .chain()
                .focus()
                .insertContent({ type: 'mathInline', attrs: { latex: '' } })
                .run()
            }
            active={editor.isActive('mathInline')}
            title="Math formula (inline)"
          >
            <Sigma size={14} strokeWidth={1.75} />
          </ToolbarBtn>
        </div>
      )}

      <div className={`${styles.content} ${isNotepad ? styles.notepad : ''}`} ref={contentRef}>
        <EditorContent editor={editor} />
        {editor && isNotepad && (
          <BlockChrome
            editor={editor}
            noteId={note.id}
            vaultId={note.vaultId}
            contentEl={contentRef.current}
          />
        )}
        {editor && (
          <FragmentOverlay
            editor={editor}
            noteId={note.id}
            contentEl={contentRef.current}
          />
        )}
        {editor && (
          <WikiLinkPills
            editor={editor}
            contentEl={contentRef.current}
          />
        )}
      </div>

      {editor && <EditorContextMenu editor={editor} noteId={note.id} />}

      {editor && showRefPicker && (
        <BlockRefPicker
          editor={editor}
          currentNoteId={note.id}
          onClose={() => setShowRefPicker(false)}
        />
      )}

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
          <span className={styles.statusDim}>{wordCount} words</span>
          <span className={styles.statusDot} />
          <span className={styles.statusDim}>{charCount} chars</span>
        </div>
      </div>
    </div>
  );
}

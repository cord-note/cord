import { useEffect, useRef, useCallback, useState } from 'react';
import { X, List, ListOrdered, CheckSquare, Quote, Code2, Minus, Sigma, Tag } from 'lucide-react';
import { useEditor, EditorContent } from '@tiptap/react';
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { BlockId } from './editor/BlockId';
import { FragmentLinkNode } from './editor/FragmentLinkNode';
import { FragmentOverlay } from './editor/FragmentOverlay';
import { EditorContextMenu } from './editor/EditorContextMenu';
import { useFragmentStore } from '../store/fragments';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import { CustomTaskItem } from './editor/CustomTaskItem';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { common, createLowlight } from 'lowlight';
import { useNoteStore } from '../store/notes';
import { useTagStore } from '../store/tags';
import { useVaultStore } from '../store/vaults';
import { useSettingsStore } from '../store/settings';
import { useUIStore } from '../store/ui';
import { api } from '../ipc';
import type { Note } from '@shared/types';
import styles from './Editor.module.css';

import { SlashCommand } from './editor/SlashCommand';
import { WikiLink } from './editor/WikiLink';
import { MathInline, MathBlock } from './editor/Math';
import { WikiLinkPills } from './editor/WikiLinkPills';
import { UnlinkedMentionDecorations } from './editor/UnlinkedMentionDecorations';
import { markdownClipboardProps } from './editor/markdownClipboard';

const lowlight = createLowlight(common);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function collectLinkIds(doc: any): Set<string> {
  const ids = new Set<string>();
  doc.descendants((node: { type: { name: string }; attrs: Record<string, unknown> }) => {
    if (node.type.name === 'fragmentLinkNode' && node.attrs.linkId) {
      ids.add(node.attrs.linkId as string);
    }
  });
  return ids;
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A valid, empty ProseMirror document. */
function emptyDoc(): Record<string, unknown> {
  return { type: 'doc', content: [{ type: 'paragraph' }] };
}

/**
 * Parse a stored body into a ProseMirror document.
 *
 * A new note's body_json is '{}' — the column default — which parses cleanly
 * but is NOT a valid doc, so Tiptap throws "Unknown node type: undefined".
 * Guarding with try/catch alone is not enough: the shape has to be checked,
 * not just the JSON syntax.
 */
function parseBody(bodyJson: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(bodyJson);
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      (parsed as { type?: unknown }).type === 'doc'
    ) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Malformed JSON — fall through to an empty document.
  }
  return emptyDoc();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function computeOutboundMentions(doc: any, notes: Note[], currentNoteId: string): Note[] {
  const linkedIds = new Set<string>();
  const textParts: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  doc.descendants((node: any) => {
    if (node.type.name === 'wikiLink') {
      if (node.attrs.id) linkedIds.add(node.attrs.id as string);
      return false;
    }
    if (node.isText && node.text) textParts.push(node.text as string);
  });
  const fullText = textParts.join(' ');
  return notes.filter((n) => {
    if (n.id === currentNoteId || linkedIds.has(n.id)) return false;
    const title = (n.title || '').trim();
    if (title.length < 3) return false;
    return new RegExp(`(?<![\\w])${escapeRe(title)}(?![\\w])`, 'i').test(fullText);
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function collectWikiLinkTargets(doc: any): Set<string> {
  const ids = new Set<string>();
  doc.descendants((node: { type: { name: string }; attrs: Record<string, unknown> }) => {
    if (node.type.name === 'wikiLink' && node.attrs.id) {
      ids.add(node.attrs.id as string);
    }
  });
  return ids;
}

const AltGrSupport = Extension.create({
  name: 'altGrSupport',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey('altGrSupport'),
      props: {
        handleKeyDown(_view, event) {
          if (event.ctrlKey && event.altKey) return false;
          return false;
        },
      },
    })];
  },
});

const ToggleTaskItem = Extension.create({
  name: 'toggleTaskItem',
  addKeyboardShortcuts() {
    return {
      'Mod-Enter': ({ editor }) => {
        if (!editor.isActive('taskItem')) return false;
        const { checked } = editor.getAttributes('taskItem');
        return editor.commands.updateAttributes('taskItem', { checked: !checked });
      },
    };
  },
});

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
  const [wordCount, setWordCount] = useState(0);
  const [charCount, setCharCount] = useState(0);
  const [outboundMentions, setOutboundMentions] = useState<Note[]>([]);

  const noteIdRef = useRef(note.id);
  const notesRef  = useRef(notes);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const activeLinkIds = useRef<Set<string>>(new Set());
  const activeWikiTargets = useRef<Set<string>>(new Set());
  const outboundTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { loadForNote: loadFragments, pendingScroll, setPendingScroll } = useFragmentStore();

  const [localTitle, setLocalTitle] = useState(note.title);

  notesRef.current = notes;

  useEffect(() => {
    noteIdRef.current = note.id;
    setLocalTitle(note.title);
    loadNoteTags(note.id);
    loadFragments(note.id);
    if (mentionsEnabled) loadUnlinkedMentions(note.id, note.vaultId);
    setShowTagPicker(false);
  }, [note.id, note.title]); // eslint-disable-line react-hooks/exhaustive-deps

  const editor = useEditor({
    extensions: [
      AltGrSupport,
      StarterKit.configure({ codeBlock: false }),
      Placeholder.configure({ placeholder: 'Start writing… or type / for commands' }),
      TaskList,
      CustomTaskItem,
      ToggleTaskItem,
      CodeBlockLowlight.configure({ lowlight }),
      SlashCommand,
      WikiLink,
      MathInline,
      MathBlock,
      BlockId,
      FragmentLinkNode,
      UnlinkedMentionDecorations,
    ],
    content: parseBody(note.bodyJson),
    // Pasted markdown renders as real nodes; copied selections leave as
    // markdown text rather than flattened plain text.
    editorProps: markdownClipboardProps,
    onUpdate: ({ editor }) => {
      const currentIds = collectLinkIds(editor.state.doc);
      for (const id of activeLinkIds.current) {
        if (!currentIds.has(id)) {
          api.fragments.deleteLink(id).catch(() => {});
        }
      }
      activeLinkIds.current = currentIds;

      const currentTargets = collectWikiLinkTargets(editor.state.doc);
      let linkDeleted = false;
      for (const toId of activeWikiTargets.current) {
        if (!currentTargets.has(toId)) {
          api.links.delete(noteIdRef.current, toId).catch(() => {});
          linkDeleted = true;
        }
      }
      activeWikiTargets.current = currentTargets;
      if (linkDeleted) loadLinks(noteIdRef.current);

      const text = editor.getText();
      setCharCount(text.length);
      setWordCount(text.trim() === '' ? 0 : text.trim().split(/\s+/).length);

      if (outboundTimer.current) clearTimeout(outboundTimer.current);
      outboundTimer.current = setTimeout(() => {
        setOutboundMentions(computeOutboundMentions(editor.state.doc, notesRef.current, noteIdRef.current));
      }, 800);

      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        updateNote(noteIdRef.current, {
          bodyJson: JSON.stringify(editor.getJSON()),
        });
      }, SAVE_DEBOUNCE_MS);
    },
  });

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    editor.commands.setContent(parseBody(note.bodyJson), false);
    activeLinkIds.current    = collectLinkIds(editor.state.doc);
    activeWikiTargets.current = collectWikiLinkTargets(editor.state.doc);
    const text = editor.getText();
    setCharCount(text.length);
    setWordCount(text.trim() === '' ? 0 : text.trim().split(/\s+/).length);
    setOutboundMentions(computeOutboundMentions(editor.state.doc, notesRef.current, note.id));
  }, [note.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
        case 'hr':        editor.chain().focus().setHorizontalRule().run(); break;
      }
    }
    window.addEventListener('corddb:editor-command', onCmd);
    return () => window.removeEventListener('corddb:editor-command', onCmd);
  }, [editor]);

  useEffect(() => {
    return () => {
      if (saveTimer.current)    clearTimeout(saveTimer.current);
      if (titleTimer.current)   clearTimeout(titleTimer.current);
      if (outboundTimer.current) clearTimeout(outboundTimer.current);
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

      <div className={styles.content} ref={contentRef}>
        <EditorContent editor={editor} />
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

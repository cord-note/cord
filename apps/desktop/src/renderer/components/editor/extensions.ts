import { Extension } from '@tiptap/core';
import type { Extensions } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { common, createLowlight } from 'lowlight';

import { BlockId } from './BlockId';
import { Block, NotepadDocument } from './Block';
import { BlockNormalizer } from './BlockNormalizer';
import { BlockRef } from './BlockRef';
import { CustomTaskItem } from './CustomTaskItem';
import { FragmentLinkNode } from './FragmentLinkNode';
import { SlashCommand } from './SlashCommand';
import { WikiLink } from './WikiLink';
import { MathInline, MathBlock } from './Math';
import { UnlinkedMentionDecorations } from './UnlinkedMentionDecorations';
import type { NoteKind } from '@shared/types';

const lowlight = createLowlight(common);

/**
 * AltGr produces Ctrl+Alt on Windows. Returning false leaves the event to the
 * browser so accented characters still type instead of firing a shortcut.
 */
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

/** Reorder shortcuts. Only registered for notepads — a plain note has no blocks. */
const BlockShortcuts = Extension.create({
  name: 'blockShortcuts',
  addKeyboardShortcuts() {
    return {
      'Alt-ArrowUp':   ({ editor }) => editor.commands.moveBlock(editor.state.selection.from, -1),
      'Alt-ArrowDown': ({ editor }) => editor.commands.moveBlock(editor.state.selection.from, 1),
      'Mod-Shift-d':   ({ editor }) => editor.commands.duplicateBlock(editor.state.selection.from),
      'Mod-Shift-Backspace': ({ editor }) => editor.commands.deleteBlock(editor.state.selection.from),
    };
  },
});

const PLACEHOLDER = 'Start writing… or type / for commands';

/**
 * Build the extension set for a note kind.
 *
 * The two sets differ only in how the document is structured — every feature
 * extension is shared, so nothing has to be implemented twice. Exactly one
 * editor is mounted at a time, so the two schemas never coexist.
 */
export function buildExtensions(kind: NoteKind): Extensions {
  const shared: Extensions = [
    AltGrSupport,
    Placeholder.configure({ placeholder: PLACEHOLDER }),
    TaskList,
    CustomTaskItem,
    ToggleTaskItem,
    CodeBlockLowlight.configure({ lowlight }),
    WikiLink,
    MathInline,
    MathBlock,
    FragmentLinkNode,
    UnlinkedMentionDecorations,
  ];

  if (kind === 'notepad') {
    return [
      // `document: false` hands the doc node to NotepadDocument, whose content
      // spec is `block+`. StarterKit's own Document would allow bare paragraphs
      // at the top level, which is precisely what a notepad must forbid.
      StarterKit.configure({ codeBlock: false, document: false }),
      NotepadDocument,
      Block,
      BlockNormalizer,
      BlockRef,
      BlockShortcuts,
      SlashCommand.configure({ mode: 'notepad' }),
      ...shared,
    ];
  }

  return [
    StarterKit.configure({ codeBlock: false }),
    // In a notepad the block wrapper carries the id; in a plain note it is
    // stamped directly onto the annotatable nodes.
    BlockId,
    SlashCommand.configure({ mode: 'note' }),
    ...shared,
  ];
}

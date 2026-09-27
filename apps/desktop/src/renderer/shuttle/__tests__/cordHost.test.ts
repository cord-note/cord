import { describe, expect, it } from 'bun:test';
import { createCordHost, type CordHostDeps, type HostNote } from '../cordHost';
import type { Block, BlockRefTarget } from '@shared/types';

// The host is Shuttle's only window into Cord. Every dependency is injected so
// these tests exercise the mapping without Tauri, stores or IPC.

const note = (id: string, title: string, deletedAt: number | null = null): HostNote => ({ id, title, deletedAt });

interface Harness {
  deps: CordHostDeps;
  calls: Record<string, unknown[][]>;
  setNotes(next: HostNote[]): void;
}

function harness(overrides: Partial<CordHostDeps> = {}): Harness {
  const calls: Record<string, unknown[][]> = {};
  const record = (name: string) => (...args: unknown[]): void => { (calls[name] ??= []).push(args); };
  let notes: HostNote[] = [note('a', 'Alpha'), note('b', 'Beta'), note('c', 'alphabet soup'), note('d', 'Alpine', 1)];
  const deps: CordHostDeps = {
    getNotes: () => notes,
    getActiveVaultId: () => 'v1',
    api: {
      blocks: {
        listForNote: async (noteId) => [
          { id: 'b1', noteId, vaultId: 'v1', type: 'heading', sort: 0, level: 2, text: 'Head', refBlockId: null, createdAt: 0, updatedAt: 0 },
        ] satisfies Block[],
        resolveRef: async (blockId): Promise<BlockRefTarget | null> => (blockId === 'b1'
          ? { blockId: 'b1', noteId: 'a', noteTitle: 'Alpha', type: 'paragraph', contentJson: '{"type":"paragraph"}' }
          : null),
      },
      attachments: {
        create: async (input) => {
          record('upload')(input);
          return { id: 'att1', vaultId: input.vaultId, mime: input.mime, size: 3, sha256: 'x', createdAt: 0, deletedAt: null };
        },
      },
      fragments: { deleteLink: async (linkId) => { record('deleteLink')(linkId); } },
    },
    convertFileSrc: (path, protocol) => `${protocol}://localhost/${path}`,
    openNote: record('openNote'),
    onFragmentAction: record('onFragmentAction'),
    reloadFragments: record('reloadFragments'),
    onLinksMaybeChanged: record('onLinksMaybeChanged'),
    keybindingOverrides: { 'editor.bold': 'Mod+J' },
    log: record('log'),
    ...overrides,
  };
  return { deps, calls, setNotes: (next) => { notes = next; } };
}

describe('createCordHost lookups', () => {
  it('searches live notes by title, case-insensitively', async () => {
    const host = createCordHost(harness().deps);
    expect((await host.searchNotes('al')).map((n) => n.id)).toEqual(['a', 'c']);
    expect(await host.searchNotes('zzz')).toEqual([]);
  });

  it('caps search results at 20', async () => {
    const h = harness();
    h.setNotes(Array.from({ length: 30 }, (_, i) => note(`n${i}`, `Note ${i}`)));
    expect(await createCordHost(h.deps).searchNotes('note')).toHaveLength(20);
  });

  it('finds a note by exact, trimmed, case-insensitive title', () => {
    const host = createCordHost(harness().deps);
    expect(host.findNoteByTitle(' alpha ')).toEqual({ id: 'a', title: 'Alpha' });
    expect(host.findNoteByTitle('alp')).toBeNull();
    expect(host.findNoteByTitle('alpine')).toBeNull();
  });

  it('keeps the title list identity until the notes change', () => {
    const h = harness();
    const host = createCordHost(h.deps);
    const first = host.listNoteTitles();
    expect(host.listNoteTitles()).toBe(first);
    expect(first.map((n) => n.id)).toEqual(['a', 'b', 'c']);
    h.setNotes([note('z', 'Zeta')]);
    const second = host.listNoteTitles();
    expect(second).not.toBe(first);
    expect(second).toEqual([{ id: 'z', title: 'Zeta' }]);
  });

  it('maps blocks and resolved references', async () => {
    const host = createCordHost(harness().deps);
    expect(await host.listBlocks('a')).toEqual([{ id: 'b1', noteId: 'a', type: 'heading', text: 'Head', level: 2 }]);
    expect(await host.resolveBlock('b1')).toEqual({ blockId: 'b1', noteId: 'a', noteTitle: 'Alpha', content: { type: 'paragraph' } });
    expect(await host.resolveBlock('gone')).toBeNull();
  });

  it('turns attachment srcs into cord-attachment URLs and leaves others alone', () => {
    const host = createCordHost(harness().deps);
    expect(host.resolveFileSrc('attachment:abc')).toBe('cord-attachment://localhost/abc');
    expect(host.resolveFileSrc('https://example.com/x.png')).toBe('https://example.com/x.png');
  });

  it('passes the keybinding overrides through', () => {
    expect(createCordHost(harness().deps).keybindings).toEqual({ 'editor.bold': 'Mod+J' });
  });
});

describe('createCordHost side effects', () => {
  it('uploads a file as base64 into the active vault', async () => {
    const h = harness();
    const file = new File([new Uint8Array([1, 2, 3])], 'x.png', { type: 'image/png' });
    expect(await createCordHost(h.deps).uploadFile(file)).toEqual({ src: 'attachment:att1' });
    expect(h.calls['upload']).toEqual([[{ vaultId: 'v1', mime: 'image/png', dataBase64: 'AQID' }]]);
  });

  it('refuses to upload without an active vault', async () => {
    const host = createCordHost(harness({ getActiveVaultId: () => null }).deps);
    await expect(host.uploadFile(new File(['x'], 'x.png', { type: 'image/png' }))).rejects.toThrow();
  });

  it('deletes removed fragment links, then reloads fragments once', async () => {
    const h = harness();
    createCordHost(h.deps).onFragmentLinksRemoved('n1', ['l1', 'l2']);
    await new Promise((r) => setTimeout(r, 0));
    expect(h.calls['deleteLink']).toEqual([['l1'], ['l2']]);
    expect(h.calls['reloadFragments']).toEqual([['n1']]);
  });

  it('forwards navigation, fragment actions and link changes', () => {
    const h = harness();
    const host = createCordHost(h.deps);
    host.openNote('b', 'blk');
    host.onFragmentAction({ docKey: 'a', type: 'tag', blockId: 'x' });
    host.onLinksChanged('a', { added: ['b'], removed: [] });
    host.log('warn', 'hello', { n: 1 });
    expect(h.calls['openNote']).toEqual([['b', 'blk']]);
    expect(h.calls['onFragmentAction']).toEqual([[{ docKey: 'a', type: 'tag', blockId: 'x' }]]);
    expect(h.calls['onLinksMaybeChanged']).toEqual([['a']]);
    expect(h.calls['log']).toEqual([['warn', 'shuttle', 'hello', { n: 1 }]]);
  });
});

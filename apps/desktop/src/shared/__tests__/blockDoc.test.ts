import { describe, expect, it } from 'bun:test';
import { parseDoc, extractBlocks, findBlockContent, EMPTY_DOC_JSON, type DocNode } from '../blockDoc';

// These helpers decide what lands in the `blocks` index, so their edge cases are
// the ones that quietly lose user data: a wrong id means fragment tags detach
// from their block.

const para = (text?: string, blockId?: string): DocNode => ({
  type: 'paragraph',
  ...(blockId ? { attrs: { blockId } } : {}),
  ...(text ? { content: [{ type: 'text', text }] } : {}),
});

const doc = (...content: DocNode[]): DocNode => ({ type: 'doc', content });
const empty = (): DocNode => JSON.parse(EMPTY_DOC_JSON) as DocNode;

describe('parseDoc', () => {
  it('falls back to an empty doc for the "{}" column default', () => {
    expect(parseDoc('{}')).toEqual(empty());
  });

  it('falls back on malformed JSON', () => {
    expect(parseDoc('{not json')).toEqual(empty());
  });

  it('falls back on JSON that parses but is not a document', () => {
    expect(parseDoc('{"type":"paragraph"}')).toEqual(empty());
    expect(parseDoc('null')).toEqual(empty());
    expect(parseDoc('[]')).toEqual(empty());
  });

  it('rejects a doc with no content rather than handing back an empty shell', () => {
    expect(parseDoc('{"type":"doc","content":[]}')).toEqual(empty());
  });

  it('keeps a valid document as-is', () => {
    const valid = doc(para('hello', 'p1'));
    expect(parseDoc(JSON.stringify(valid))).toEqual(valid);
  });
});

describe('extractBlocks', () => {
  it('indexes every top-level node by its blockId, with type and level', () => {
    const blocks = extractBlocks(
      doc(
        { type: 'heading', attrs: { level: 2, blockId: 'h1' }, content: [{ type: 'text', text: 'Title' }] },
        { type: 'bulletList', attrs: { blockId: 'l1' }, content: [{ type: 'listItem', content: [para('item')] }] },
        { type: 'blockMath', attrs: { blockId: 'm1', latex: 'E=mc^2' } },
      ),
      'note-1',
    );

    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toMatchObject({ id: 'h1', type: 'heading', level: 2, sort: 0, text: 'Title', synthetic: false });
    // A whole list is one block — a query for bulletList must match the container.
    expect(blocks[1]).toMatchObject({ id: 'l1', type: 'bulletList', level: null, sort: 1, text: 'item' });
    expect(blocks[2]).toMatchObject({ id: 'm1', type: 'blockMath', text: 'E=mc^2' });
  });

  it('includes the text atoms stand for, so links and formulas are searchable', () => {
    const blocks = extractBlocks(doc({
      type: 'paragraph',
      attrs: { blockId: 'p1' },
      content: [
        { type: 'text', text: 'see ' },
        { type: 'mention', attrs: { id: 'n2', label: 'Alpha', displayText: null } },
        { type: 'text', text: ' and ' },
        { type: 'inlineMath', attrs: { latex: 'x^2' } },
      ],
    }), 'note-1');
    expect(blocks[0]!.text).toBe('see Alpha and x^2');
  });

  it('gives id-less nodes a deterministic synthetic id', () => {
    const input = doc(para('one', 'p1'), { type: 'bulletList', content: [{ type: 'listItem', content: [para('x')] }] });
    const first = extractBlocks(input, 'note-1');
    const second = extractBlocks(input, 'note-1');

    expect(first[1]).toMatchObject({ id: 'note-1:1', synthetic: true });
    // A fresh id per reproject would churn primary keys and orphan anything
    // pointing at them.
    expect(second[1]!.id).toBe(first[1]!.id);
  });

  it('keeps the first of two nodes sharing an id, and synthesises for the rest', () => {
    // The index has a primary key on the id, so a duplicate would crash the
    // reprojection — which happens during boot.
    const blocks = extractBlocks(
      doc(para('first', 'dup'), para('second', 'dup'), para('third', 'dup')),
      'note-1',
    );

    expect(blocks[0]).toMatchObject({ id: 'dup', synthetic: false });
    expect(blocks[1]).toMatchObject({ id: 'note-1:1', synthetic: true });
    expect(blocks[2]).toMatchObject({ id: 'note-1:2', synthetic: true });
  });

  it('records a blockRef target, and null for everything else', () => {
    const blocks = extractBlocks(
      doc({ type: 'blockRef', attrs: { blockId: 'r1', refBlockId: 'src-1', refNoteId: 'note-2' } }, para('x', 'p1')),
      'note-1',
    );
    expect(blocks[0]).toMatchObject({ id: 'r1', type: 'blockRef', refBlockId: 'src-1' });
    expect(blocks[1]!.refBlockId).toBeNull();
  });

  it('reads through the notepadBlock wrapper of notes written before Shuttle', () => {
    // Old notes open read-only and are never rewritten, but must stay searchable.
    const legacy = doc({
      type: 'notepadBlock',
      attrs: { blockId: 'L1' },
      content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Old' }] }],
    });
    expect(extractBlocks(legacy, 'note-1')[0]).toMatchObject({
      id: 'L1', synthetic: false, type: 'heading', level: 2, text: 'Old',
    });
  });
});

describe('findBlockContent', () => {
  const source = doc(para('first', 'b1'), para('second', 'b2'), para('dup', 'b1'));

  it('returns the content node of a real block', () => {
    expect(findBlockContent(source, 'b2')).toEqual(para('second', 'b2'));
  });

  it('returns null for an unknown id', () => {
    expect(findBlockContent(source, 'nope')).toBeNull();
  });

  it('resolves a duplicated id to its first occurrence only', () => {
    expect(findBlockContent(source, 'b1')).toEqual(para('first', 'b1'));
  });

  it('never resolves a synthetic id', () => {
    // Synthetic ids are positional, so honouring one as a ref target would make
    // the reference silently point at different content after any edit.
    const plain = doc({ type: 'bulletList', content: [{ type: 'listItem', content: [para('x')] }] });
    expect(findBlockContent(plain, ':0')).toBeNull();
  });
});

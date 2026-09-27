import { describe, expect, it } from 'bun:test';
import { outboundMentions } from '../outboundMentions';
import type { DocNode } from '@shared/blockDoc';

// Notes this document names in plain text without linking them — the status
// bar offers to turn each into a wiki link.

const notes = [
  { id: 'n1', title: 'Photosynthesis' },
  { id: 'n2', title: 'Café' },
  { id: 'n3', title: 'AI' },
  { id: 'n4', title: 'Cell' },
  { id: 'self', title: 'Biology' },
];

const doc = (...content: DocNode[]): DocNode => ({ type: 'doc', content });
const p = (...content: DocNode[]): DocNode => ({ type: 'paragraph', content });
const t = (text: string): DocNode => ({ type: 'text', text });

const ids = (d: DocNode): string[] => outboundMentions(d, notes, 'self').map((n) => n.id);

describe('outboundMentions', () => {
  it('finds titles mentioned as whole words, case-insensitively', () => {
    expect(ids(doc(p(t('photosynthesis happens in every cell.'))))).toEqual(['n1', 'n4']);
  });

  it('respects word boundaries in any script', () => {
    // "Cellular" is not "Cell", and "Cafés" is not "Café".
    expect(ids(doc(p(t('Cellular respiration and Cafés'))))).toEqual([]);
    expect(ids(doc(p(t('Meet at the café.'))))).toEqual(['n2']);
  });

  it('skips titles shorter than three characters', () => {
    expect(ids(doc(p(t('AI is everywhere'))))).toEqual([]);
  });

  it('skips notes already wiki-linked, and the current note', () => {
    const linked = doc(p(
      t('Photosynthesis and '),
      { type: 'mention', attrs: { id: 'n1', label: 'Photosynthesis' } },
      t(' in Biology'),
    ));
    expect(ids(linked)).toEqual([]);
  });

  it('does not read text inside links as a mention', () => {
    const d = doc(p({ type: 'mention', attrs: { id: 'n1', label: 'Cell' }, content: [t('Cell')] }));
    expect(ids(d)).toEqual([]);
  });

  it('reads text across blocks', () => {
    expect(ids(doc(p(t('first')), { type: 'bulletList', content: [{ type: 'listItem', content: [p(t('a cell'))] }] })))
      .toEqual(['n4']);
  });
});

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as Y from 'yjs';
import { yXmlFragmentToProsemirrorJSON } from '@tiptap/y-tiptap';

// Written by cord-core (crates/cord-core/src/doc/yjs.rs). Same files, both sides.
const DIR = join(import.meta.dir, '../../../../../crates/cord-core/fixtures/docs');

type Json = { [k: string]: unknown };

// y-tiptap keeps mark order from Yjs; cord-core sorts by type. Order is not meaningful.
function sortMarks(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(sortMarks);
  if (node === null || typeof node !== 'object') return node;
  const out: Json = {};
  for (const [k, v] of Object.entries(node as Json)) out[k] = sortMarks(v);
  if (Array.isArray(out['marks'])) {
    out['marks'] = [...(out['marks'] as { type: string }[])].sort((a, b) => a.type.localeCompare(b.type));
  }
  return out;
}

const names = readdirSync(DIR)
  .filter((f) => f.endsWith('.input.json'))
  .map((f) => f.slice(0, -'.input.json'.length))
  .sort();

describe('cord-core Yjs fixtures', () => {
  test('there are fixtures to check', () => {
    expect(names.length).toBe(5);
  });

  for (const name of names) {
    test(`${name}: y-tiptap reads what cord-core wrote`, () => {
      const doc = new Y.Doc();
      Y.applyUpdate(doc, new Uint8Array(readFileSync(join(DIR, `${name}.ybin`))));
      const json = yXmlFragmentToProsemirrorJSON(doc.getXmlFragment('default'));
      const expected: unknown = JSON.parse(readFileSync(join(DIR, `${name}.expected.json`), 'utf8'));
      expect(sortMarks(json)).toEqual(expected);
    });
  }
});

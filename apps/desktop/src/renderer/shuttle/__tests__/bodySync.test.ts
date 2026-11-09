import { describe, it, expect } from 'bun:test';
import * as Y from 'yjs';
import { BodySync, LOAD, REMOTE, applyRemoteUpdate, loadDoc } from '../bodySync';

describe('applyRemoteUpdate', () => {
  it('merges an agent edit into the open note without sending it back', async () => {
    const doc = new Y.Doc();
    const sent: Uint8Array[] = [];
    const sync = new BodySync('n1', doc, async (_id, u) => { sent.push(u); }, () => 0);
    const other = new Y.Doc();
    other.getXmlFragment('default').insert(0, [new Y.XmlElement('paragraph')]);
    const update = Y.encodeStateAsUpdate(other);

    expect(applyRemoteUpdate(doc, 'n1', { noteId: 'n2', update: Array.from(update) })).toBe(false);
    expect(applyRemoteUpdate(doc, 'n1', { noteId: 'n1', update: Array.from(update) })).toBe(true);
    expect(doc.getXmlFragment('default').length).toBe(1);
    await sync.flush();
    expect(sent).toHaveLength(0);
  });
});

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function sink(): { sent: { id: string; update: Uint8Array }[]; send: (id: string, update: Uint8Array) => Promise<void> } {
  const sent: { id: string; update: Uint8Array }[] = [];
  return { sent, send: async (id, update) => { sent.push({ id, update }); } };
}

function text(update: Uint8Array): string {
  const copy = new Y.Doc();
  Y.applyUpdate(copy, update);
  return copy.getText('t').toString();
}

describe('BodySync', () => {
  it('sends one merged update after the delay', async () => {
    const doc = new Y.Doc();
    const { sent, send } = sink();
    const sync = new BodySync('n1', doc, send, () => 20);
    doc.getText('t').insert(0, 'a');
    doc.getText('t').insert(1, 'b');
    expect(sent).toHaveLength(0);
    await sleep(60);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.id).toBe('n1');
    expect(text(sent[0]!.update)).toBe('ab');
    await sync.dispose();
  });

  it('ignores what was loaded or arrived from elsewhere', async () => {
    const other = new Y.Doc();
    other.getText('t').insert(0, 'x');
    const doc = loadDoc(Y.encodeStateAsUpdate(other));
    const { sent, send } = sink();
    const sync = new BodySync('n1', doc, send, () => 5);
    other.getText('t').insert(1, 'y');
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(other), REMOTE);
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(other), LOAD);
    await sleep(30);
    expect(sent).toHaveLength(0);
    expect(doc.getText('t').toString()).toBe('xy');
    await sync.dispose();
  });

  it('sends what is pending when disposed, then stops listening', async () => {
    const doc = new Y.Doc();
    const { sent, send } = sink();
    const sync = new BodySync('n1', doc, send, () => 10_000);
    doc.getText('t').insert(0, 'late');
    await sync.dispose();
    expect(sent).toHaveLength(1);
    doc.getText('t').insert(0, 'after');
    await sleep(10);
    expect(sent).toHaveLength(1);
  });

  it('keeps an update whose send failed', async () => {
    const doc = new Y.Doc();
    let fail = true;
    const sent: Uint8Array[] = [];
    const sync = new BodySync('n1', doc, async (_id, u) => {
      if (fail) throw new Error('offline');
      sent.push(u);
    }, () => 10_000);
    doc.getText('t').insert(0, 'kept');
    await expect(sync.flush()).rejects.toThrow('offline');
    doc.getText('t').insert(4, '!');
    fail = false;
    await sync.flush();
    expect(sent).toHaveLength(1);
    expect(text(sent[0]!)).toBe('kept!');
    await sync.dispose();
  });

  it('loads an empty state as an empty doc', () => {
    expect(loadDoc(new Uint8Array()).getXmlFragment('default').length).toBe(0);
  });
});

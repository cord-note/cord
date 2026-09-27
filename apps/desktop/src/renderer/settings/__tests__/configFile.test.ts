import { describe, it, expect } from 'bun:test';
import { ConfigFileWriter, type ConfigFileIO } from '../configFile';

// Sliders change a setting many times a second. Writes are debounced, never
// overlap, and the last text always wins; a failed write is retried.

function fakeIO(): ConfigFileIO & { writes: string[]; fail: boolean; gate: Promise<void> | null } {
  const io = {
    writes: [] as string[],
    fail: false,
    gate: null as Promise<void> | null,
    read: async () => null,
    write: async (_file: 'settings' | 'keybindings', text: string) => {
      if (io.gate) await io.gate;
      if (io.fail) throw new Error('disk full');
      io.writes.push(text);
    },
  };
  return io;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('ConfigFileWriter', () => {
  it('coalesces scheduled writes into the latest text', async () => {
    const io = fakeIO();
    const writer = new ConfigFileWriter('settings', io, 20);
    writer.schedule('a');
    writer.schedule('b');
    writer.schedule('c');
    await sleep(40);
    expect(io.writes).toEqual(['c']);
  });

  it('flush writes immediately and is a no-op with nothing pending', async () => {
    const io = fakeIO();
    const writer = new ConfigFileWriter('settings', io, 10_000);
    writer.schedule('now');
    await writer.flush();
    await writer.flush();
    expect(io.writes).toEqual(['now']);
  });

  it('never runs two writes at once; the newest text lands last', async () => {
    const io = fakeIO();
    let open!: () => void;
    io.gate = new Promise((r) => { open = r; });
    const writer = new ConfigFileWriter('settings', io, 10_000);
    writer.schedule('first');
    const first = writer.flush();
    writer.schedule('second');
    const second = writer.flush();
    io.gate = null;
    open();
    await Promise.all([first, second]);
    expect(io.writes).toEqual(['first', 'second']);
  });

  it('keeps failed text pending, reports the error, and retries on the next flush', async () => {
    const io = fakeIO();
    const errors: unknown[] = [];
    const writer = new ConfigFileWriter('settings', io, 10_000);
    writer.onError = (e) => errors.push(e);
    io.fail = true;
    writer.schedule('x');
    await writer.flush();
    expect(errors).toHaveLength(1);
    io.fail = false;
    await writer.flush();
    expect(io.writes).toEqual(['x']);
  });
});

import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

// Nothing type-checks the string in invoke('notes_search') against the Rust
// command that receives it. A typo compiles, ships, and shows up as a button
// that silently does nothing. This test is the missing link.

const DESKTOP = join(import.meta.dir, '..', '..', '..', '..');

const libRs = readFileSync(join(DESKTOP, 'src-tauri', 'src', 'lib.rs'), 'utf8');
const ipcTs = readFileSync(join(DESKTOP, 'src', 'renderer', 'ipc', 'index.ts'), 'utf8');

function registeredCommands(): Set<string> {
  const block = libRs.split('generate_handler![')[1]?.split('])')[0];
  if (!block) throw new Error('could not find generate_handler! block in lib.rs');
  return new Set([...block.matchAll(/commands::\w+::(\w+)/g)].map((m) => m[1]!));
}

function invokedCommands(): Set<string> {
  return new Set([...ipcTs.matchAll(/invoke(?:<[^(]*?>)?\(\s*'([^']+)'/g)].map((m) => m[1]!));
}

describe('IPC parity', () => {
  it('finds commands on both sides', () => {
    expect(registeredCommands().size).toBeGreaterThan(20);
    expect(invokedCommands().size).toBeGreaterThan(20);
  });

  it('every invoked command is registered in lib.rs', () => {
    const registered = registeredCommands();
    const missing = [...invokedCommands()].filter((name) => !registered.has(name));
    expect(missing).toEqual([]);
  });

  it('every registered command is reachable from the renderer', () => {
    const invoked = invokedCommands();
    const unused = [...registeredCommands()].filter((name) => !invoked.has(name));
    expect(unused).toEqual([]);
  });
});

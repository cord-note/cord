// Compiles the sidecar for this machine only, where Tauri looks for it:
// src-tauri/binaries/cord-sidecar-<host triple>[.exe].
//
// `tauri dev` runs that binary rather than the TypeScript source, so without
// this step a dev session silently runs whatever sidecar was compiled last —
// new renderer, old backend. It runs before every `tauri dev` (see
// beforeDevCommand in tauri.conf.json) and takes about a second.
import { join } from 'node:path';

const BUN_TARGETS: Record<string, string> = {
  'x86_64-pc-windows-msvc': 'bun-windows-x64',
  'x86_64-unknown-linux-gnu': 'bun-linux-x64',
  'aarch64-unknown-linux-gnu': 'bun-linux-arm64',
  'aarch64-apple-darwin': 'bun-darwin-arm64',
  'x86_64-apple-darwin': 'bun-darwin-x64',
};

const rustc = Bun.spawnSync(['rustc', '-vV']);
const triple = /^host: (\S+)$/m.exec(rustc.stdout.toString())?.[1];
if (!triple) throw new Error('Could not read the host triple from `rustc -vV`');

const target = BUN_TARGETS[triple];
if (!target) throw new Error(`No Bun target for host ${triple}`);

const root = join(import.meta.dir, '..');
const outfile = join(root, 'src-tauri', 'binaries', `cord-sidecar-${triple}${triple.includes('windows') ? '.exe' : ''}`);

const build = Bun.spawnSync(
  ['bun', 'build', '--compile', `--target=${target}`, 'src/sidecar/index.ts', '--outfile', outfile],
  { cwd: root, stdout: 'inherit', stderr: 'inherit' },
);
if (build.exitCode !== 0) process.exit(build.exitCode ?? 1);

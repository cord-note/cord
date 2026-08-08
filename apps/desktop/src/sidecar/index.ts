import { runMigrations } from './db/migrations';
import { Router } from './router';
import { VaultService }    from './services/VaultService';
import { NoteService }     from './services/NoteService';
import { LinkService }     from './services/LinkService';
import { TagService }      from './services/TagService';
import { AuthService }     from './services/AuthService';
import { FragmentService } from './services/FragmentService';
import { BlockIndexService } from './services/BlockIndexService';
import { registerVaultHandlers }    from './handlers/vaults';
import { registerNoteHandlers }     from './handlers/notes';
import { registerTagHandlers }      from './handlers/tags';
import { registerLinkHandlers }     from './handlers/links';
import { registerFragmentHandlers } from './handlers/fragments';
import { registerAuthHandlers }     from './handlers/auth';
import { registerBlockHandlers }    from './handlers/blocks';

// ── Boot ──────────────────────────────────────────────────────────────────────

runMigrations();

// ── Services ──────────────────────────────────────────────────────────────────

const auth      = new AuthService();
const vaults    = new VaultService();
const blocks    = new BlockIndexService();
const notes     = new NoteService(blocks);
const links     = new LinkService();
const tags      = new TagService();
const fragments = new FragmentService();

// Existing notes predate the block index; back-fill so search works on first
// launch after upgrade. Idempotent, and a no-op once every note has rows.
const rebuilt = blocks.backfillMissing();
if (rebuilt > 0) console.info(`[db] block index built for ${rebuilt} notes`);

// ── Router ────────────────────────────────────────────────────────────────────

const router = new Router();

registerAuthHandlers(router, auth);
registerVaultHandlers(router, vaults, auth);
registerNoteHandlers(router, notes, auth);
registerTagHandlers(router, tags, auth);
registerLinkHandlers(router, links, auth);
registerFragmentHandlers(router, fragments, auth);
registerBlockHandlers(router, blocks, auth);

// ── Server ────────────────────────────────────────────────────────────────────

const server = Bun.serve({
  port: 0,       // let the OS assign a free port
  hostname: '127.0.0.1',
  async fetch(req) {
    return router.handle(req);
  },
  error(err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  },
});

// Tauri reads this line from stdout to know which port to forward to.
process.stdout.write(`SIDECAR_PORT=${server.port}\n`);

process.on('SIGTERM', () => {
  server.stop();
  process.exit(0);
});

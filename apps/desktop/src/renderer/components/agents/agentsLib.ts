import type { AgentActivity } from '@shared/types';

export interface ToolInfo { name: string; label: string; write: boolean }

/** The tools agents get, in the order the page lists them. */
export const TOOLS: ToolInfo[] = [
  { name: 'search',         label: 'Search notes',   write: false },
  { name: 'read_note',      label: 'Read notes',     write: false },
  { name: 'backlinks',      label: 'See backlinks',  write: false },
  { name: 'list_vaults',    label: 'List vaults',    write: false },
  { name: 'list_tags',      label: 'List tags',      write: false },
  { name: 'tag_table',      label: 'Read tag tables', write: false },
  { name: 'create_note',    label: 'Create notes',   write: true },
  { name: 'append_to_note', label: 'Add text',       write: true },
  { name: 'set_field',      label: 'Set fields',     write: true },
  { name: 'tag',            label: 'Tag',            write: true },
  { name: 'untag',          label: 'Untag',          write: true },
  { name: 'move_to_trash',  label: 'Move to trash',  write: true },
];

const VERBS: Record<string, string> = {
  search: 'searched for', read_note: 'read', backlinks: 'looked at backlinks of', list_vaults: 'listed vaults',
  list_tags: 'listed tags', tag_table: 'read a tag table', create_note: 'created', append_to_note: 'added text to',
  set_field: 'set a field on', tag: 'tagged', untag: 'untagged', move_to_trash: 'moved to trash',
};

/** "read", "created" and so on, for the activity list. */
export function verb(tool: string): string {
  return VERBS[tool] ?? tool;
}

export type ActivityFilter = 'all' | 'edits' | 'failed';

export function filterActivity(list: AgentActivity[], filter: ActivityFilter): AgentActivity[] {
  if (filter === 'failed') return list.filter((a) => !a.ok);
  if (filter === 'edits') return list.filter((a) => TOOLS.some((t) => t.write && t.name === a.tool));
  return list;
}

/** How often each tool was called in the log. */
export function toolCounts(list: AgentActivity[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const a of list) counts.set(a.tool, (counts.get(a.tool) ?? 0) + 1);
  return counts;
}

/** "just now", "5 min ago", "3 h ago", or the date. */
export function relativeTime(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(at).toLocaleDateString();
}

/** The config MCP clients that start a server process (Claude Desktop) need. */
export function clientConfig(exe: string, token: string): string {
  return JSON.stringify({ mcpServers: { cord: { command: exe, args: ['--mcp'], env: { CORD_MCP_TOKEN: token } } } }, null, 2);
}

/** The one-line command that adds Cord to Claude Code. */
export function claudeCodeCommand(exe: string, token: string): string {
  return `claude mcp add cord --env CORD_MCP_TOKEN=${token} -- "${exe}" --mcp`;
}

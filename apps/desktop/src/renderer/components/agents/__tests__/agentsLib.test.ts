import { describe, it, expect } from 'bun:test';
import type { AgentActivity } from '@shared/types';
import { claudeCodeCommand, clientConfig, filterActivity, relativeTime, toolCounts } from '../agentsLib';

const call = (tool: string, ok = true): AgentActivity => ({ at: 0, tool, target: null, ok, error: ok ? null : 'no', note: null });

describe('clientConfig', () => {
  it('starts this Cord with --mcp and the token', () => {
    const c = JSON.parse(clientConfig('C:\\Program Files\\Cord\\cord.exe', 'abc')) as {
      mcpServers: { cord: { command: string; args: string[]; env: Record<string, string> } };
    };
    expect(c.mcpServers.cord).toEqual({ command: 'C:\\Program Files\\Cord\\cord.exe', args: ['--mcp'], env: { CORD_MCP_TOKEN: 'abc' } });
  });

  it('quotes the path in the Claude Code command', () => {
    expect(claudeCodeCommand('C:\\A B\\cord.exe', 't')).toBe('claude mcp add cord --env CORD_MCP_TOKEN=t -- "C:\\A B\\cord.exe" --mcp');
  });
});

describe('activity helpers', () => {
  const list = [call('search'), call('create_note'), call('tag', false), call('search')];

  it('filters edits and failures', () => {
    expect(filterActivity(list, 'all')).toHaveLength(4);
    expect(filterActivity(list, 'edits').map((a) => a.tool)).toEqual(['create_note', 'tag']);
    expect(filterActivity(list, 'failed').map((a) => a.tool)).toEqual(['tag']);
  });

  it('counts calls per tool', () => {
    expect(toolCounts(list).get('search')).toBe(2);
    expect(toolCounts(list).get('read_note')).toBeUndefined();
  });

  it('says how long ago', () => {
    expect(relativeTime(0, 10_000)).toBe('just now');
    expect(relativeTime(0, 5 * 60_000)).toBe('5 min ago');
    expect(relativeTime(0, 3 * 3_600_000)).toBe('3 h ago');
  });
});

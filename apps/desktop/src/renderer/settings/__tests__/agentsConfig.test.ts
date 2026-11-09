import { describe, it, expect } from 'bun:test';
import { clientConfig } from '../../components/settings/agentsConfig';

describe('clientConfig', () => {
  it('starts this Cord with --mcp and the token', () => {
    const c = JSON.parse(clientConfig('C:\\Program Files\\Cord\\cord.exe', 'abc')) as {
      mcpServers: { cord: { command: string; args: string[]; env: Record<string, string> } };
    };
    expect(c.mcpServers.cord).toEqual({ command: 'C:\\Program Files\\Cord\\cord.exe', args: ['--mcp'], env: { CORD_MCP_TOKEN: 'abc' } });
  });
});

/** The config MCP clients that start a server process (Claude Desktop) need. */
export function clientConfig(exe: string, token: string): string {
  return JSON.stringify({ mcpServers: { cord: { command: exe, args: ['--mcp'], env: { CORD_MCP_TOKEN: token } } } }, null, 2);
}

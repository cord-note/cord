/**
 * The renderer's one sanctioned console sink. Everything else logs through
 * here, so a structured logger can replace this without touching call sites.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export function log(level: LogLevel, scope: string, message: string, data?: unknown): void {
  const line = `[${scope}] ${message}`;
  if (data === undefined) console[level](line);
  else console[level](line, data);
}

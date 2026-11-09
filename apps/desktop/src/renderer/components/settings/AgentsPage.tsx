import { useEffect, useState } from 'react';
import type { AgentActivity, AgentsState } from '@shared/types';
import { api } from '../../ipc';
import { useVaultStore } from '../../store/vaults';
import { log } from '../../lib/log';
import { clientConfig } from './agentsConfig';
import styles from './AgentsPage.module.css';

export default function AgentsPage() {
  const vaults = useVaultStore((s) => s.vaults);
  const [state, setState] = useState<AgentsState | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [activity, setActivity] = useState<AgentActivity[]>([]);

  useEffect(() => {
    const load = (): void => {
      void api.agents.get().then(setState);
      void api.agents.activity().then(setActivity);
    };
    load();
    const timer = setInterval(load, 3000); // Status and activity while the page is open.
    return () => clearInterval(timer);
  }, []);

  if (!state) return null;
  const save = (patch: Partial<AgentsState>): void => {
    const next = { ...state, ...patch };
    setState(next);
    api.agents.update({ allow: next.allow, edit: next.edit, vaults: next.vaults })
      .then(setState)
      .catch((e: unknown) => log('error', 'agents', 'Saving agent settings failed', { error: String(e) }));
  };
  const toggleVault = (id: string): void =>
    save({ vaults: state.vaults.includes(id) ? state.vaults.filter((v) => v !== id) : [...state.vaults, id] });
  const status = !state.allow ? 'Off'
    : !state.hasToken ? 'Generate a token to start'
    : state.port ? `Running on 127.0.0.1:${state.port}` : 'Starting…';

  return (
    <div className={styles.page}>
      <h2 className={styles.title}>Agents</h2>
      <p className={styles.muted}>
        Let AI agents (Claude Desktop, Claude Code and other MCP clients) search and read your notes while Cord
        is open and unlocked. They only see the vaults you tick below.
      </p>

      <label className={styles.row}>
        <input type="checkbox" checked={state.allow} onChange={(e) => save({ allow: e.target.checked })} />
        <span>Allow agents</span>
        <span className={styles.muted}>{status}</span>
      </label>
      <label className={styles.row}>
        <input type="checkbox" checked={state.edit} disabled={!state.allow} onChange={(e) => save({ edit: e.target.checked })} />
        <span>Agents can edit</span>
        <span className={styles.muted}>Create notes, add text, set fields, tag, move to trash. Never empties the trash.</span>
      </label>

      <h3 className={styles.heading}>Vaults agents can see</h3>
      {vaults.map((v) => (
        <label key={v.id} className={styles.row}>
          <input type="checkbox" checked={state.vaults.includes(v.id)} onChange={() => toggleVault(v.id)} />
          <span>{v.name}</span>
        </label>
      ))}

      <h3 className={styles.heading}>Connect a client</h3>
      <div className={styles.row}>
        <button type="button" className={styles.btn} onClick={() => void api.agents.newToken().then((r) => setToken(r.token))}>
          {state.hasToken ? 'Generate a new token' : 'Generate a token'}
        </button>
        {state.hasToken && !token && <span className={styles.muted}>A new token stops the old one working.</span>}
      </div>
      {token && (
        <>
          <p className={styles.muted}>Shown once. Paste this into your MCP client's config (for Claude Desktop: claude_desktop_config.json):</p>
          <pre className={styles.code}>{clientConfig(state.exe, token)}</pre>
          <div className={styles.row}>
            <button type="button" className={styles.btn} onClick={() => void navigator.clipboard.writeText(clientConfig(state.exe, token))}>Copy</button>
          </div>
        </>
      )}

      <h3 className={styles.heading}>Recent agent activity</h3>
      {activity.length === 0
        ? <p className={styles.muted}>Nothing yet.</p>
        : (
          <ul className={styles.activity}>
            {activity.slice(0, 50).map((a, i) => (
              <li key={i} className={a.ok ? undefined : styles.failed}>
                <span className={styles.muted}>{new Date(a.at).toLocaleString()}</span> {a.tool}
                {a.target ? <span className={styles.muted}> · {a.target}</span> : null}
                {a.error ? <span> · {a.error}</span> : null}
              </li>
            ))}
          </ul>
        )}
    </div>
  );
}

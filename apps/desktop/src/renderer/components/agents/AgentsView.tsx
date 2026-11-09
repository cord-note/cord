import { useEffect, useState } from 'react';
import { Check, Copy, KeyRound, Lock, Pencil, Eye } from 'lucide-react';
import type { AgentActivity } from '@shared/types';
import { api } from '../../ipc';
import { useAgentsStore } from '../../store/agents';
import { useVaultStore } from '../../store/vaults';
import { log } from '../../lib/log';
import {
  TOOLS, claudeCodeCommand, clientConfig, filterActivity, relativeTime, toolCounts, verb, type ActivityFilter,
} from './agentsLib';
import styles from './AgentsView.module.css';

type Client = 'desktop' | 'code';

interface Props {
  onOpenNote: (vaultId: string, noteId: string) => void;
}

function Switch({ on, disabled, label, onChange }: { on: boolean; disabled?: boolean; label: string; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      className={`${styles.switch} ${on ? styles.switchOn : ''}`}
      onClick={() => onChange(!on)}
    >
      <span className={styles.thumb} />
    </button>
  );
}

export default function AgentsView({ onOpenNote }: Props) {
  const vaults = useVaultStore((s) => s.vaults);
  const { state, activity, update } = useAgentsStore();
  const [token, setToken] = useState<string | null>(null);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [client, setClient] = useState<Client>('desktop');
  const [copied, setCopied] = useState(false);
  const [filter, setFilter] = useState<ActivityFilter>('all');
  const [now, setNow] = useState(() => Date.now());

  // Keep "5 min ago" honest.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => { setNow(Date.now()); }, [activity]);

  if (!state) return <div className={styles.panel} />;

  const running = state.allow && state.port !== null;
  const status = !state.allow ? 'Off'
    : !state.hasToken ? 'Needs a token'
    : running ? `Running on 127.0.0.1:${state.port}` : 'Starting…';
  const statusClass = running ? styles.statusOn : state.allow ? styles.statusWait : '';

  const toggleVault = (id: string): void => {
    void update({ vaults: state.vaults.includes(id) ? state.vaults.filter((v) => v !== id) : [...state.vaults, id] });
  };

  const newToken = async (): Promise<void> => {
    try {
      const r = await api.agents.newToken();
      setToken(r.token);
      setConfirmReplace(false);
      setCopied(false);
      await useAgentsStore.getState().load();
    } catch (e) {
      log('error', 'agents', 'Making a token failed', { error: String(e) });
    }
  };

  const snippet = token ? (client === 'desktop' ? clientConfig(state.exe, token) : claudeCodeCommand(state.exe, token)) : '';
  const copy = (): void => {
    void navigator.clipboard.writeText(snippet).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  };

  const counts = toolCounts(activity);
  const shown = filterActivity(activity, filter).slice(0, 60);

  return (
    <div className={styles.panel}>
      <header className={styles.header}>
        <span className={styles.title}>Agents</span>
        <span className={`${styles.status} ${statusClass}`}>
          <span className={styles.statusDot} />
          {status}
        </span>
      </header>

      <div className={styles.body}>
        <p className={styles.lead}>
          Let AI agents (Claude Desktop, Claude Code and other MCP clients) work with your notes while Cord is
          open and unlocked. They only see the vaults you pick.
        </p>

        <section className={styles.card}>
          <div className={styles.switchRow}>
            <div>
              <div className={styles.rowTitle}>Allow agents</div>
              <div className={styles.rowHint}>Starts a server on this computer only. Locking Cord stops it.</div>
            </div>
            <Switch on={state.allow} label="Allow agents" onChange={(v) => void update({ allow: v })} />
          </div>
          <div className={`${styles.switchRow} ${!state.allow ? styles.dim : ''}`}>
            <div>
              <div className={styles.rowTitle}>Agents can edit</div>
              <div className={styles.rowHint}>Create notes, add text, set fields, tag, move to trash. Never empties the trash.</div>
            </div>
            <Switch on={state.edit} disabled={!state.allow} label="Agents can edit" onChange={(v) => void update({ edit: v })} />
          </div>
        </section>

        <section className={`${styles.section} ${!state.allow ? styles.dim : ''}`}>
          <div className={styles.sectionHead}>
            <h3 className={styles.heading}>Vaults agents can see</h3>
            <span className={styles.headActions}>
              <button type="button" className={styles.link} onClick={() => void update({ vaults: vaults.map((v) => v.id) })}>All</button>
              <button type="button" className={styles.link} onClick={() => void update({ vaults: [] })}>None</button>
            </span>
          </div>
          <div className={styles.chips}>
            {vaults.map((v) => {
              const on = state.vaults.includes(v.id);
              return (
                <button
                  key={v.id}
                  type="button"
                  aria-pressed={on}
                  className={`${styles.chip} ${on ? styles.chipOn : ''}`}
                  onClick={() => toggleVault(v.id)}
                >
                  <span className={styles.vaultDot} style={{ background: v.color ?? 'var(--text-muted)' }} />
                  {v.name}
                  {on && <Check size={12} strokeWidth={2.25} />}
                </button>
              );
            })}
          </div>
          {state.allow && state.vaults.length === 0 && (
            <p className={styles.warn}>No vaults picked, so agents see nothing yet.</p>
          )}
        </section>

        <section className={`${styles.section} ${!state.allow ? styles.dim : ''}`}>
          <h3 className={styles.heading}>What agents can do</h3>
          <div className={styles.tools}>
            {TOOLS.map((t) => {
              const off = t.write && !state.edit;
              const n = counts.get(t.name) ?? 0;
              return (
                <div key={t.name} className={`${styles.tool} ${off ? styles.toolOff : ''}`} title={off ? 'Turn on "Agents can edit"' : t.name}>
                  {off ? <Lock size={12} /> : t.write ? <Pencil size={12} /> : <Eye size={12} />}
                  <span className={styles.toolLabel}>{t.label}</span>
                  {n > 0 && <span className={styles.count}>{n}</span>}
                </div>
              );
            })}
          </div>
        </section>

        <section className={styles.section}>
          <h3 className={styles.heading}>Connect a client</h3>
          <div className={styles.segmented} role="tablist">
            {(['desktop', 'code'] as const).map((c) => (
              <button
                key={c}
                type="button"
                role="tab"
                aria-selected={client === c}
                className={`${styles.segment} ${client === c ? styles.segmentOn : ''}`}
                onClick={() => { setClient(c); setCopied(false); }}
              >
                {c === 'desktop' ? 'Claude Desktop' : 'Claude Code'}
              </button>
            ))}
          </div>
          <p className={styles.rowHint}>
            {client === 'desktop'
              ? 'Paste this into claude_desktop_config.json, then restart Claude Desktop.'
              : 'Run this once in a terminal.'}
            {' '}Other MCP clients take the same command, arguments and token.
          </p>

          {token ? (
            <div className={styles.snippet}>
              <pre className={styles.code}>{snippet}</pre>
              <button type="button" className={`${styles.copy} ${copied ? styles.copied : ''}`} onClick={copy}>
                {copied ? <Check size={13} /> : <Copy size={13} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          ) : null}

          <div className={styles.tokenRow}>
            {!state.hasToken || confirmReplace ? (
              <>
                <button type="button" className={styles.primary} onClick={() => void newToken()}>
                  <KeyRound size={13} />
                  {state.hasToken ? 'Replace token' : 'Make a token'}
                </button>
                {confirmReplace && (
                  <>
                    <span className={styles.rowHint}>Clients using the old token stop working.</span>
                    <button type="button" className={styles.link} onClick={() => setConfirmReplace(false)}>Cancel</button>
                  </>
                )}
              </>
            ) : (
              <>
                <button type="button" className={styles.btn} onClick={() => setConfirmReplace(true)}>
                  <KeyRound size={13} />
                  New token
                </button>
                <span className={styles.rowHint}>
                  {token ? 'Shown once. Copy it now.' : 'A token is set. Cord keeps only a hash, so it can\'t be shown again.'}
                </span>
              </>
            )}
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h3 className={styles.heading}>Activity</h3>
            <div className={styles.segmented}>
              {(['all', 'edits', 'failed'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  className={`${styles.segment} ${filter === f ? styles.segmentOn : ''}`}
                  onClick={() => setFilter(f)}
                >
                  {f === 'all' ? 'All' : f === 'edits' ? 'Edits' : 'Failed'}
                </button>
              ))}
            </div>
          </div>
          {shown.length === 0 ? (
            <p className={styles.empty}>{activity.length === 0 ? 'No agent has called Cord yet.' : 'Nothing here.'}</p>
          ) : (
            <ul className={styles.feed}>
              {shown.map((a) => <Entry key={`${a.at}-${a.tool}-${a.target ?? ''}`} a={a} now={now} onOpenNote={onOpenNote} />)}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function Entry({ a, now, onOpenNote }: { a: AgentActivity; now: number; onOpenNote: Props['onOpenNote'] }) {
  const fresh = now - a.at < 4000;
  const write = TOOLS.some((t) => t.write && t.name === a.tool);
  return (
    <li className={`${styles.entry} ${fresh ? styles.fresh : ''} ${a.ok ? '' : styles.failed}`}>
      <span className={`${styles.kind} ${write ? styles.kindWrite : ''}`}>{write ? <Pencil size={11} /> : <Eye size={11} />}</span>
      <span className={styles.what}>
        Agent {verb(a.tool)}{' '}
        {a.note ? (
          a.note.deleted
            ? <span className={styles.target}>{a.note.title || 'Untitled'} (in trash)</span>
            : <button type="button" className={styles.noteLink} onClick={() => onOpenNote(a.note!.vaultId, a.note!.id)}>{a.note.title || 'Untitled'}</button>
        ) : a.target && a.tool === 'search' ? (
          <span className={styles.target}>“{a.target}”</span>
        ) : a.target && a.tool === 'create_note' ? (
          <span className={styles.target}>{a.target}</span>
        ) : null}
        {a.error && <span className={styles.error}> · {a.error}</span>}
      </span>
      <time className={styles.time} title={new Date(a.at).toLocaleString()}>{relativeTime(a.at, now)}</time>
    </li>
  );
}

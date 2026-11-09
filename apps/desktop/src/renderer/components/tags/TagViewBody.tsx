import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { TagField, TagRow, TagView, ViewConfig, ViewKind } from '@shared/types';
import { api } from '../../ipc';
import { applyView, visibleColumns } from '../../fields/query';
import { useFieldsVersion } from '../../store/fieldsVersion';
import { log } from '../../lib/log';
import { FilterBar } from './FilterBar';
import { TableView } from './TableView';
import { BoardView } from './BoardView';
import styles from './tags.module.css';

interface Props {
  viewId: string;
  onOpen: (noteId: string, blockId?: string) => void;
  /** The tag page shows the field editor next to the switch. */
  extraTools?: ReactNode | undefined;
}

const SAVE_DELAY_MS = 400;

// Callers key this component by `viewId`, so a different view never inherits
// the previous one's unsaved settings.
export function TagViewBody({ viewId, onOpen, extraTools }: Props) {
  const version = useFieldsVersion((s) => s.version);
  const bump = useFieldsVersion((s) => s.bump);
  const [view, setView] = useState<TagView | null | undefined>(undefined);
  const [fields, setFields] = useState<TagField[]>([]);
  const [rows, setRows] = useState<TagRow[]>([]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const v = await api.views.get(viewId);
      if (cancelled) return;
      setView((current) => current ?? v); // Keep unsaved local edits to the view itself.
      if (!v) return;
      const [f, r] = await Promise.all([api.fields.list(v.tagId), api.views.rows(v.tagId)]);
      if (!cancelled) { setFields(f); setRows(r); }
    })().catch((error: unknown) => log('error', 'tags', 'Loading a tag view failed', { viewId, error: String(error) }));
    return () => { cancelled = true; };
  }, [viewId, version]);

  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  const save = useCallback((next: TagView) => {
    setView(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      api.views.update(next.id, { kind: next.kind, config: next.config })
        .catch((error: unknown) => log('error', 'tags', 'Saving a tag view failed', { viewId, error: String(error) }));
    }, SAVE_DELAY_MS);
  }, [viewId]);

  if (view === undefined) return <p className={styles.muted}>Loading…</p>;
  if (view === null) return null; // The embed shows its own "removed" message.

  const config: ViewConfig = view.config;
  const setConfig = (patch: Partial<ViewConfig>): void => save({ ...view, config: { ...config, ...patch } });
  const setKind = (kind: ViewKind): void => save({ ...view, kind });
  const shown = applyView(rows, fields, config);
  const columns = visibleColumns(fields, config);
  const selects = fields.filter((f) => f.type === 'select' || f.type === 'multi_select');
  const groupBy = selects.find((f) => f.id === config.groupBy) ?? selects[0] ?? null;

  const setValue = (row: TagRow, field: TagField, value: unknown): void => {
    const write = value === null
      ? api.fields.clearValue(field.id, row.targetId)
      : api.fields.setValue({ fieldId: field.id, targetId: row.targetId, targetKind: row.kind, noteId: row.noteId, value });
    write.then(bump).catch((error: unknown) => log('warn', 'tags', 'Setting a value failed', { error: String(error) }));
  };
  const open = (row: TagRow): void => onOpen(row.noteId, row.kind === 'block' ? row.targetId : undefined);

  return (
    <div className={styles.body}>
      <div className={styles.toolbar}>
        <span className={styles.switch}>
          <button type="button" aria-pressed={view.kind === 'table'} onClick={() => setKind('table')}>Table</button>
          <button type="button" aria-pressed={view.kind === 'board'} onClick={() => setKind('board')}>Board</button>
        </span>
        {view.kind === 'board' && selects.length > 1 && (
          <select value={groupBy?.id ?? ''} onChange={(e) => setConfig({ groupBy: e.target.value })} aria-label="Group by">
            {selects.map((f) => <option key={f.id} value={f.id}>Group by {f.name}</option>)}
          </select>
        )}
        {extraTools}
      </div>
      <FilterBar fields={fields} filters={config.filters ?? []} onChange={(filters) => setConfig({ filters })} />
      {view.kind === 'board'
        ? (groupBy
            ? <BoardView rows={shown} groupBy={groupBy} cardFields={columns} onOpen={open} onSetValue={setValue} />
            : <p className={styles.muted}>A board groups cards by a select field. Add one under Fields.</p>)
        : <TableView rows={shown} columns={columns} sort={config.sort ?? null} onSort={(sort) => setConfig({ sort })} onOpen={open} onSetValue={setValue} />}
    </div>
  );
}

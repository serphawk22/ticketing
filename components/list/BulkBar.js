'use client';

import { useEffect, useState } from 'react';

import { STATUS_META, STATUS_ORDER, PRIORITY_META, PRIORITY_ORDER } from '../meta';
import { ArchiveIcon } from '../ticket/icons';

/**
 * The floating bar that appears over the bottom of the table once work items
 * are checked. Every field is a filter-style select: choosing a value and
 * pressing Apply batches the same PATCH the single-row editors use, so bulk
 * changes travel the same code path and hit the same validation.
 */
export default function BulkBar({
  count,
  employees,
  isAdmin,
  busy,
  onApply,
  onDelete,
  onArchive,
  onClear,
}) {
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [assignee, setAssignee] = useState('');
  const [labels, setLabels] = useState('');

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClear();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClear]);

  function apply() {
    const fields = {};
    if (status) fields.status = status;
    if (priority) fields.priority = priority;
    if (assignee) {
      fields.employee_id = assignee === 'unassigned' ? null : Number(assignee);
    }
    if (labels.trim()) fields.labels = labels.trim();
    if (Object.keys(fields).length === 0) return;
    onApply(fields);
    setStatus('');
    setPriority('');
    setAssignee('');
    setLabels('');
  }

  const nothingChosen = !status && !priority && !assignee && !labels.trim();

  return (
    <div className="bulk-bar" role="region" aria-label={`Bulk actions for ${count} selected work items`}>
      <span className="bulk-count">
        {count} selected
      </span>

      <label className="sr-only" htmlFor="bulk-status">
        Set status
      </label>
      <select
        id="bulk-status"
        value={status}
        disabled={busy}
        onChange={(e) => setStatus(e.target.value)}
      >
        <option value="">Set status…</option>
        {STATUS_ORDER.map((s) => (
          <option key={s} value={s}>
            {STATUS_META[s].label}
          </option>
        ))}
      </select>

      <label className="sr-only" htmlFor="bulk-priority">
        Set priority
      </label>
      <select
        id="bulk-priority"
        value={priority}
        disabled={busy}
        onChange={(e) => setPriority(e.target.value)}
      >
        <option value="">Set priority…</option>
        {PRIORITY_ORDER.map((p) => (
          <option key={p} value={p}>
            {PRIORITY_META[p].label}
          </option>
        ))}
      </select>

      {isAdmin && (
        <>
          <label className="sr-only" htmlFor="bulk-assignee">
            Set assignee
          </label>
          <select
            id="bulk-assignee"
            value={assignee}
            disabled={busy}
            onChange={(e) => setAssignee(e.target.value)}
          >
            <option value="">Set assignee…</option>
            <option value="unassigned">Unassigned</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </>
      )}

      <label className="sr-only" htmlFor="bulk-labels">
        Set labels
      </label>
      <input
        id="bulk-labels"
        value={labels}
        disabled={busy}
        onChange={(e) => setLabels(e.target.value)}
        placeholder="Set labels…"
        className="bulk-labels"
      />

      <button type="button" className="btn-primary" onClick={apply} disabled={busy || nothingChosen}>
        {busy ? 'Applying…' : 'Apply'}
      </button>

      {onArchive && (
        <button type="button" className="btn-ghost" onClick={onArchive} disabled={busy}>
          <ArchiveIcon size={14} />
          Archive
        </button>
      )}

      <button
        type="button"
        className="btn-ghost bulk-delete"
        onClick={onDelete}
        disabled={busy || !isAdmin}
        title={isAdmin ? undefined : 'Only admins can delete work items.'}
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />
        </svg>
        Delete selected
      </button>

      <button type="button" className="btn-ghost" onClick={onClear} disabled={busy}>
        Clear
      </button>
    </div>
  );
}

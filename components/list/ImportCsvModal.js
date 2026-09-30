'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { parseCsv } from '../../lib/csv';
import { PRIORITY_META, PRIORITY_ORDER, STATUS_META, STATUS_ORDER, TYPE_META, TYPE_ORDER } from '../meta';

/**
 * CSV import for v1 uses a fixed expected header rather than a column mapping
 * UI. Headers are matched case-insensitively and a few common spellings are
 * accepted so a file exported from this app, or from Jira, lands without
 * editing first.
 */

const FIELD_DEFS = [
  { key: 'title', label: 'Title', required: true, aliases: ['title', 'summary', 'work item', 'issue'] },
  { key: 'description', label: 'Description', aliases: ['description', 'details'] },
  { key: 'status', label: 'Status', aliases: ['status', 'state'] },
  { key: 'priority', label: 'Priority', aliases: ['priority'] },
  { key: 'type', label: 'Issue type', aliases: ['type', 'issue type', 'issuetype'] },
  { key: 'assignee', label: 'Assignee email', aliases: ['assignee', 'assignee email', 'email'] },
  { key: 'due_date', label: 'Due date', aliases: ['due date', 'duedate', 'due'] },
];

/** Match a CSV header onto one of our fields, or null when it is not one. */
function matchField(header) {
  const h = header.trim().toLowerCase();
  if (!h) return null;
  return FIELD_DEFS.find((f) => f.aliases.includes(h))?.key ?? null;
}

/** Value -> canonical key, tolerant of case, spacing and Jira's own labels. */
function canonicalStatus(value) {
  const v = value.trim().toLowerCase();
  if (!v) return 'open';
  // A finished item is "Done" in Jira whether it was resolved or closed, and
  // this app labels one of them "Done" already, so take the bare word too.
  if (v === 'done') return 'resolved';
  const hit = STATUS_ORDER.find((s) => s === v || STATUS_META[s].label.toLowerCase() === v);
  return hit ?? null;
}

function canonicalPriority(value) {
  const v = value.trim().toLowerCase();
  if (!v) return 'medium';
  const hit = PRIORITY_ORDER.find((p) => p === v || PRIORITY_META[p].label.toLowerCase() === v);
  return hit ?? null;
}

function canonicalType(value) {
  const v = value.trim().toLowerCase();
  if (!v) return 'task';
  const hit = TYPE_ORDER.find((t) => t === v || TYPE_META[t].label.toLowerCase() === v);
  return hit ?? null;
}

/** Accept YYYY-MM-DD, DD/MM/YYYY and MM/DD/YYYY; the last is read as US. */
function canonicalDate(value) {
  const v = value.trim();
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const slash = v.match(/^(\d{1,2})[/](\d{1,2})[/](\d{4})$/);
  if (slash) {
    const a = Number(slash[1]);
    const b = Number(slash[2]);
    const year = slash[3];
    // Only treat the first number as the month when it cannot be a day, which
    // is what removes the ambiguity for 03/04/2026 style dates.
    if (a > 12 && b <= 12) {
      return `${year}-${String(b).padStart(2, '0')}-${String(a).padStart(2, '0')}`;
    }
    return `${year}-${String(a).padStart(2, '0')}-${String(b).padStart(2, '0')}`;
  }
  return null;
}

/**
 * Turn raw parsed rows into create payloads, collecting a message per bad row
 * instead of failing the file, so one typo does not block the other 49 rows.
 */
function buildRows(rows, mapping, employees) {
  const byEmail = new Map(employees.map((e) => [String(e.email).toLowerCase(), e]));

  return rows.map((raw, index) => {
    const errors = [];
    const get = (field) => (mapping[field] ? (raw[mapping[field]] ?? '').trim() : '');

    const title = get('title');
    if (!title) errors.push('Title is required.');

    // The create route requires a non-empty description, so fall back to the
    // title rather than rejecting rows that never had one.
    const description = get('description') || title;

    const statusRaw = get('status');
    const status = canonicalStatus(statusRaw);
    if (statusRaw && !status) {
      errors.push(`Unknown status "${statusRaw}".`);
    }

    const priorityRaw = get('priority');
    const priority = canonicalPriority(priorityRaw);
    if (priorityRaw && !priority) {
      errors.push(`Unknown priority "${priorityRaw}".`);
    }

    const typeRaw = get('type');
    const type = canonicalType(typeRaw);
    if (typeRaw && !type) {
      errors.push(`Unknown issue type "${typeRaw}".`);
    }

    const dueRaw = get('due_date');
    let due = null;
    if (dueRaw) {
      due = canonicalDate(dueRaw);
      if (!due) errors.push(`Could not read the due date "${dueRaw}". Use YYYY-MM-DD.`);
    }

    const assigneeRaw = get('assignee');
    let employee_id = null;
    if (assigneeRaw) {
      const employee = byEmail.get(assigneeRaw.toLowerCase());
      if (!employee) {
        errors.push(`No employee with the email "${assigneeRaw}".`);
      } else {
        employee_id = employee.id;
      }
    }

    return {
      line: index + 2, // +1 for the header, +1 because lines are 1-based.
      title,
      payload: { title, description, status: status || 'open', priority: priority || 'medium', type: type || 'task', due_date: due, employee_id },
      errors,
    };
  });
}

export default function ImportCsvModal({ projectId, employees, onClose, onImported }) {
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState(null);
  const fileRef = useRef(null);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape' && !progress) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, progress]);

  const parsed = useMemo(() => {
    if (!text.trim()) return null;
    const result = parseCsv(text);
    if (result.headers.length === 0) {
      return { error: 'That file has no readable rows.' };
    }
    const mapping = {};
    for (const header of result.headers) {
      const field = matchField(header);
      if (field && !mapping[field]) mapping[field] = header;
    }
    if (!mapping.title) {
      return {
        error: `No title column found. Expected a header called "Title" (or "Summary"); found: ${result.headers.join(', ') || 'nothing'}.`,
      };
    }
    return { mapping, prepared: buildRows(result.rows, mapping, employees) };
  }, [text, employees]);

  async function readFile(file) {
    setError('');
    setRows(null);
    setFileName(file.name);
    const raw = await file.text();
    setText(raw);
  }

  // Tickets are created in To Do, so anything the file asked for lands with a
  // follow-up PATCH through the same route the list uses for a status change.
  async function applyStatus(ticket, status) {
    if (!status || status === 'open' || ticket.status === status) return ticket;
    const res = await fetch(`/api/tickets/${ticket.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not set the status.');
    return data.ticket || ticket;
  }

  async function confirm() {
    if (!parsed?.prepared) return;
    const valid = parsed.prepared.filter((r) => r.errors.length === 0);
    if (valid.length === 0) return;

    setProgress({ done: 0, total: valid.length });
    const created = [];
    const failures = [];

    // Sequential on purpose: the app has no batch endpoint, and firing 50
    // parallel writes against SQLite invites lock contention for no gain.
    for (let i = 0; i < valid.length; i += 1) {
      const row = valid[i];
      try {
        const res = await fetch('/api/tickets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...row.payload, project_id: projectId }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Create failed.');
        created.push(await applyStatus(data.ticket, row.payload.status));
      } catch (e) {
        failures.push({ line: row.line, title: row.title, message: e.message });
      }
      setProgress({ done: i + 1, total: valid.length });
    }

    setProgress(null);
    onImported({ created, failures });
  }

  const prepared = parsed?.prepared ?? null;
  const validCount = prepared ? prepared.filter((r) => r.errors.length === 0).length : 0;
  const errorRows = prepared ? prepared.filter((r) => r.errors.length > 0) : [];

  return (
    <div className="modal-overlay" onMouseDown={() => !progress && onClose()}>
      <div
        className="modal modal-wide"
        role="dialog"
        aria-modal="true"
        aria-label="Import work items from CSV"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header>
          <h3>Import work items from CSV</h3>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close"
            disabled={Boolean(progress)}
          >
            ×
          </button>
        </header>

        <p className="modal-note">
          Expected columns: <code>Title</code> (required), and optionally Description, Status,
          Priority, Issue type, Assignee email and Due date. Rows that cannot be read are listed
          below and skipped, so the rest still import.
        </p>

        {error && <p className="form-error">{error}</p>}

        <div className="import-drop">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) readFile(file);
            }}
          />
          <button type="button" className="btn-secondary" onClick={() => fileRef.current?.click()} disabled={Boolean(progress)}>
            Choose a CSV file
          </button>
          {fileName && <span className="import-filename">{fileName}</span>}
        </div>

        {parsed?.error && <p className="form-error">{parsed.error}</p>}

        {prepared && prepared.length > 0 && (
          <div className="import-preview">
            <p className="import-summary">
              {validCount} of {prepared.length} {prepared.length === 1 ? 'row' : 'rows'} ready to
              import
              {errorRows.length > 0 && ` · ${errorRows.length} skipped`}
            </p>

            <div className="import-scroll">
              <table className="import-table">
                <thead>
                  <tr>
                    <th scope="col">Line</th>
                    <th scope="col">Title</th>
                    <th scope="col">Status</th>
                    <th scope="col">Priority</th>
                    <th scope="col">Assignee</th>
                    <th scope="col">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {prepared.map((row) => (
                    <tr key={row.line} className={row.errors.length ? 'is-invalid' : ''}>
                      <td className="import-line">{row.line}</td>
                      <td>{row.title || <span className="import-empty">(blank)</span>}</td>
                      <td>{STATUS_META[row.payload.status].label}</td>
                      <td>{PRIORITY_META[row.payload.priority].label}</td>
                      <td className="import-assignee">
                        {employees.find((e) => e.id === row.payload.employee_id)?.name || '—'}
                      </td>
                      <td className="import-note">
                        {row.errors.length ? row.errors.join(' ') : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {progress && (
          <p className="import-progress" role="status">
            Importing {progress.done} of {progress.total}…
          </p>
        )}

        <div className="modal-actions modal-actions-padded">
          <span />
          <div className="modal-actions-right">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={Boolean(progress)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={confirm}
              disabled={!prepared || validCount === 0 || Boolean(progress)}
            >
              {progress ? 'Importing…' : `Import ${validCount} ${validCount === 1 ? 'work item' : 'work items'}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

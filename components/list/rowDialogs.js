'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Avatar from '../Avatar';
import { STATUS_META, TYPE_META, TypeIcon, ticketKey, RELATION_META, RELATION_ORDER } from '../meta';

// A dialog is the right shape for every one of these: they are short, they need
// a definite commit or cancel, and they should not be dismissible by a stray
// click the way a menu is.
function Dialog({ title, onClose, children, width = 'narrow' }) {
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div
        className={`modal${width === 'wide' ? '' : ' modal-narrow'}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header>
          <h3>{title}</h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

function Actions({ onCancel, confirmLabel, onConfirm, disabled, busy }) {
  return (
    <div className="modal-actions modal-actions-padded">
      <button type="button" className="btn-secondary" onClick={onCancel}>
        Cancel
      </button>
      <button
        type="button"
        className="btn-primary"
        onClick={onConfirm}
        disabled={disabled || busy}
      >
        {busy ? 'Working…' : confirmLabel}
      </button>
    </div>
  );
}

/**
 * Search over the tickets already loaded, for pickers that stay inside the
 * current project. Falls back to the API when the local set cannot answer, so
 * the picker still reaches tickets that are filtered off the page.
 */
function useTicketSearch(tickets, { excludeId, projectId, crossProject }) {
  const [query, setQuery] = useState('');
  const [remote, setRemote] = useState([]);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setRemote([]);
      return undefined;
    }
    const mine = ++seq.current;
    setLoading(true);
    const params = new URLSearchParams({ q });
    if (Number.isInteger(excludeId)) params.set('exclude', String(excludeId));
    // Scoped to the project unless the caller asked for every project, which
    // the link dialog does because links routinely cross project boundaries.
    if (!crossProject && projectId != null) params.set('projectId', String(projectId));

    fetch(`/api/tickets/search?${params}`)
      .then((r) => (r.ok ? r.json() : { tickets: [] }))
      .then((d) => {
        // A slower earlier request must not overwrite a newer one.
        if (mine === seq.current) setRemote(d.tickets || []);
      })
      .catch(() => {
        if (mine === seq.current) setRemote([]);
      })
      .finally(() => {
        if (mine === seq.current) setLoading(false);
      });

    return () => {
      seq.current += 1;
    };
  }, [query, excludeId, projectId, crossProject]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    // Local matches first so an in-project pick is instant, then the API's,
    // de-duplicated by id.
    const local = tickets
      .filter((t) => t.id !== excludeId && !t.archived)
      .filter((t) => {
        if (crossProject) {
          return (
            t.title.toLowerCase().includes(q) ||
            ticketKey(t).toLowerCase().includes(q)
          );
        }
        return t.project_id === projectId &&
          (t.title.toLowerCase().includes(q) || ticketKey(t).toLowerCase().includes(q));
      });
    const seen = new Set(local.map((t) => t.id));
    return [...local, ...remote.filter((t) => !seen.has(t.id))].slice(0, 20);
  }, [query, tickets, remote, excludeId, projectId, crossProject]);

  return { query, setQuery, results, loading };
}

function TicketResultList({ results, emptyHint, onPick, selectedId, activeId }) {
  if (results.length === 0) return <p className="tm-empty">{emptyHint}</p>;
  return (
    <ul className="picker-list" role="listbox">
      {results.map((t) => (
        <li key={t.id}>
          <button
            type="button"
            className={`picker-row${t.id === activeId ? ' is-active' : ''}`}
            role="option"
            aria-selected={t.id === selectedId}
            onClick={() => onPick(t)}
          >
            <span className="picker-type" title={(TYPE_META[t.type] || TYPE_META.task).label}>
              <TypeIcon type={t.type} size={14} />
            </span>
            <span className="picker-key">{ticketKey(t)}</span>
            <span className="picker-title">{t.title}</span>
            {t.status && (
              <span
                className="picker-status"
                style={{ background: STATUS_META[t.status]?.bg, color: STATUS_META[t.status]?.text }}
              >
                {STATUS_META[t.status]?.label || t.status}
              </span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * "Convert to sub-task of…"
 *
 * Reuses the existing parent_id write rather than adding a second way to set
 * one. A ticket that already has children is blocked rather than flattened:
 * re-parenting its children silently moves work the user did not ask to move,
 * and this dialog only picks a parent for the one ticket.
 */
export function ConvertToSubtaskDialog({ ticket, tickets, projectId, onClose, onConfirm }) {
  const [chosen, setChosen] = useState(null);
  const { query, setQuery, results, loading } = useTicketSearch(tickets, {
    excludeId: ticket.id,
    projectId,
  });
  const [childCount, setChildCount] = useState(0);

  useEffect(() => {
    let alive = true;
    fetch(`/api/tickets/${ticket.id}/detail`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d) setChildCount((d.childItems || []).length);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [ticket.id]);

  return (
    <Dialog title="Convert to sub-task of…" onClose={onClose}>
      <div className="modal-body">
        {childCount > 0 ? (
          <p className="dialog-warning">
            {ticketKey(ticket)} has {childCount} child{' '}
            {childCount === 1 ? 'item' : 'items'}. Move or remove child items first.
          </p>
        ) : (
          <p className="dialog-hint">
            {ticketKey(ticket)} will move underneath the work item you pick.
          </p>
        )}

        <input
          className="tm-input"
          autoFocus
          placeholder="Find a parent by key or title"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Find a parent work item"
        />

        <TicketResultList
          results={results}
          emptyHint={loading ? 'Searching…' : 'No matching work items.'}
          activeId={chosen?.id}
          onPick={setChosen}
        />
      </div>
      <Actions
        onCancel={onClose}
        confirmLabel="Convert"
        disabled={!chosen || childCount > 0}
        onConfirm={() => onConfirm(chosen)}
      />
    </Dialog>
  );
}

/**
 * "Clone"
 *
 * Creates through the same POST the create modal uses. Status is deliberately
 * not copied: the clone starts as To Do rather than inheriting a Done or In
 * Progress state from work that has already been done once.
 */
export function CloneDialog({ ticket, onClose, onConfirm, defaultStatus = 'open' }) {
  const [title, setTitle] = useState(`Copy of ${ticket.title}`);
  const [description, setDescription] = useState('');
  const [fields, setFields] = useState({
    description: true,
    labels: true,
    assignee: true,
    attachments: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pendingAttachments, setPendingAttachments] = useState([]);

  useEffect(() => {
    let alive = true;
    fetch(`/api/tickets/${ticket.id}/detail`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d) return;
        // Pre-fills the editor from the original; whether it is kept is the
        // checkbox, not what happens to be sitting in the textarea.
        setDescription(d.ticket?.description || '');
        setPendingAttachments(d.attachments || []);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [ticket.id]);

  function toggle(field) {
    setFields((f) => ({ ...f, [field]: !f[field] }));
  }

  async function confirm() {
    setBusy(true);
    setError('');
    try {
      const kept = {
        description: fields.description,
        labels: fields.labels,
        assignee: fields.assignee,
        attachments: fields.attachments,
      };
      // An unchecked field is not copied, so it is sent as its empty value
      // rather than being left to default to the original.
      const result = await onConfirm({
        title: title.trim(),
        description: kept.description ? description : '',
        labels: kept.labels ? ticket.labels : '',
        employee_id: kept.assignee ? ticket.employee_id : null,
        // A cloned sub-task stays under the same parent, which is what makes
        // it a clone rather than a fresh top-level ticket.
        parent_id: ticket.parent_id ?? null,
        project_id: ticket.project_id ?? null,
        priority: ticket.priority,
        type: ticket.type,
        status: defaultStatus,
        attachments: kept.attachments ? pendingAttachments : [],
      });
      return result;
    } catch (err) {
      setError(err.message);
      setBusy(false);
      return undefined;
    }
  }

  const options = [
    ['description', 'Description'],
    ['attachments', `Attachments (${pendingAttachments.length})`],
    ['labels', 'Labels'],
    ['assignee', 'Assignee'],
  ];

  return (
    <Dialog title="Clone work item" onClose={onClose}>
      <div className="modal-body">
        <label className="dialog-field">
          <span className="dialog-label">Title</span>
          <input
            className="tm-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-label="Clone title"
          />
        </label>

        {fields.description && (
          <label className="dialog-field">
            <span className="dialog-label">Description</span>
            <textarea
              className="tm-input"
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              aria-label="Clone description"
            />
          </label>
        )}

        <fieldset className="dialog-fieldset">
          <legend className="dialog-label">Copy over</legend>
          {options.map(([key, label]) => (
            <label key={key} className="dialog-check">
              <input type="checkbox" checked={fields[key]} onChange={() => toggle(key)} />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>

        <p className="dialog-hint">
          Comments and activity history are not copied. The clone starts as{' '}
          {STATUS_META[defaultStatus]?.label || defaultStatus}.
        </p>

        {error && <p className="tm-error">{error}</p>}
      </div>
      <Actions
        onCancel={onClose}
        confirmLabel="Clone"
        busy={busy}
        disabled={!title.trim()}
        onConfirm={confirm}
      />
    </Dialog>
  );
}

/**
 * "Link work item"
 *
 * Writes into the same ticket_relations table the detail modal reads, so a
 * link made here shows up there without a refresh.
 */
export function LinkTicketDialog({ ticket, tickets, projectId, onClose, onConfirm }) {
  const [type, setType] = useState('relates_to');
  const [chosen, setChosen] = useState(null);
  const { query, setQuery, results, loading } = useTicketSearch(tickets, {
    excludeId: ticket.id,
    crossProject: true,
  });

  return (
    <Dialog title="Link work item" onClose={onClose}>
      <div className="modal-body">
        <label className="dialog-field">
          <span className="dialog-label">Relationship</span>
          <select
            className="tm-input tm-input-select"
            value={type}
            onChange={(e) => setType(e.target.value)}
            aria-label="Relationship type"
          >
            {RELATION_ORDER.map((t) => (
              <option key={t} value={t}>
                {RELATION_META[t].label}
              </option>
            ))}
          </select>
        </label>

        <p className="dialog-hint">
          {ticketKey(ticket)} will be shown on the other work item as “
          {RELATION_META[type].label.split(' ').reverse().join(' ')}
          ”.
        </p>

        <input
          className="tm-input"
          autoFocus
          placeholder="Find a work item by key or title"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Find a work item to link"
        />

        <TicketResultList
          results={results}
          emptyHint={loading ? 'Searching…' : 'No matching work items.'}
          activeId={chosen?.id}
          onPick={setChosen}
        />
      </div>
      <Actions
        onCancel={onClose}
        confirmLabel="Link"
        disabled={!chosen}
        onConfirm={() => onConfirm(chosen, type)}
      />
    </Dialog>
  );
}

/** "Add web link" — a URL and the text to show for it. */
export function AddWebLinkDialog({ onClose, onConfirm }) {
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function confirm() {
    setBusy(true);
    setError('');
    try {
      await onConfirm({ url: url.trim(), label: label.trim() });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Dialog title="Add web link" onClose={onClose}>
      <div className="modal-body">
        <label className="dialog-field">
          <span className="dialog-label">URL</span>
          <input
            className="tm-input"
            autoFocus
            type="url"
            placeholder="https://example.com/page"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            aria-label="Web link URL"
          />
        </label>
        <label className="dialog-field">
          <span className="dialog-label">Text</span>
          <input
            className="tm-input"
            placeholder="What this link points at"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            aria-label="Web link text"
          />
        </label>
        {error && <p className="tm-error">{error}</p>}
      </div>
      <Actions
        onCancel={onClose}
        confirmLabel="Add"
        busy={busy}
        disabled={!url.trim()}
        onConfirm={confirm}
      />
    </Dialog>
  );
}

/** "Connect Slack channel" — stores the channel name; no Slack API is called. */
export function SlackChannelDialog({ ticket, onClose, onConfirm }) {
  const [channel, setChannel] = useState(ticket.slack_channel || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function confirm() {
    setBusy(true);
    setError('');
    try {
      await onConfirm(channel.trim().replace(/^#/, ''));
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Dialog title="Connect Slack channel" onClose={onClose}>
      <div className="modal-body">
        <label className="dialog-field">
          <span className="dialog-label">Channel</span>
          <input
            className="tm-input"
            autoFocus
            placeholder="team-platform"
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            aria-label="Slack channel"
          />
        </label>
        <p className="dialog-hint">
          Saved against {ticketKey(ticket)} and shown on the work item. Leave it
          empty to disconnect.
        </p>
        {error && <p className="tm-error">{error}</p>}
      </div>
      <Actions
        onCancel={onClose}
        confirmLabel="Save"
        busy={busy}
        onConfirm={confirm}
      />
    </Dialog>
  );
}

/**
 * "Watchers" — the list plus an add field, which is what separates it from the
 * read-only voter list. Adding somebody else is an admin action, matching the
 * API, so the input is only offered to admins.
 */
export function WatchersDialog({ ticketId, watchers, users, currentUser, isAdmin, onClose, onAdd, onRemove }) {
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const watcherIds = new Set(watchers.map((w) => w.user_id));
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return users
      .filter((u) => !watcherIds.has(u.id))
      .filter((u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
      .slice(0, 8);
  }, [query, users, watchers]);

  async function add(user) {
    setBusy(true);
    setError('');
    try {
      await onAdd(user.id);
      setQuery('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title="Watchers" onClose={onClose}>
      <div className="modal-body">
        {isAdmin && (
          <div className="dialog-search-wrap">
            <input
              className="tm-input"
              autoFocus
              placeholder="Add watcher by name or email"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Add a watcher"
            />
            {query.trim() && (
              <ul className="picker-list picker-list-compact" role="listbox">
                {matches.length === 0 && <li className="picker-none">No matching people.</li>}
                {matches.map((u) => (
                  <li key={u.id}>
                    <button
                      type="button"
                      className="picker-row"
                      role="option"
                      aria-selected="false"
                      disabled={busy}
                      onClick={() => add(u)}
                    >
                      <Avatar name={u.name} assigned size={24} />
                      <span className="picker-title">{u.name}</span>
                      <span className="picker-sub">{u.email}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {watchers.length === 0 ? (
          <p className="tm-empty">Nobody is watching this issue yet.</p>
        ) : (
          <ul className="watcher-list">
            {watchers.map((w) => (
              <li key={w.id} className="watcher-row">
                <Avatar name={w.user_name} assigned size={24} />
                <span className="watcher-name">{w.user_name}</span>
                {w.user_id === currentUser?.id && <span className="watcher-you">you</span>}
                <button
                  type="button"
                  className="watcher-remove"
                  onClick={() => onRemove(w.user_id)}
                  disabled={!isAdmin && w.user_id !== currentUser?.id}
                  aria-label={`Remove ${w.user_name} as a watcher`}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}

        {error && <p className="tm-error">{error}</p>}
      </div>
      <div className="modal-actions modal-actions-padded">
        <button type="button" className="btn-secondary" onClick={onClose}>
          Done
        </button>
      </div>
    </Dialog>
  );
}

/** "Voters" — read-only, unlike the watchers list above. */export function VotersDialog({ votes, currentUser, onClose }) {
  return (
    <Dialog title={`Voters (${votes.length})`} onClose={onClose}>
      <div className="modal-body">
        {votes.length === 0 ? (
          <p className="tm-empty">No votes yet.</p>
        ) : (
          <ul className="watcher-list">
            {votes.map((v) => (
              <li key={v.id} className="watcher-row">
                <Avatar name={v.user_name} assigned size={24} />
                <span className="watcher-name">{v.user_name}</span>
                {v.user_id === currentUser?.id && <span className="watcher-you">you</span>}
              </li>
            ))}
          </ul>
        )}
        <p className="dialog-hint">Use “Add vote” in the row menu to vote.</p>
      </div>
      <div className="modal-actions modal-actions-padded">
        <button type="button" className="btn-secondary" onClick={onClose}>
          Close
        </button>
      </div>
    </Dialog>
  );
}

/**
 * "Move" — changes the work item's project and, optionally, its parent.
 *
 * Both are shown because they are the two properties that decide where a work
 * item lives, and the spec's list distinguishes Move from Convert to sub-task:
 * Move is about relocating the item itself, so it offers the project too.
 * Reparenting is offered here rather than only in the sub-task dialog so a
 * parent can be corrected without going through the convert wording.
 */
export function MoveDialog({ ticket, tickets, projects, projectId, onClose, onConfirm }) {
  const [target, setTarget] = useState(ticket.project_id ?? projectId);
  const [parentId, setParentId] = useState(ticket.parent_id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // A parent only makes sense inside the project being moved into, so the
  // candidates follow the target. Picking a project therefore clears a parent
  // that cannot exist there, rather than leaving an invalid one to fail.
  const parentCandidates = useMemo(
    () => tickets.filter((t) => t.id !== ticket.id && t.project_id === Number(target)),
    [tickets, ticket.id, target]
  );

  useEffect(() => {
    setParentId((cur) =>
      cur && parentCandidates.some((t) => String(t.id) === String(cur)) ? cur : ''
    );
  }, [parentCandidates]);

  async function confirm() {
    setBusy(true);
    setError('');
    try {
      await onConfirm({
        project_id: Number(target),
        parent_id: parentId ? Number(parentId) : null,
      });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  const sameProject = Number(target) === ticket.project_id;
  const sameParent = (parentId || null) === (ticket.parent_id ?? null);

  return (
    <Dialog title="Move work item" onClose={onClose}>
      <div className="modal-body">
        <label className="dialog-field">
          <span className="dialog-label">Project</span>
          <select
            className="tm-input tm-input-select"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            aria-label="Target project"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>

        <label className="dialog-field">
          <span className="dialog-label">Parent</span>
          <select
            className="tm-input tm-input-select"
            value={parentId}
            onChange={(e) => setParentId(e.target.value)}
            aria-label="Parent work item"
          >
            <option value="">No parent (top level)</option>
            {parentCandidates.map((t) => (
              <option key={t.id} value={t.id}>
                {ticketKey(t)} · {t.title}
              </option>
            ))}
          </select>
        </label>

        <p className="dialog-hint">
          {sameProject && sameParent
            ? 'Pick a different project or parent to move this work item.'
            : `Moving ${ticketKey(ticket)} keeps its comments, activity and links.`}
        </p>

        {error && <p className="tm-error">{error}</p>}
      </div>
      <Actions
        onCancel={onClose}
        confirmLabel="Move"
        busy={busy}
        disabled={sameProject && sameParent}
        onConfirm={confirm}
      />
    </Dialog>
  );
}

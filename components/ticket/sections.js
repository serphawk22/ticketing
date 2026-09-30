'use client';

import { useMemo, useRef, useState } from 'react';
import { formatShortDate, ticketKey, STATUS_META, TYPE_META, TypeIcon } from '../meta';
import {
  ChevronRight,
  PaperclipIcon,
  PlusIcon,
  SlackIcon,
  TrashIcon,
  UploadIcon,
  VoteIcon,
  WatchersIcon,
  WebLinkIcon,
} from './icons';
import Avatar from '../Avatar';

export function AttachmentsSection({ attachments, onUpload, onDelete, onOpen, canEdit, collapsed, onToggle }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');

  async function send(files) {
    const list = [...(files || [])];
    if (!list.length) return;
    setBusy(true);
    setError('');
    try {
      for (const file of list) await onUpload(file);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="tm-section">
      <button type="button" className="tm-section-toggle" onClick={onToggle} aria-expanded={!collapsed}>
        {collapsed ? <ChevronRight size={14} /> : <ChevronRight size={14} className="tm-rot90" />}
        <h3 className="tm-section-title">Attachments</h3>
        {attachments.length ? <span className="tm-count">{attachments.length}</span> : null}
      </button>

      {!collapsed && (
        <>
          {canEdit && (
            <div
              className={`tm-dropzone${dragging ? ' is-dragging' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                send(e.dataTransfer.files);
              }}
            >
              <input
                ref={inputRef}
                type="file"
                multiple
                className="tm-file-input"
                onChange={(e) => {
                  send(e.target.files);
                  e.target.value = '';
                }}
              />
              <button type="button" className="tm-dropzone-btn" onClick={() => inputRef.current?.click()} disabled={busy}>
                <UploadIcon size={16} />
                <span>{busy ? 'Uploading…' : 'Add attachment'}</span>
              </button>
              <span className="tm-hint">or drop files here</span>
            </div>
          )}

          {error && <p className="tm-error">{error}</p>}

          {attachments.length > 0 && (
            <ul className="tm-file-list">
              {attachments.map((file) => (
                <li key={file.id} className="tm-file">
                  <span className="tm-file-icon" aria-hidden="true">
                    <PaperclipIcon size={14} />
                  </span>
                  <button type="button" className="tm-file-name" onClick={() => onOpen(file)} title="Open attachment">
                    {file.filename}
                  </button>
                  <span className="tm-file-meta">
                    {formatShortDate(file.created_at)} · {Math.max(1, Math.round(file.size_bytes / 1024))} KB
                  </span>
                  {canEdit && (
                    <button
                      type="button"
                      className="tm-icon-btn tm-icon-danger"
                      onClick={() => onDelete(file)}
                      aria-label={`Remove ${file.filename}`}
                    >
                      <TrashIcon size={14} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

export function RelationsSection({
  title,
  items,
  emptyHint,
  relationLabel,
  onAdd,
  onRemove,
  onOpen,
  onToggle,
  collapsed,
  canEdit,
  addLabel,
  showAdd = true,
  // Child rows carry the same columns the list shows, so a parent reads as a
  // parent at a glance. Linked rows instead name the kind of link.
  showChildMeta = false,
  removeLabel,
}) {
  return (
    <section className="tm-section">
      <button type="button" className="tm-section-toggle" onClick={onToggle} aria-expanded={!collapsed}>
        {collapsed ? <ChevronRight size={14} /> : <ChevronRight size={14} className="tm-rot90" />}
        <h3 className="tm-section-title">{title}</h3>
        {items.length ? <span className="tm-count">{items.length}</span> : null}
      </button>

      {!collapsed && (
        <>
          {canEdit && showAdd && (
            <button type="button" className="tm-add-link" onClick={onAdd}>
              {addLabel}
            </button>
          )}
          {items.length === 0 ? (
            <p className="tm-empty">{emptyHint}</p>
          ) : (
            <ul className="tm-link-list">
              {items.map((item) => (
                <li key={item.relation_id || item.id} className="tm-link-row">
                  {showChildMeta && (
                    <span
                      className="tm-child-type"
                      title={(TYPE_META[item.type] || TYPE_META.task).label}
                    >
                      <TypeIcon type={item.type} size={14} />
                    </span>
                  )}
                  <button type="button" className="tm-link-key" onClick={() => onOpen(item)}>
                    {ticketKey(item)}
                  </button>
                  <button type="button" className="tm-link-title tm-link-title-btn" onClick={() => onOpen(item)}>
                    {item.title}
                  </button>
                  {item.relation_type && (
                    <span className="tm-link-rel">{relationLabel(item)}</span>
                  )}
                  <span className="tm-status-dot-wrap">
                    <span
                      className="tm-status-dot"
                      style={{ background: STATUS_META[item.status]?.color }}
                      title={STATUS_META[item.status]?.label}
                    />
                  </span>
                  {showChildMeta && (
                    <>
                      <span
                        className="tm-child-status"
                        style={{
                          background: STATUS_META[item.status]?.bg,
                          color: STATUS_META[item.status]?.text,
                        }}
                      >
                        {STATUS_META[item.status]?.label || item.status}
                      </span>
                      <Avatar
                        name={item.employee_name}
                        assigned={!!item.employee_id}
                        size={20}
                        unassignedIcon
                      />
                    </>
                  )}
                  {canEdit && onRemove && (
                    <button
                      type="button"
                      className="tm-icon-btn tm-icon-danger"
                      onClick={() => onRemove(item)}
                      aria-label={removeLabel ? removeLabel(item) : `Remove link to ${ticketKey(item)}`}
                    >
                      <TrashIcon size={14} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

/**
 * Votes are one per person, so the list doubles as the count. A toggle sits at
 * the head of the section so voting is one click without leaving the page.
 */
export function VotesSection({ votes, voted, onToggleVote, canVote = true, collapsed, onToggle, onOpen }) {
  return (
    <section className="tm-section">
      <button type="button" className="tm-section-toggle" onClick={onToggle} aria-expanded={!collapsed}>
        {collapsed ? <ChevronRight size={14} /> : <ChevronRight size={14} className="tm-rot90" />}
        <VoteIcon size={14} />
        <h3 className="tm-section-title">Votes</h3>
        {votes.length ? <span className="tm-count">{votes.length}</span> : null}
      </button>

      {!collapsed && (
        <>
          {canVote && (
            <button
              type="button"
              className={`tm-vote-toggle${voted ? ' is-voted' : ''}`}
              onClick={onToggleVote}
              aria-pressed={voted}
            >
              {voted ? <VoteIcon size={14} /> : <PlusIcon size={14} />}
              {voted ? 'Withdraw vote' : 'Vote'}
            </button>
          )}
          {votes.length === 0 ? (
            <p className="tm-empty">Nobody has voted yet.</p>
          ) : (
            <ul id="ticket-votes" className="watcher-list">
              {votes.map((vote) => (
                <li key={vote.id} className="watcher-row">
                  <Avatar name={vote.user_name} assigned size={20} />
                  <span className="watcher-name">{vote.user_name}</span>
                  <span className="watcher-you">{formatShortDate(vote.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

/**
 * Watchers reuse the dialog's vocabulary: anybody on the row can watch, but
 * adding somebody else is an admin action, so the add field only appears to
 * admins.
 */
export function WatchersSection({
  watchers,
  users,
  currentUser,
  isAdmin,
  onAdd,
  onRemove,
  collapsed,
  onToggle,
}) {
  const [query, setQuery] = useState('');

  const watcherIds = useMemo(() => new Set(watchers.map((w) => w.user_id)), [watchers]);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return (users || [])
      .filter((u) => !watcherIds.has(u.id))
      .filter((u) => u.name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q))
      .slice(0, 6);
  }, [query, users, watcherIds]);

  return (
    <section className="tm-section">
      <button type="button" className="tm-section-toggle" onClick={onToggle} aria-expanded={!collapsed}>
        {collapsed ? <ChevronRight size={14} /> : <ChevronRight size={14} className="tm-rot90" />}
        <WatchersIcon size={14} />
        <h3 className="tm-section-title">Watchers</h3>
        {watchers.length ? <span className="tm-count">{watchers.length}</span> : null}
      </button>

      {!collapsed && (
        <>
          {isAdmin && (
            <div className="tm-watcher-add">
              <input
                className="tm-input"
                placeholder="Add a watcher by name or email"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Add a watcher"
              />
              {query.trim().length > 0 && matches.length > 0 && (
                <ul className="picker-list picker-list-compact">
                  {matches.map((u) => (
                    <li key={u.id}>
                      <button
                        type="button"
                        className="picker-row"
                        onClick={() => {
                          onAdd?.(u.id);
                          setQuery('');
                        }}
                      >
                        <span className="picker-key">{u.name}</span>
                        <span className="picker-sub">{u.email}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {query.trim().length > 0 && matches.length === 0 && (
                <p className="picker-none">No matching people.</p>
              )}
            </div>
          )}

          {watchers.length === 0 ? (
            <p className="tm-empty">Nobody is watching yet.</p>
          ) : (
            <ul className="watcher-list">
              {watchers.map((w) => (
                <li key={w.id} className="watcher-row">
                  <Avatar name={w.user_name} assigned size={20} />
                  <span className="watcher-name">
                    {w.user_name}
                    {currentUser && currentUser.id === w.user_id && <span className="watcher-you"> (you)</span>}
                  </span>
                  {isAdmin && onRemove && (
                    <button
                      type="button"
                      className="tm-icon-btn tm-icon-danger"
                      onClick={() => onRemove(w.user_id)}
                      aria-label={`Remove ${w.user_name} as a watcher`}
                    >
                      <TrashIcon size={14} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

/** A short list of external links: add inline, open in a new tab, remove once.
 */
export function WebLinksSection({ items, onAdd, onRemove, canEdit = true, collapsed, onToggle }) {
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function add() {
    if (!url.trim()) return;
    setBusy(true);
    setError('');
    try {
      await onAdd({ url: url.trim(), label: label.trim() });
      setUrl('');
      setLabel('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="tm-section">
      <button type="button" className="tm-section-toggle" onClick={onToggle} aria-expanded={!collapsed}>
        {collapsed ? <ChevronRight size={14} /> : <ChevronRight size={14} className="tm-rot90" />}
        <WebLinkIcon size={14} />
        <h3 className="tm-section-title">Web links</h3>
        {items.length ? <span className="tm-count">{items.length}</span> : null}
      </button>

      {!collapsed && (
        <>
          {items.length === 0 ? (
            <p className="tm-empty">No web links yet.</p>
          ) : (
            <ul className="tm-weblink-list">
              {items.map((link) => (
                <li key={link.id} className="tm-weblink-row">
                  <span className="tm-weblink-icon" aria-hidden="true">
                    <WebLinkIcon size={14} />
                  </span>
                  <div className="tm-weblink-text">
                    {link.label && <span className="tm-weblink-label">{link.label}</span>}
                    <a
                      className="tm-weblink-url"
                      href={link.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {link.url}
                    </a>
                  </div>
                  <span className="tm-file-meta">{formatShortDate(link.created_at)}</span>
                  {canEdit && (
                    <button
                      type="button"
                      className="tm-icon-btn tm-icon-danger"
                      onClick={() => onRemove(link)}
                      aria-label={`Remove ${link.url}`}
                    >
                      <TrashIcon size={14} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {canEdit && (
            <div className="tm-weblink-add">
              <input
                className="tm-input"
                type="url"
                placeholder="https://example.com"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                aria-label="Web link URL"
              />
              <input
                className="tm-input"
                placeholder="Link text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                aria-label="Web link text"
              />
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={add}
                disabled={busy || !url.trim()}
              >
                {busy ? 'Adding…' : 'Add'}
              </button>
            </div>
          )}
          {error && <p className="tm-error">{error}</p>}
        </>
      )}
    </section>
  );
}

/** The Slack channel lives on the ticket as plain text; no Slack API is called.
 */
export function SlackSection({ channel, canEdit = true, onSave, collapsed, onToggle }) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    setBusy(true);
    setError('');
    try {
      await onSave(draft.trim().replace(/^#/, ''));
      setDraft('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="tm-section">
      <button type="button" className="tm-section-toggle" onClick={onToggle} aria-expanded={!collapsed}>
        {collapsed ? <ChevronRight size={14} /> : <ChevronRight size={14} className="tm-rot90" />}
        <SlackIcon size={14} />
        <h3 className="tm-section-title">Slack</h3>
      </button>

      {!collapsed && (
        <>
          <p className="tm-slack-line">
            {channel ? (
              <>
                <span className="tm-slack-channel">#{channel}</span> is connected to this issue.
              </>
            ) : (
              <span className="tm-muted">No Slack channel connected.</span>
            )}
          </p>
          {canEdit && (
            <div className="tm-weblink-add">
              <input
                className="tm-input"
                placeholder="team-platform"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                aria-label="Slack channel"
              />
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={save}
                disabled={busy}
              >
                {busy ? 'Saving…' : draft ? 'Connect' : 'Disconnect'}
              </button>
            </div>
          )}
          {error && <p className="tm-error">{error}</p>}
        </>
      )}
    </section>
  );
}

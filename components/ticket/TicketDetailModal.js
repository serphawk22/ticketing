'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Avatar from '../Avatar';
import { TYPE_META, TypeIcon, RELATION_META, RELATION_ORDER, CHILD_RELATION, ticketKey } from '../meta';
import {
  ChevronLeft,
  ChevronRight,
  CloseIcon,
  DotsIcon,
  EyeIcon,
  LightningIcon,
  LinkIcon,
  PaperclipIcon,
  PlusIcon,
  RestoreIcon,
  ShareIcon,
} from './icons';
import { InlineText, Menu, MenuItem, MenuLabel } from './parts';
import DescriptionEditor from './DescriptionEditor';
import ActivityFeed from './ActivityFeed';
import DetailsSidebar from './DetailsSidebar';
import { AttachmentsSection, RelationsSection } from './sections';

const emptyDetail = {
  ticket: null,
  activity: [],
  comments: [],
  attachments: [],
  relations: [],
  childItems: [],
  watchers: [],
  timeLogs: [],
  loggedSeconds: 0,
};

async function call(url, options) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export default function TicketDetailModal({
  ticket,
  employees = [],
  currentUser,
  siblingTickets = [],
  canStep = false,
  onClose,
  onPrev,
  onNext,
  onTicketChanged,
  onOpenTicket,
}) {
  const [detail, setDetail] = useState(emptyDetail);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkQuery, setLinkQuery] = useState('');
  const [linkType, setLinkType] = useState('relates_to');
  const [commentDraft, setCommentDraft] = useState('');
  const [attachmentsOpen, setAttachmentsOpen] = useState(true);
  const [childOpen, setChildOpen] = useState(true);
  const [linkedOpen, setLinkedOpen] = useState(true);
  const [configureOpen, setConfigureOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const scrollMain = useRef(null);
  const scrollSide = useRef(null);

  const id = ticket?.id;
  const isAdmin = currentUser?.role === 'admin';
  const key = ticket ? ticketKey(ticket) : '';

  const load = useCallback(async (signal) => {
    if (!id) return;
    setLoading(true);
    setError('');
    try {
      const data = await call(`/api/tickets/${id}/detail`, { signal });
      setDetail({ ...emptyDetail, ...data });
    } catch (err) {
      if (err.name !== 'AbortError') setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    setCommentDraft('');
    setAddOpen(false);
    setMoreOpen(false);
    setLinkOpen(false);
    setLinkQuery('');
    setExpanded(false);
    scrollMain.current?.scrollTo(0, 0);
    scrollSide.current?.scrollTo(0, 0);
  }, [id]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.altKey && e.key === 'ArrowDown') {
        e.preventDefault();
        onNext();
      } else if (e.altKey && e.key === 'ArrowUp') {
        e.preventDefault();
        onPrev();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onNext, onPrev]);

  const patch = useCallback(
    async (fields) => {
      if (!id) return;
      setBusy(true);
      setError('');
      try {
        const data = await call(`/api/tickets/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(fields),
        });
        setDetail((d) => ({ ...d, ticket: data.ticket }));
        onTicketChanged?.(data.ticket);
        await load();
      } catch (err) {
        setError(err.message);
      } finally {
        setBusy(false);
      }
    },
    [id, onTicketChanged, load]
  );

  const addComment = useCallback(async () => {
    const body = commentDraft.trim();
    if (!body) return;
    setBusy(true);
    try {
      const data = await call(`/api/tickets/${id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      setCommentDraft('');
      setDetail((d) => ({ ...d, comments: data.comments }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }, [id, commentDraft]);

  const editComment = useCallback(
    async (commentId, body) => {
      try {
        const data = await call(`/api/tickets/${id}/comments/${commentId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body }),
        });
        setDetail((d) => ({ ...d, comments: data.comments }));
      } catch (err) {
        setError(err.message);
      }
    },
    [id]
  );

  const deleteComment = useCallback(
    async (comment) => {
      try {
        const data = await call(`/api/tickets/${id}/comments/${comment.id}`, { method: 'DELETE' });
        setDetail((d) => ({ ...d, comments: data.comments }));
      } catch (err) {
        setError(err.message);
      }
    },
    [id]
  );

  const uploadFile = useCallback(
    async (file) => {
      const form = new FormData();
      form.append('file', file);
      const data = await call(`/api/tickets/${id}/attachments`, { method: 'POST', body: form });
      setDetail((d) => ({ ...d, attachments: data.attachments }));
    },
    [id]
  );

  const deleteFile = useCallback(
    async (file) => {
      const data = await call(`/api/tickets/${id}/attachments?attachment=${file.id}`, { method: 'DELETE' });
      setDetail((d) => ({ ...d, attachments: data.attachments }));
    },
    [id]
  );

  const openFile = useCallback(async (file) => {
    try {
      const data = await call(`/api/tickets/${id}/attachments?attachment=${file.id}`);
      window.open(data.url, '_blank', 'noopener');
    } catch (err) {
      setError(err.message);
    }
  }, [id]);

  const addRelation = useCallback(
    async (relatedId, type) => {
      try {
        const data = await call(`/api/tickets/${id}/relations`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ related_ticket_id: relatedId, relation_type: type }),
        });
        setDetail((d) => ({ ...d, relations: data.relations }));
        setLinkOpen(false);
        setLinkQuery('');
        await load();
      } catch (err) {
        setError(err.message);
      }
    },
    [id, load]
  );

  const removeRelation = useCallback(
    async (item) => {
      const relationId = item.relation_id || item.id;
      if (!relationId) return;
      try {
        const data = await call(`/api/tickets/${id}/relations?relation=${relationId}`, { method: 'DELETE' });
        setDetail((d) => ({ ...d, relations: data.relations }));
        await load();
      } catch (err) {
        setError(err.message);
      }
    },
    [id, load]
  );

  const logTime = useCallback(
    async (seconds, note) => {
      try {
        const data = await call(`/api/tickets/${id}/time`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ seconds, note }),
        });
        setDetail((d) => ({ ...d, ...data }));
      } catch (err) {
        setError(err.message);
      }
    },
    [id]
  );

  // Derived from the loaded watcher rows so a refresh cannot show a stale
  // "watching" state.
  const watching = useMemo(
    () => Boolean(currentUser && (detail.watchers || []).some((w) => w.user_id === currentUser.id)),
    [detail.watchers, currentUser]
  );

  const toggleWatch = useCallback(async () => {
    try {
      const data = await call(`/api/tickets/${id}/watchers`, {
        method: watching ? 'DELETE' : 'POST',
      });
      setDetail((d) => ({ ...d, watchers: data.watchers }));
    } catch (err) {
      setError(err.message);
    }
  }, [id, watching]);

  // Everything already linked from this ticket, so the picker can hide them
  // instead of failing with a duplicate error.
  const linkedIds = useMemo(() => {
    const ids = new Set();
    (detail.relations || []).forEach((r) => ids.add(r.related_ticket_id));
    (detail.childItems || []).forEach((r) => ids.add(r.id));
    return ids;
  }, [detail.relations, detail.childItems]);

  const linkTypes = useMemo(
    () => (linkType === CHILD_RELATION ? [CHILD_RELATION] : RELATION_ORDER),
    [linkType]
  );

  // Searching the server means a link can cross projects; the tickets already
  // on screen seed the list so an exact key matches without a round trip.
  const [linkResults, setLinkResults] = useState([]);
  const [linkSearching, setLinkSearching] = useState(false);

  useEffect(() => {
    const q = linkQuery.trim();
    if (q.length < 2) {
      setLinkResults([]);
      return undefined;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLinkSearching(true);
      try {
        const data = await call(
          `/api/tickets/search?q=${encodeURIComponent(q)}&exclude=${id}`,
          { signal: controller.signal }
        );
        setLinkResults(data.tickets || []);
      } catch (err) {
        if (err.name !== 'AbortError') setError(err.message);
      } finally {
        setLinkSearching(false);
      }
    }, 220);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [linkQuery, id]);

  const linkCandidates = useMemo(() => {
    const q = linkQuery.trim().toLowerCase();
    const merged = new Map();
    for (const t of siblingTickets || []) merged.set(t.id, t);
    for (const t of linkResults) if (!merged.has(t.id)) merged.set(t.id, t);
    return [...merged.values()]
      .filter((t) => t.id !== id && !linkedIds.has(t.id))
      .filter(
        (t) =>
          !q ||
          ticketKey(t).toLowerCase().includes(q) ||
          String(t.title).toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [siblingTickets, linkResults, linkQuery, id, linkedIds]);

  // A linked issue can be outside the current filter, so hand the key back to
  // the page rather than an id it may not know about.
  const openLinked = useCallback(
    (item) => {
      const target = siblingTickets.find((x) => x.id === item.id);
      if (target) onOpenTicket?.(target);
      else onOpenTicket?.({ id: item.id, project_key: item.project_key });
    },
    [siblingTickets, onOpenTicket]
  );

  const shareUrl = typeof window !== 'undefined' ? window.location.href : '';
  const t = detail.ticket || ticket;
  const typeMeta = TYPE_META[t.type] || TYPE_META.task;
  const watchers = detail.watchers || [];
  const meEmployee = useMemo(
    () => employees.find((e) => currentUser && e.email === currentUser.email),
    [employees, currentUser]
  );

  if (!ticket) return null;

  return (
    <div className="tm-overlay" onMouseDown={onClose} data-testid="tm-overlay">
      <div
        className={`tm-modal${expanded ? ' is-expanded' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={`Ticket ${key}`}
        data-testid="tm-modal"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="tm-topbar">
          <div className="tm-topbar-left">
            <span className="tm-type-icon" style={{ color: typeMeta.color }} title={typeMeta.label}>
              <TypeIcon type={t.type} size={14} />
            </span>
            <button type="button" className="tm-key-link" onClick={() => {}}>
              {key}
            </button>
            {loading && <span className="tm-spinner" aria-label="Loading" />}
          </div>
          <div className="tm-topbar-right">
            <button
              type="button"
              className={`tm-watch-btn${watching ? ' is-watching' : ''}`}
              title={watching ? 'Stop watching' : 'Watch this issue'}
              aria-label={watching ? 'Stop watching this issue' : 'Watch this issue'}
              aria-pressed={watching}
              onClick={toggleWatch}
            >
              <EyeIcon size={15} />
              <span className="tm-watcher-count">{watchers.length}</span>
            </button>
            {watchers.length > 0 && (
              <span className="tm-watch-avatars">
                {watchers.slice(0, 3).map((w) => (
                  <Avatar key={w.id} name={w.user_name} assigned size={20} />
                ))}
                {watchers.length > 3 && (
                  <span className="tm-watch-more">+{watchers.length - 3}</span>
                )}
              </span>
            )}
            <div className="tm-relative">
              <button
                type="button"
                className="tm-icon-btn"
                title="Share"
                aria-label="Share"
                onClick={() => setShareOpen((v) => !v)}
              >
                <ShareIcon size={15} />
              </button>
              <Menu open={shareOpen} onClose={() => setShareOpen(false)} align="right">
                <MenuLabel>Link to this issue</MenuLabel>
                <li className="tm-share">
                  <input className="tm-input" readOnly value={shareUrl} onFocus={(e) => e.target.select()} />
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => {
                      navigator.clipboard?.writeText(shareUrl);
                      setShareOpen(false);
                    }}
                  >
                    Copy
                  </button>
                </li>
              </Menu>
            </div>
            <div className="tm-relative">
              <button
                type="button"
                className="tm-icon-btn"
                title="More"
                aria-label="More actions"
                onClick={() => setMoreOpen((v) => !v)}
              >
                <DotsIcon size={15} />
              </button>
              <Menu open={moreOpen} onClose={() => setMoreOpen(false)} align="right">
                <MenuLabel>{key}</MenuLabel>
                <MenuItem
                  onClick={() => {
                    navigator.clipboard?.writeText(shareUrl);
                    setMoreOpen(false);
                  }}
                  icon={<LinkIcon size={14} />}
                >
                  Copy link
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    setMoreOpen(false);
                    setLinkOpen(true);
                    setLinkType('relates_to');
                    setLinkedOpen(true);
                  }}
                  icon={<PlusIcon size={14} />}
                >
                  Add linked work item
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    setMoreOpen(false);
                    setLinkOpen(true);
                    setLinkType(CHILD_RELATION);
                    setChildOpen(true);
                  }}
                  icon={<PlusIcon size={14} />}
                >
                  Add child work item
                </MenuItem>
              </Menu>
            </div>
            <button
              type="button"
              className="tm-icon-btn"
              title={expanded ? 'Restore size' : 'Expand to full screen'}
              aria-label={expanded ? 'Restore size' : 'Expand to full screen'}
              aria-pressed={expanded}
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? <CloseIcon size={15} /> : <RestoreIcon size={15} />}
            </button>
            <button type="button" className="tm-icon-btn" title="Close (Esc)" aria-label="Close" onClick={onClose}>
              <CloseIcon size={15} />
            </button>
            <span className="tm-step">
              <button
                type="button"
                className="tm-icon-btn"
                title="Previous issue (Alt+Up)"
                aria-label="Previous issue"
                disabled={!canStep}
                onClick={onPrev}
              >
                <ChevronLeft size={15} />
              </button>
              <button
                type="button"
                className="tm-icon-btn"
                title="Next issue (Alt+Down)"
                aria-label="Next issue"
                disabled={!canStep}
                onClick={onNext}
              >
                <ChevronRight size={15} />
              </button>
            </span>
          </div>
        </header>

        <div className="tm-body">
          <div className="tm-main" ref={scrollMain} data-testid="tm-main">
            {error && (
              <p className="tm-error" role="alert">
                {error}
              </p>
            )}

            <div className="tm-title-row">
              <InlineText
                value={t.title}
                placeholder="Add a summary"
                ariaLabel="Ticket title"
                className="tm-title-input"
                inputClassName="tm-title-edit"
                onSave={(v) => patch({ title: v })}
              />
            </div>

            <div className="tm-add-row">
              <div className="tm-relative">
                <button
                  type="button"
                  className="tm-add-btn"
                  aria-label="Add field"
                  onClick={() => setAddOpen((v) => !v)}
                >
                  <PlusIcon size={14} />
                </button>
                <Menu open={addOpen} onClose={() => setAddOpen(false)}>
                  <MenuLabel>Add to issue</MenuLabel>
                  <MenuItem
                    icon={<PaperclipIcon size={14} />}
                    onClick={() => {
                      setAddOpen(false);
                      setAttachmentsOpen(true);
                      document.querySelector('.tm-dropzone-btn')?.click();
                    }}
                  >
                    Attachment
                  </MenuItem>
                  <MenuItem
                    icon={<LinkIcon size={14} />}
                    onClick={() => {
                      setAddOpen(false);
                      setLinkOpen(true);
                      setLinkedOpen(true);
                    }}
                  >
                    Linked work item
                  </MenuItem>
                </Menu>
              </div>
            </div>

            <section className="tm-section">
              <h3 className="tm-section-title">Description</h3>
              <DescriptionEditor
                value={t.description}
                onSave={(v) => patch({ description: v })}
                canEdit
              />
            </section>

            <AttachmentsSection
              attachments={detail.attachments}
              onUpload={uploadFile}
              onDelete={deleteFile}
              onOpen={openFile}
              canEdit
              collapsed={!attachmentsOpen}
              onToggle={() => setAttachmentsOpen((v) => !v)}
            />

            <RelationsSection
              title="Child work items"
              items={detail.childItems}
              emptyHint="No child work items yet."
              addLabel="Add child work item"
              onAdd={() => {
                setLinkOpen(true);
                setLinkType(CHILD_RELATION);
                setChildOpen(true);
              }}
              onRemove={removeRelation}
              onOpen={openLinked}
              collapsed={!childOpen}
              onToggle={() => setChildOpen((v) => !v)}
              canEdit
            />

            <RelationsSection
              title="Linked work items"
              items={detail.relations}
              emptyHint="Nothing linked yet."
              addLabel="Add linked work item"
              relationLabel={(type) => RELATION_META[type]?.label || type}
              onAdd={() => {
                setLinkOpen(true);
                setLinkType('relates_to');
                setLinkedOpen(true);
              }}
              onRemove={removeRelation}
              onOpen={openLinked}
              collapsed={!linkedOpen}
              onToggle={() => setLinkedOpen((v) => !v)}
              canEdit
            />

            {linkOpen && (
              <div className="tm-link-picker">
                <div className="tm-link-picker-head">
                  <input
                    className="tm-input"
                    autoFocus
                    placeholder="Find a ticket by key or title"
                    value={linkQuery}
                    onChange={(e) => setLinkQuery(e.target.value)}
                    aria-label="Find a ticket"
                  />
                  <select
                    className="tm-input tm-input-select"
                    value={linkType}
                    onChange={(e) => setLinkType(e.target.value)}
                    aria-label="Relationship type"
                  >
                    {linkTypes.map((type) => (
                      <option key={type} value={type}>
                        {RELATION_META[type].label}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="tm-icon-btn" aria-label="Cancel link" onClick={() => setLinkOpen(false)}>
                    <CloseIcon size={14} />
                  </button>
                </div>
                {linkQuery.trim().length < 2 ? (
                  <p className="tm-empty">Type at least two characters to search.</p>
                ) : linkSearching ? (
                  <p className="tm-empty">Searching...</p>
                ) : linkCandidates.length === 0 ? (
                  <p className="tm-empty">No matching tickets.</p>
                ) : null}
                <ul className="tm-link-results">
                  {linkCandidates.map((candidate) => (
                    <li key={candidate.id}>
                      <button type="button" onClick={() => addRelation(candidate.id, linkType)}>
                        <span className="tm-link-key">{ticketKey(candidate)}</span>
                        <span className="tm-link-title">{candidate.title}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <ActivityFeed
              activity={detail.activity}
              comments={detail.comments}
              timeLogs={detail.timeLogs}
              currentUser={currentUser}
              commentDraft={commentDraft}
              onCommentDraft={setCommentDraft}
              onAddComment={addComment}
              onEditComment={editComment}
              onDeleteComment={deleteComment}
            />
          </div>

          <DetailsSidebar
            ticket={t}
            detail={{ ...detail, meEmployeeId: meEmployee?.id }}
            employees={employees}
            isAdmin={isAdmin}
            onPatch={patch}
            onLogTime={logTime}
            onOpenWatcherMenu={() => setMoreOpen((v) => !v)}
            configureOpen={configureOpen}
            onToggleConfigure={() => setConfigureOpen((v) => !v)}
          />
        </div>
      </div>
    </div>
  );
}

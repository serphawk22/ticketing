'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PRIORITY_META, STATUS_META, formatFullDateTime } from '@/components/meta';

/**
 * The client portal.
 *
 * Deliberately its own shell rather than the team AppShell: no project list, no
 * directory, no other people's work. A client gets three things -- raise a
 * request, see where their requests are, and talk to the team about them.
 */
export default function ClientPortalView({ currentUser, tickets, comments }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [draft, setDraft] = useState({ title: '', description: '', priority: 'medium' });
  const [replyFor, setReplyFor] = useState(null);
  const [reply, setReply] = useState('');
  const [busyTicket, setBusyTicket] = useState(null);

  const openCount = useMemo(
    () => tickets.filter((t) => t.status === 'open' || t.status === 'in_progress').length,
    [tickets]
  );

  async function handleRaise(e) {
    e.preventDefault();
    setError('');
    setNotice('');
    setSubmitting(true);

    try {
      const res = await fetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: draft.title.trim(),
          description: draft.description.trim(),
          priority: draft.priority,
          // A request arrives for triage: no project and no owner until the team
          // routes it, which is what the admin sidebar queue is for.
          project_id: null,
          employee_id: null,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not raise the request.');

      setDraft({ title: '', description: '', priority: 'medium' });
      setNotice('Your request was sent to the team.');
      router.refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReply(ticketId) {
    const text = reply.trim();
    if (!text) return;

    setError('');
    setBusyTicket(ticketId);

    try {
      const res = await fetch(`/api/tickets/${ticketId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: text }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not send your reply.');

      setReply('');
      setReplyFor(null);
      router.refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyTicket(null);
    }
  }

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/client/login';
  }

  return (
    <div className="client-portal">
      <header className="client-topbar">
        <div className="client-brand">
          <span className="logo-tile" aria-hidden="true">
            T
          </span>
          <span className="client-brand-name">Client portal</span>
        </div>

        <div className="client-topbar-right">
          <span className="client-who">{currentUser.name}</span>
          <button type="button" className="btn-secondary" onClick={handleLogout}>
            Sign out
          </button>
        </div>
      </header>

      <main className="client-main">
        <section className="client-raise">
          <h1>Raise a request</h1>
          <p className="client-sub">
            Tell us what you need. The team picks it up, and you will see the
            status change here.
          </p>

          <form onSubmit={handleRaise} className="client-form">
            <div className="form-group">
              <label htmlFor="client-title">Title</label>
              <input
                id="client-title"
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder="What do you need?"
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="client-description">Details</label>
              <textarea
                id="client-description"
                rows={4}
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                placeholder="Add anything that helps us understand the request."
                required
              />
            </div>

            <div className="client-form-row">
              <div className="form-group form-group-narrow">
                <label htmlFor="client-priority">Priority</label>
                <select
                  id="client-priority"
                  value={draft.priority}
                  onChange={(e) => setDraft({ ...draft, priority: e.target.value })}
                >
                  {['low', 'medium', 'high', 'urgent'].map((key) => (
                    <option key={key} value={key}>
                      {PRIORITY_META[key].label}
                    </option>
                  ))}
                </select>
              </div>

              <button type="submit" className="btn-primary" disabled={submitting}>
                {submitting ? 'Sending…' : 'Send request'}
              </button>
            </div>

            {error && <div className="error-text">{error}</div>}
            {notice && <div className="client-notice">{notice}</div>}
          </form>
        </section>

        <section className="client-requests">
          <div className="client-requests-head">
            <h2>Your requests</h2>
            <span className="client-count">
              {tickets.length} total{openCount ? `, ${openCount} in progress` : ''}
            </span>
          </div>

          {tickets.length === 0 ? (
            <div className="client-empty">
              <p>You have not raised anything yet.</p>
              <p className="client-empty-sub">
                Anything you send above will appear here with its status.
              </p>
            </div>
          ) : (
            <ul className="client-ticket-list">
              {tickets.map((t) => {
                const status = STATUS_META[t.status] || STATUS_META.open;
                const priority = PRIORITY_META[t.priority] || PRIORITY_META.medium;
                const thread = comments[t.id] || [];

                return (
                  <li key={t.id} className="client-ticket">
                    <div className="client-ticket-head">
                      <span className="client-ticket-id">
                        {t.project_key ? `${t.project_key}-${t.id}` : `#${t.id}`}
                      </span>
                      <span
                        className="badge"
                        style={{ background: status.bg, color: status.text }}
                      >
                        {status.label}
                      </span>
                      <span
                        className="badge"
                        style={{ background: priority.bg, color: priority.text }}
                      >
                        {priority.label}
                      </span>
                    </div>

                    <h3 className="client-ticket-title">{t.title}</h3>
                    <p className="client-ticket-desc">{t.description}</p>

                    <div className="client-ticket-meta">
                      <span>
                        {t.employee_name
                          ? `Assigned to ${t.employee_name}`
                          : 'Waiting for the team to assign it'}
                      </span>
                      <span>Raised {formatFullDateTime(t.created_at)}</span>
                    </div>

                    {thread.length > 0 && (
                      <ul className="client-thread">
                        {thread.map((c) => (
                          <li
                            key={c.id}
                            className={
                              c.author_id === currentUser.id
                                ? 'client-comment client-comment-own'
                                : 'client-comment'
                            }
                          >
                            <div className="client-comment-head">
                              <strong>{c.author_name}</strong>
                              <span>{formatFullDateTime(c.created_at)}</span>
                            </div>
                            <p>{c.body}</p>
                          </li>
                        ))}
                      </ul>
                    )}

                    {replyFor === t.id ? (
                      <div className="client-reply">
                        <textarea
                          rows={3}
                          value={reply}
                          onChange={(e) => setReply(e.target.value)}
                          placeholder="Add a reply for the team…"
                          autoFocus
                        />
                        <div className="client-reply-actions">
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={() => {
                              setReplyFor(null);
                              setReply('');
                            }}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            className="btn-primary"
                            disabled={busyTicket === t.id}
                            onClick={() => handleReply(t.id)}
                          >
                            {busyTicket === t.id ? 'Sending…' : 'Send reply'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="btn-secondary client-reply-btn"
                        onClick={() => setReplyFor(t.id)}
                      >
                        Reply
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import ClientShell from '@/components/ClientShell';
import { PRIORITY_META, STATUS_META, STATUS_PROGRESS, formatFullDateTime } from '@/components/meta';

/**
 * The client's request list.
 *
 * Raising a request lives on its own route (/client/new), so this page only
 * has to answer one question: where did the things I asked for end up. Each row
 * carries the two facts a client actually comes back for -- the current status,
 * and who on the team is working on it.
 */
export default function ClientPortalView({ currentUser, tickets, comments }) {
  const router = useRouter();
  const [error, setError] = useState('');
  const [replyFor, setReplyFor] = useState(null);
  const [reply, setReply] = useState('');
  const [busyTicket, setBusyTicket] = useState(null);

  const openCount = useMemo(
    () => tickets.filter((t) => t.status === 'open' || t.status === 'in_progress').length,
    [tickets]
  );

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

  return (
    <ClientShell currentUser={currentUser}>
      <section className="client-requests">
        <div className="client-requests-head">
          <div>
            <h2>Your requests</h2>
            <span className="client-count">
              {tickets.length} total{openCount ? `, ${openCount} in progress` : ''}
            </span>
          </div>
          <Link href="/client/new" className="btn-primary">
            Raise a request
          </Link>
        </div>

        {error && <div className="error-text">{error}</div>}

        {tickets.length === 0 ? (
          <div className="client-empty">
            <p>You have not raised anything yet.</p>
            <p className="client-empty-sub">
              <Link href="/client/new">Raise a request</Link> and it will appear
              here with its status and who is working on it.
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

                  <div
                    className="client-progress"
                    role="progressbar"
                    aria-valuenow={STATUS_PROGRESS[t.status] ?? STATUS_PROGRESS.open}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`Progress for ${t.title}`}
                  >
                    <div className="client-progress-head">
                      <span className="client-progress-label">Progress</span>
                      <span className="client-progress-value">
                        {STATUS_PROGRESS[t.status] ?? STATUS_PROGRESS.open}%
                      </span>
                    </div>
                    <div className="client-progress-track">
                      <div
                        className="client-progress-fill"
                        style={{
                          width: `${STATUS_PROGRESS[t.status] ?? STATUS_PROGRESS.open}%`,
                          background: status.color,
                        }}
                      />
                    </div>
                  </div>

                  <dl className="client-ticket-facts">
                    <div className="client-fact">
                      <dt>Status</dt>
                      <dd>{status.label}</dd>
                    </div>
                    <div className="client-fact">
                      <dt>Working on it</dt>
                      <dd>
                        {t.employee_name ? (
                          <>
                            {t.employee_name}
                            {t.employee_email && (
                              <span className="client-fact-sub">
                                {t.employee_email}
                              </span>
                            )}
                          </>
                        ) : (
                          'Waiting for the team to assign it'
                        )}
                      </dd>
                    </div>
                    <div className="client-fact">
                      <dt>Raised</dt>
                      <dd>{formatFullDateTime(t.created_at)}</dd>
                    </div>
                  </dl>

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
    </ClientShell>
  );
}

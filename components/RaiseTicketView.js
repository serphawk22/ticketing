'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AppShell from '@/components/AppShell';
import {
  LOZENGE_TINTS,
  PRIORITY_META,
  PRIORITY_ORDER,
  STATUS_META,
  TYPE_META,
  TYPE_ORDER,
  PriorityIcon,
  TypeIcon,
  ticketKey,
} from '@/components/meta';

function PlusIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export default function RaiseTicketView({
  initialRaised,
  currentUser,
  myIssuesCount,
  projects = [],
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('medium');
  const [type, setType] = useState('task');
  const [category, setCategory] = useState('');
  const [raised, setRaised] = useState(initialRaised);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [justRaised, setJustRaised] = useState(null);
  const router = useRouter();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      const res = await fetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          description,
          priority,
          type,
          category,
          // A request is raised for triage: the requester does not choose who
          // picks it up, and it starts out belonging to no project.
          employee_id: null,
          project_id: null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to raise ticket.');

      setRaised((list) => [data.ticket, ...list].slice(0, 8));
      setJustRaised(data.ticket);
      setTitle('');
      setDescription('');
      setCategory('');
      setPriority('medium');
      setType('task');
      // The sidebar counts and the other views both read from the server, so
      // the new request has to reach them rather than staying local.
      router.refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AppShell
      currentUser={currentUser}
      projects={projects}
      projectCounts={null}
      myIssuesCount={myIssuesCount}
      view="raise"
      filter="all"
      onFilterChange={() => router.push('/?filter=mine')}
      projectId="all"
      onProjectChange={(id) => router.push(`/?project=${id}`)}
    >
      <div className="board">
        {error && (
          <div className="error-banner">
            <strong>Error:</strong> {error}
            <button type="button" onClick={() => setError('')}>
              Dismiss
            </button>
          </div>
        )}

        <div className="board-toolbar">
          <div className="toolbar-title">
            <nav className="breadcrumb" aria-label="Breadcrumb">
              <Link href="/">Home</Link>
              <span className="breadcrumb-sep" aria-hidden="true">
                /
              </span>
              <span>Raise a ticket</span>
            </nav>
            <h1>Raise a ticket</h1>
            <p className="board-subtitle">
              Tell us what you need. Your request goes to the team to pick up.
            </p>
          </div>
        </div>

        <div className="raise-layout">
          <section className="raise-form-card">
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label htmlFor="raise-summary">Summary</label>
                <input
                  id="raise-summary"
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="What needs to be done?"
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="raise-description">Description</label>
                <textarea
                  id="raise-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Add a description…"
                  rows={5}
                  required
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="raise-priority">Priority</label>
                  <select
                    id="raise-priority"
                    value={priority}
                    onChange={(e) => setPriority(e.target.value)}
                  >
                    {PRIORITY_ORDER.map((p) => (
                      <option key={p} value={p}>
                        {PRIORITY_META[p].label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label htmlFor="raise-type">Issue type</label>
                  <select
                    id="raise-type"
                    value={type}
                    onChange={(e) => setType(e.target.value)}
                  >
                    {TYPE_ORDER.map((t) => (
                      <option key={t} value={t}>
                        {TYPE_META[t].label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label htmlFor="raise-category">Category</label>
                  <input
                    id="raise-category"
                    type="text"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    placeholder="Add category"
                  />
                </div>
              </div>

              <div className="raise-actions">
                <span className="field-hint">
                  Raised as {currentUser.name}. No assignee is set — the team
                  picks it up from the triage list.
                </span>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={submitting}
                >
                  <PlusIcon />
                  {submitting ? 'Raising…' : 'Raise ticket'}
                </button>
              </div>
            </form>
          </section>

          <aside className="raise-recent">
            <h2>Your recent requests</h2>
            {justRaised && (
              <p className="raise-flash" role="status">
                Raised <strong>{justRaised.title}</strong>. It is now in the
                triage list.
              </p>
            )}
            {raised.length === 0 ? (
              <p className="raise-empty">
                You have not raised a ticket yet. Anything you send from here
                shows up in this list.
              </p>
            ) : (
              <ul className="raise-list">
                {raised.map((t) => {
                  const priority = PRIORITY_META[t.priority] || PRIORITY_META.medium;
                  const lozenge = LOZENGE_TINTS[t.status] || LOZENGE_TINTS.open;
                  const typeMeta = TYPE_META[t.type] || TYPE_META.task;
                  return (
                    <li key={t.id} className="raise-list-item">
                      <Link
                        href={`/?selectedIssue=${ticketKey(t)}`}
                        className="raise-list-link"
                      >
                        <span className="raise-list-type">
                          <TypeIcon type={t.type} />
                        </span>
                        <span className="raise-list-main">
                          <span className="raise-list-title">{t.title}</span>
                          <span className="raise-list-meta">
                            <span className="raise-list-key">
                              {t.project_key
                                ? `${t.project_key}-${t.id}`
                                : `#${t.id}`}
                            </span>
                            <span className="raise-list-priority">
                              <PriorityIcon
                                color={priority.color}
                                arrow={priority.arrow}
                              />
                              {priority.label}
                            </span>
                            <span
                              className="list-lozenge"
                              style={{
                                background: lozenge.bg,
                                color: lozenge.text,
                              }}
                            >
                              {STATUS_META[t.status]?.label || t.status}
                            </span>
                            <span
                              className="raise-list-assignee"
                              style={{ color: typeMeta.text }}
                            >
                              {t.employee_name
                                ? t.employee_name
                                : t.assigned_to_name
                                  ? t.assigned_to_name
                                  : 'Unassigned'}
                            </span>
                          </span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </aside>
        </div>
      </div>
    </AppShell>
  );
}
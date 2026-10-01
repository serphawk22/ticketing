'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import AppShell from './AppShell';
import Avatar from './Avatar';
import ProjectTabs from './ProjectTabs';
import TicketDetailModal from './ticket/TicketDetailModal';
import useTicketModal from './useTicketModal';
import { useToasts, Toaster } from './Toaster';
import {
  PRIORITY_META,
  STATUS_META,
  TypeIcon,
  formatListDateTime,
  ticketKey,
} from './meta';

/**
 * Archived work items.
 *
 * A deliberately plain table rather than the full list: archived work is not
 * being worked on, so it needs to be findable and restorable but not editable
 * or filterable. Anything more would invite changes to rows the user has
 * already put away.
 */
export default function ArchivedView({ initialTickets, project, projects, projectCounts, myIssuesCount, currentUser }) {
  const [tickets, setTickets] = useState(initialTickets);
  const [query, setQuery] = useState('');
  const router = useRouter();
  const { toasts, push, dismiss, pause, resume } = useToasts();

  function handleProjectChange(id) {
    router.push(`/projects/${id}/summary`);
  }

  const modal = useTicketModal({ visible: tickets, lookup: tickets });

  function openTicket(id) {
    const found = tickets.find((t) => t.id === id);
    if (found) modal.select(found);
  }

  async function unarchive(ticket) {
    try {
      const res = await fetch(`/api/tickets/${ticket.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived: false }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not restore the work item.');
      setTickets((ts) => ts.filter((t) => t.id !== ticket.id));
      push({
        message: `Restored ${ticketKey(ticket)}.`,
        // Restoring twice is harmless, but saying so is better than pretending
        // the action is still pending.
        action: { label: 'Undo', onClick: () => restore(ticket) },
      });
    } catch (e) {
      push({ message: e.message, tone: 'error' });
    }
  }

  async function restore(ticket) {
    try {
      const res = await fetch(`/api/tickets/${ticket.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not re-archive the work item.');
      setTickets((ts) => [data.ticket, ...ts]);
      push({ message: `Re-archived ${ticketKey(ticket)}.` });
    } catch (e) {
      push({ message: e.message, tone: 'error' });
    }
  }

  const q = query.trim().toLowerCase();
  const visible = q
    ? tickets.filter(
        (t) => t.title.toLowerCase().includes(q) || ticketKey(t).toLowerCase().includes(q)
      )
    : tickets;

  return (
    <AppShell
      currentUser={currentUser}
      projects={projects}
      projectCounts={projectCounts}
      myIssuesCount={myIssuesCount}
      projectId={project.id}
      onProjectChange={handleProjectChange}
    >
      <main className="page">
        <ProjectTabs projectId={project.id} active="archived" />

        <header className="list-head">
          <div>
            <h1 className="page-title">Archived work items</h1>
            <p className="page-sub">
              {tickets.length === 0
                ? 'Nothing archived in this project.'
                : `${tickets.length} archived ${tickets.length === 1 ? 'work item' : 'work items'}.`}
            </p>
          </div>
        </header>

        {tickets.length === 0 ? (
          <div className="list-empty">
            <p className="list-empty-title">No archived work items</p>
            <p className="list-empty-text">
              Archived work items appear here and can be restored at any time.
            </p>
          </div>
        ) : (
          <>
            <div className="list-toolbar">
              <input
                className="list-search"
                placeholder="Search archived work items"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search archived work items"
              />
            </div>

            <table className="list-table">
              <thead>
                <tr>
                  <th scope="col">Key</th>
                  <th scope="col">Work item</th>
                  <th scope="col">Status</th>
                  <th scope="col">Assignee</th>
                  <th scope="col">Archived</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((t) => (
                  <tr key={t.id} className="list-row">
                    <td className="list-cell">
                      <button type="button" className="list-key" onClick={() => openTicket(t.id)}>
                        {ticketKey(t)}
                      </button>
                    </td>
                    <td className="list-cell">
                      <span className="list-cell-type" title={(PRIORITY_META[t.priority] || {}).label}>
                        <TypeIcon type={t.type} size={14} />
                      </span>
                      <button
                        type="button"
                        className="list-title"
                        onClick={() => openTicket(t.id)}
                      >
                        {t.title}
                      </button>
                    </td>
                    <td className="list-cell">
                      <span
                        className="tm-child-status"
                        style={{
                          background: STATUS_META[t.status]?.bg,
                          color: STATUS_META[t.status]?.text,
                        }}
                      >
                        {STATUS_META[t.status]?.label || t.status}
                      </span>
                    </td>
                    <td className="list-cell">
                      {t.employee_name ? (
                        <span className="list-assignee">
                          <Avatar name={t.employee_name} assigned size={24} />
                          {t.employee_name}
                        </span>
                      ) : (
                        <span className="list-cell-muted">Unassigned</span>
                      )}
                    </td>
                    <td className="list-cell list-cell-muted list-cell-date">
                      {formatListDateTime(t.archived_at)}
                    </td>
                    <td className="list-cell">
                      <button
                        type="button"
                        className="btn-secondary btn-small"
                        onClick={() => unarchive(t)}
                      >
                        Unarchive
                      </button>
                    </td>
                  </tr>
                ))}
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={6} className="list-cell list-cell-muted">
                      No archived work items match that search.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </>
        )}
      </main>

      <TicketDetailModal
        ticket={modal.selected}
        employees={[]}
        currentUser={currentUser}
        siblingTickets={tickets}
        canStep={modal.canStep}
        onClose={modal.close}
        onNext={modal.next}
        onPrev={modal.prev}
        onTicketChanged={() => {}}
        onOpenTicket={openTicket}
      />

      <Toaster toasts={toasts} onDismiss={dismiss} onPause={pause} onResume={resume} />
    </AppShell>
  );
}

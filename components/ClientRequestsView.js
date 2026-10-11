'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import AppShell from '@/components/AppShell';
import PageHeader from '@/components/PageHeader';
import EmptyState from '@/components/EmptyState';
import UserPicker from '@/components/UserPicker';
import TicketDetailModal from '@/components/ticket/TicketDetailModal';
import useTicketModal from '@/components/useTicketModal';
import { useToasts, Toaster } from '@/components/Toaster';
import {
  LOZENGE_TINTS,
  PRIORITY_META,
  PriorityIcon,
  STATUS_META,
  TypeIcon,
  formatFullDateTime,
  ticketKey,
} from '@/components/meta';

/**
 * The client request queue, full page.
 *
 * Requests wait here without an owner so nothing silently disappears between a
 * client sending one and the team noticing it. Assigning is the last action on
 * each row, because assigning is what turns a request into team work and takes
 * it out of this list.
 */
export default function ClientRequestsView({
  currentUser,
  requests,
  assignable,
  projects,
  projectCounts,
  myIssuesCount,
}) {
  const router = useRouter();
  // Both lists are the queue: the rows on screen are the whole set, and the
  // lookup is what stops a shared link to a request that has since been
  // assigned from resolving to nothing.
  const modal = useTicketModal({ visible: requests, lookup: requests });
  const { toasts, push, dismiss, pause, resume } = useToasts();
  const [busy, setBusy] = useState(null);

  async function assign(ticket, employeeId) {
    if (busy === ticket.id) return;
    setBusy(ticket.id);

    try {
      const res = await fetch(`/api/tickets/${ticket.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_id: employeeId }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not assign that request.');

      push({
        message: employeeId
          ? `Assigned to ${assignable.find((e) => e.id === employeeId)?.name || 'a developer'}.`
          : 'Removed from the queue.',
      });
      // The queue is derived from unassigned client tickets, so a refresh is what
      // actually takes the row away.
      router.refresh();
    } catch (err) {
      push({ message: err.message, tone: 'error' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <AppShell
      currentUser={currentUser}
      projects={projects}
      projectCounts={projectCounts}
      employeeCount={null}
      myIssuesCount={myIssuesCount}
      view="client-requests"
      filter="all"
      onFilterChange={() => router.push('/?filter=mine')}
      projectId="all"
      onProjectChange={(id) => router.push(`/?project=${id}`)}
      onCreate={null}
    >
      {/* The shared page container. AppShell's .app-body is a row flexbox, so a
          page that skips this wrapper lays its header and table out as columns
          side by side instead of stacked, and loses the app-wide padding. */}
      <div className="board">
        <PageHeader
          breadcrumb={[
            { label: 'People', href: '/employees' },
            { label: 'Client requests' },
          ]}
          title="Client requests"
          subtitle="Requests raised by client accounts that nobody has picked up yet"
        />

        {requests.length === 0 ? (
          <EmptyState
            title="Nothing waiting"
            text="Every client request has been assigned to somebody."
          />
        ) : (
          /* The List view's grid, not a second table of our own: same column
             dividers, same sticky header, same row hover and cell metrics. */
          <div className="list-scroll" role="region" aria-label="Client requests" tabIndex={0}>
            <table className="list-table">
              <thead>
                <tr>
                  <th className="list-th" scope="col">
                    Request
                  </th>
                  <th className="list-th" scope="col">
                    Raised by
                  </th>
                  <th className="list-th" scope="col">
                    Priority
                  </th>
                  <th className="list-th" scope="col">
                    Status
                  </th>
                  <th className="list-th" scope="col">
                    Raised
                  </th>
                  <th className="list-th" scope="col">
                    Assign to
                  </th>
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => {
                  const priority = PRIORITY_META[r.priority] || PRIORITY_META.medium;
                  const status = STATUS_META[r.status] || STATUS_META.open;
                  // Jira tints the lozenge by outcome rather than by the board
                  // column colour, which is why this is not status.bg.
                  const lozenge = LOZENGE_TINTS[r.status] || LOZENGE_TINTS.open;

                  return (
                    <tr key={r.id} className="list-row">
                      <td className="list-cell list-cell-work">
                        <span className="list-work">
                          <span className="card-type-icon is-plain" aria-hidden="true">
                            <TypeIcon type={r.type} size={12} />
                          </span>
                          <button
                            type="button"
                            className="list-key"
                            onClick={() => modal.select(r)}
                          >
                            {ticketKey(r)}
                          </button>
                          <button
                            type="button"
                            className="list-title"
                            onClick={() => modal.select(r)}
                          >
                            {r.title}
                          </button>
                        </span>
                      </td>
                      <td className="list-cell">{r.created_by_name}</td>
                      <td className="list-cell">
                        <span className="list-priority">
                          <PriorityIcon color={priority.color} arrow={priority.arrow} />
                          <span>{priority.label}</span>
                        </span>
                      </td>
                      <td className="list-cell">
                        <span
                          className="list-lozenge"
                          style={{ background: lozenge.bg, color: lozenge.text }}
                        >
                          {status.label}
                        </span>
                      </td>
                      <td className="list-cell">{formatFullDateTime(r.created_at)}</td>
                      <td className="list-cell list-cell-assignee">
                        <UserPicker
                          value={r.employee_id}
                          users={assignable.map((e) => ({ id: e.id, name: e.name }))}
                          onSelect={(id) => assign(r, id)}
                          label={`Assignee of ${ticketKey(r)}`}
                          className="list-person"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modal.selected && (
        <TicketDetailModal
          ticket={modal.selected}
          employees={[]}
          currentUser={currentUser}
          siblingTickets={requests}
          canStep={modal.canStep}
          onClose={modal.close}
          onNext={modal.next}
          onPrev={modal.prev}
          onTicketChanged={() => router.refresh()}
          onArchiveChange={() => router.refresh()}
        />
      )}

      <Toaster toasts={toasts} onDismiss={dismiss} onPause={pause} onResume={resume} />
    </AppShell>
  );
}
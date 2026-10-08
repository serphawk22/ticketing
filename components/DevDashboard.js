'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import AppShell from './AppShell';
import TicketCard from './TicketCard';
import TicketDetailModal from './ticket/TicketDetailModal';
import { mergeArchiveChange } from './archiveChange';
import useTicketModal from './useTicketModal';
import { DONE_STATUSES, PRIORITY_META, PRIORITY_ORDER, ticketKey } from './meta';

const SECTIONS = [
  { id: 'today', title: 'Today', hint: 'Due today' },
  { id: 'todo', title: 'To do', hint: 'Open work' },
  { id: 'completed', title: 'Completed', hint: 'Done and closed' },
];

function SearchIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.35-4.35" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M3 11h18" />
    </svg>
  );
}

function InboxIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12h-6l-2 3h-2l-2-3H3" />
      <path d="M5.5 5h13l2.5 7v7H3v-7z" />
    </svg>
  );
}

const SECTION_ICONS = {
  today: CalendarIcon,
  todo: InboxIcon,
  completed: CheckIcon,
};

function rank(priority) {
  const i = PRIORITY_ORDER.indexOf(priority);
  return i === -1 ? PRIORITY_ORDER.length : i;
}

function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || 'there';
}

/**
 * The developer landing page.
 *
 * A developer does not get the board: they get the work an admin handed them,
 * split into what is due today, what is still to do, and what is finished. The
 * board stays available per project for anyone who wants the column view.
 */
export default function DevDashboard({
  initialTickets,
  initialProjects,
  initialEmployees,
  currentUser,
  currentEmployeeId,
  today,
}) {
  const [tickets, setTickets] = useState(initialTickets);
  const [projects] = useState(initialProjects);
  const [employees] = useState(initialEmployees);
  const [search, setSearch] = useState('');
  const [projectId, setProjectId] = useState('all');
  const [priority, setPriority] = useState('all');
  const [error, setError] = useState('');
  const [draggingId, setDraggingId] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);

  const projectCounts = useMemo(() => {
    const counts = {};
    for (const t of tickets) {
      if (t.project_id == null) continue;
      counts[t.project_id] = (counts[t.project_id] || 0) + 1;
    }
    return counts;
  }, [tickets]);

  /**
   * Two directions of ownership. A ticket is handed to a person either by being
   * assigned to their account or to their employee record, so "assigned to" is
   * that pair. The work "assigned by" this person is simply what they raised:
   * there is no separate assignor column, so created_by is the record of it.
   */
  const assignedToMe = useMemo(
    () =>
      tickets.filter(
        (t) =>
          t.assigned_to === currentUser.id ||
          (currentEmployeeId != null && Number(t.employee_id) === Number(currentEmployeeId))
      ),
    [tickets, currentUser.id, currentEmployeeId]
  );

  const assignedByMe = useMemo(
    () => tickets.filter((t) => t.created_by === currentUser.id),
    [tickets, currentUser.id]
  );

  // A ticket can be both created and assigned by the same person, so keep the
  // sidebar count honest by counting each item once.
  const mineCount = useMemo(
    () => new Set([...assignedToMe, ...assignedByMe].map((t) => t.id)).size,
    [assignedToMe, assignedByMe]
  );

  const applyFilters = useCallback(
    (list) => {
      const q = search.trim().toLowerCase();
      return list.filter((t) => {
        if (projectId !== 'all' && String(t.project_id) !== String(projectId)) return false;
        if (priority !== 'all' && t.priority !== priority) return false;
        if (!q) return true;
        return (
          ticketKey(t).toLowerCase().includes(q) ||
          t.title.toLowerCase().includes(q) ||
          (t.description || '').toLowerCase().includes(q) ||
          (t.project_name || '').toLowerCase().includes(q)
        );
      });
    },
    [projectId, priority, search]
  );

  const makeBuckets = useCallback(
    (list) => {
      const isDone = (t) => DONE_STATUSES.includes(t.status);

      // Overdue work floats to the top of To do, then anything dated, then
      // undated work, and priority breaks ties inside each group.
      const byDue = (a, b) => {
        if (a.due_date && b.due_date) return a.due_date < b.due_date ? -1 : 1;
        if (a.due_date) return -1;
        if (b.due_date) return 1;
        return rank(a.priority) - rank(b.priority);
      };

      const dueToday = [];
      const todo = [];
      const completed = [];

      for (const t of list) {
        if (isDone(t)) {
          completed.push(t);
        } else if (t.due_date === today) {
          dueToday.push(t);
        } else {
          todo.push(t);
        }
      }

      dueToday.sort(byDue);
      todo.sort(byDue);
      completed.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));

      return { today: dueToday, todo, completed };
    },
    [today]
  );

  const toMeBuckets = useMemo(
    () => makeBuckets(applyFilters(assignedToMe)),
    [makeBuckets, applyFilters, assignedToMe]
  );
  const byMeBuckets = useMemo(
    () => makeBuckets(applyFilters(assignedByMe)),
    [makeBuckets, applyFilters, assignedByMe]
  );

  const ordered = useMemo(
    () => [
      ...toMeBuckets.today,
      ...toMeBuckets.todo,
      ...toMeBuckets.completed,
      ...byMeBuckets.today,
      ...byMeBuckets.todo,
      ...byMeBuckets.completed,
    ],
    [toMeBuckets, byMeBuckets]
  );

  const modal = useTicketModal({ visible: ordered, lookup: tickets });

  const applyTicketUpdate = useCallback((next) => {
    if (!next) return;
    setTickets((ts) => ts.map((t) => (t.id === next.id ? { ...t, ...next } : t)));
  }, []);

  function openTicket(id) {
    const found = tickets.find((t) => t.id === id);
    if (found) modal.select(found);
  }

  async function updateStatus(id, status) {
    await patchTicket(id, { status });
  }

  async function patchTicket(id, fields) {
    setError('');
    const previous = tickets;
    setTickets((ts) => ts.map((t) => (t.id === id ? { ...t, ...fields } : t)));

    try {
      const res = await fetch(`/api/tickets/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Update failed.');
      if (data.ticket) {
        setTickets((ts) => ts.map((t) => (t.id === id ? data.ticket : t)));
      }
    } catch (e) {
      setTickets(previous);
      setError(e.message);
    }
  }

  /**
   * The columns are buckets rather than plain statuses, so a drop has to change
   * whichever field decides that bucket: the due date for Today and To do, the
   * status for Completed. Reopening is forced when a finished task is dropped
   * back into open work, since a resolved task can never be due today.
   */
  function fieldsForSection(sectionId, ticket) {
    const done = DONE_STATUSES.includes(ticket.status);

    if (sectionId === 'completed') {
      return { status: 'resolved' };
    }
    if (sectionId === 'today') {
      return {
        status: done ? 'open' : ticket.status,
        due_date: today,
      };
    }
    return {
      status: done ? 'open' : ticket.status,
      due_date: ticket.due_date === today ? null : ticket.due_date,
    };
  }

  function handleDrop(groupKey, sectionId, droppedId) {
    // The id travels on the drag payload rather than only in state, so the drop
    // cannot land before React has committed the dragstart update.
    const id = droppedId ?? draggingId;
    setDraggingId(null);
    setDropTarget(null);
    if (id == null) return;

    const ticket = tickets.find((t) => t.id === id);
    if (!ticket) return;
    const buckets = groupKey === 'by' ? byMeBuckets : toMeBuckets;
    if (buckets[sectionId].some((t) => t.id === id)) return;

    const fields = fieldsForSection(sectionId, ticket);
    if (Object.keys(fields).every((k) => ticket[k] === fields[k])) return;
    patchTicket(id, fields);
  }

  const openCount = toMeBuckets.today.length + toMeBuckets.todo.length;
  const hasMine = assignedToMe.length + assignedByMe.length > 0;

  // The three status buckets make up one column set per ownership group, so the
  // same columns render twice (assigned to me, assigned by me). Tracks each
  // group's columns separately so a drop highlights only its own target.
  function renderDashSections(groupKey, buckets) {
    return (
      <div className="dash-sections">
        {SECTIONS.map((section) => {
          const Icon = SECTION_ICONS[section.id];
          const list = buckets[section.id];
          const target = `${groupKey}/${section.id}`;
          const isTarget = dropTarget === target;

          return (
            <section
              key={target}
              className={`dash-section${isTarget ? ' droppable' : ''}`}
              aria-label={section.title}
              onDragOver={(e) => {
                // A drop is only accepted if dragover was cancelled, and that
                // must not depend on state having committed since dragstart.
                e.preventDefault();
                if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
                if (draggingId != null && dropTarget !== target) {
                  setDropTarget(target);
                }
              }}
              onDragLeave={(e) => {
                // Ignore the dragleave that fires when moving between the
                // section's own children.
                if (e.currentTarget.contains(e.relatedTarget)) return;
                setDropTarget((t) => (t === target ? null : t));
              }}
              onDrop={(e) => {
                e.preventDefault();
                const raw = e.dataTransfer?.getData('text/plain');
                handleDrop(groupKey, section.id, raw ? Number(raw) : null);
              }}
            >
              <header className="dash-section-head">
                <span className="dash-section-title">
                  <Icon />
                  {section.title}
                </span>
                <span className="dash-section-hint">{section.hint}</span>
                <span className="dash-section-count">{list.length}</span>
              </header>

              <div className="dash-list">
                {list.length === 0 ? (
                  <p className="dash-section-empty">
                    {section.id === 'today'
                      ? 'Nothing is due today.'
                      : section.id === 'todo'
                        ? 'No open tasks.'
                        : 'Nothing completed yet.'}
                  </p>
                ) : (
                  list.map((t) => (
                    <TicketCard
                      key={t.id}
                      ticket={t}
                      canUpdate
                      employees={employees}
                      canReassign={false}
                      onDragStart={(id, e) => {
                        if (e?.dataTransfer) {
                          e.dataTransfer.effectAllowed = 'move';
                          e.dataTransfer.setData('text/plain', String(id));
                        }
                        setDraggingId(id);
                      }}
                      onDragEnd={() => {
                        setDraggingId(null);
                        setDropTarget(null);
                      }}
                      onUpdate={updateStatus}
                      onOpen={openTicket}
                      isDragging={draggingId === t.id}
                      isActive={modal.selected?.id === t.id}
                    />
                  ))
                )}
              </div>
            </section>
          );
        })}
      </div>
    );
  }

  return (
    <AppShell
      currentUser={currentUser}
      projects={projects}
      projectCounts={projectCounts}
      employeeCount={employees.filter((e) => e.active).length}
      myIssuesCount={mineCount}
      view="dashboard"
      projectId={projectId}
      onProjectChange={setProjectId}
    >
      <div className="dash">
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
              <Link href="/">Projects</Link>
              <span className="breadcrumb-sep" aria-hidden="true">
                /
              </span>
              <span>My work</span>
            </nav>
            <div className="toolbar-title-row">
              <h1>Good day, {firstName(currentUser.name)}</h1>
            </div>
            <p className="board-subtitle">
              {hasMine
                ? `${assignedToMe.length} ${
                    assignedToMe.length === 1 ? 'task' : 'tasks'
                  } assigned to you · ${openCount} open · ${assignedByMe.length} raised by you`
                : 'No tasks assigned to you yet'}
            </p>
          </div>

          <div className="toolbar-actions">
            <div className="search-field">
              <SearchIcon />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search my tasks…"
                aria-label="Search my tasks"
              />
            </div>

            <div className="select-field">
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                aria-label="Filter by project"
              >
                <option value="all">All projects</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="select-field">
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                aria-label="Filter by priority"
              >
                <option value="all">All priorities</option>
                {PRIORITY_ORDER.map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_META[p].label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {!hasMine && (
          <div className="dash-empty">
            <h2>Nothing assigned yet</h2>
            <p>
              When an admin creates a task for you it will appear here, split
              into what is due today, what is still to do, and what you have
              finished.
            </p>
          </div>
        )}

        <div className="dash-groups">
          <section className="dash-group" aria-label="Assigned to me">
            <header className="dash-group-head">
              <h2 className="dash-group-title">Assigned to me</h2>
              <span className="dash-group-hint">Work handed to you</span>
              <span className="dash-group-count">{assignedToMe.length}</span>
            </header>
            {renderDashSections('to', toMeBuckets)}
          </section>

          <section className="dash-group" aria-label="Assigned by me">
            <header className="dash-group-head">
              <h2 className="dash-group-title">Assigned by me</h2>
              <span className="dash-group-hint">Tickets you raised</span>
              <span className="dash-group-count">{assignedByMe.length}</span>
            </header>
            {renderDashSections('by', byMeBuckets)}
          </section>
        </div>
      </div>

      {modal.selected && (
        <TicketDetailModal
          ticket={modal.selected}
          employees={employees}
          currentUser={currentUser}
          siblingTickets={ordered}
          canStep={modal.canStep}
          onClose={modal.close}
          onNext={modal.next}
          onPrev={modal.prev}
          onTicketChanged={applyTicketUpdate}
          onArchiveChange={(change) => setTickets((current) => mergeArchiveChange(current, change, 'active'))}
          onOpenTicket={openTicket}
        />
      )}
    </AppShell>
  );
}

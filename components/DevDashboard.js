'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import AppShell from './AppShell';
import TicketCard from './TicketCard';
import TicketDetailModal from './ticket/TicketDetailModal';
import CreateTicketModal from './CreateTicketModal';
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
  // Each ownership group has its own project filter so "Assigned to me" and
  // "Assigned by me" can be narrowed independently. "all" is the default and
  // keeps the previous behavior (every project) untouched.
  const [toMeProjectId, setToMeProjectId] = useState('all');
  const [byMeProjectId, setByMeProjectId] = useState('all');
  const [groupTab, setGroupTab] = useState('to');
  const [priority, setPriority] = useState('all');
  const [error, setError] = useState('');
  const [draggingId, setDraggingId] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const [showCreate, setShowCreate] = useState(false);

  const projectCounts = useMemo(() => {
    const counts = {};
    for (const t of tickets) {
      if (t.project_id == null) continue;
      counts[t.project_id] = (counts[t.project_id] || 0) + 1;
    }
    return counts;
  }, [tickets]);

  /**
   * Two directions of ownership. For a developer both are scoped to that one
   * person: a ticket is handed to them by being assigned to their account or to
   * their employee record, and the work they raised is whatever they created.
   *
   * An admin supervises the whole admin group, so the same two directions are
   * widened to every admin account instead of just the signed-in one. The admin
   * accounts are read off the employee roster, which carries each employee's
   * role and the linked account id.
   */
  const isAdmin = currentUser.role === 'admin';

  const adminUserIds = useMemo(() => {
    if (!isAdmin) return null;
    const ids = new Set([Number(currentUser.id)]);
    for (const e of employees) {
      if (e.role === 'admin' && e.user_id != null) ids.add(Number(e.user_id));
    }
    return ids;
  }, [isAdmin, employees, currentUser.id]);

  const adminEmployeeIds = useMemo(() => {
    if (!isAdmin) return null;
    const ids = new Set();
    for (const e of employees) {
      if (e.role === 'admin') ids.add(Number(e.id));
    }
    if (currentEmployeeId != null) ids.add(Number(currentEmployeeId));
    return ids;
  }, [isAdmin, employees, currentEmployeeId]);

  const assignedToMe = useMemo(
    () =>
      tickets.filter((t) =>
        isAdmin
          ? (t.assigned_to != null && adminUserIds.has(Number(t.assigned_to))) ||
            (t.employee_id != null && adminEmployeeIds.has(Number(t.employee_id)))
          : t.assigned_to === currentUser.id ||
            (currentEmployeeId != null &&
              Number(t.employee_id) === Number(currentEmployeeId))
      ),
    [tickets, isAdmin, adminUserIds, adminEmployeeIds, currentUser.id, currentEmployeeId]
  );

  const assignedByMe = useMemo(
    () =>
      tickets.filter((t) =>
        isAdmin
          ? t.created_by != null && adminUserIds.has(Number(t.created_by))
          : t.created_by === currentUser.id
      ),
    [tickets, isAdmin, adminUserIds, currentUser.id]
  );

  // A ticket can be both created and assigned by the same person, so keep the
  // sidebar count honest by counting each item once.
  const mineCount = useMemo(
    () => new Set([...assignedToMe, ...assignedByMe].map((t) => t.id)).size,
    [assignedToMe, assignedByMe]
  );

  const applyFilters = useCallback(
    (list, projectFilter) => {
      const q = search.trim().toLowerCase();
      return list.filter((t) => {
        if (projectFilter !== 'all' && String(t.project_id) !== String(projectFilter)) {
          return false;
        }
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
    [priority, search]
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

  const toMeVisible = useMemo(
    () => applyFilters(assignedToMe, toMeProjectId),
    [applyFilters, assignedToMe, toMeProjectId]
  );
  const byMeVisible = useMemo(
    () => applyFilters(assignedByMe, byMeProjectId),
    [applyFilters, assignedByMe, byMeProjectId]
  );

  const toMeBuckets = useMemo(() => makeBuckets(toMeVisible), [makeBuckets, toMeVisible]);
  const byMeBuckets = useMemo(() => makeBuckets(byMeVisible), [makeBuckets, byMeVisible]);

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

  // The modal creates the ticket itself (POST /api/tickets) and hands back the
  // saved row, so it is appended straight away: the two ownership lists re-derive
  // from `tickets`, so the new card lands in the right section immediately.
  function handleCreate(created) {
    setShowCreate(false);
    if (created) setTickets((ts) => (ts.some((t) => t.id === created.id) ? ts : [created, ...ts]));
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

  // One project filter per ownership group. Rendered inside that group so the
  // two filters stay independent, with "All projects" as the no-op default.
  function renderProjectFilter(id, value, onChange, label) {
    return (
      <div className="dash-group-filter">
        <label htmlFor={id}>Project</label>
        <div className="select-field">
          <select
            id={id}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            aria-label={label}
          >
            <option value="all">All projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
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
      projectId={null}
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
              <Link href="/projects">Workspaces</Link>
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
            <button className="btn-primary" onClick={() => setShowCreate(true)}>
              <svg
                viewBox="0 0 24 24"
                width="15"
                height="15"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
              Create
            </button>

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

        <div className="dash-tabs" role="tablist" aria-label="Ticket ownership">
          <button
            type="button"
            role="tab"
            id="dash-tab-to"
            aria-selected={groupTab === 'to'}
            aria-controls="dash-panel-to"
            className={`dash-tab${groupTab === 'to' ? ' is-active' : ''}`}
            onClick={() => setGroupTab('to')}
          >
            Assigned to me
            <span className="dash-tab-count">{toMeVisible.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            id="dash-tab-by"
            aria-selected={groupTab === 'by'}
            aria-controls="dash-panel-by"
            className={`dash-tab${groupTab === 'by' ? ' is-active' : ''}`}
            onClick={() => setGroupTab('by')}
          >
            Assigned by me
            <span className="dash-tab-count">{byMeVisible.length}</span>
          </button>
        </div>

        <div className="dash-groups">
          {groupTab === 'to' ? (
            <section
              className="dash-group"
              id="dash-panel-to"
              role="tabpanel"
              aria-labelledby="dash-tab-to"
            >
              <header className="dash-group-head">
                <h2 className="dash-group-title">Assigned to me</h2>
                <span className="dash-group-hint">Work handed to you</span>
                <span className="dash-group-count">{toMeVisible.length}</span>
              </header>
              {renderProjectFilter(
                'to-me-project',
                toMeProjectId,
                setToMeProjectId,
                'Filter assigned to me by project'
              )}
              {renderDashSections('to', toMeBuckets)}
            </section>
          ) : (
            <section
              className="dash-group"
              id="dash-panel-by"
              role="tabpanel"
              aria-labelledby="dash-tab-by"
            >
              <header className="dash-group-head">
                <h2 className="dash-group-title">Assigned by me</h2>
                <span className="dash-group-hint">Tickets you raised</span>
                <span className="dash-group-count">{byMeVisible.length}</span>
              </header>
              {renderProjectFilter(
                'by-me-project',
                byMeProjectId,
                setByMeProjectId,
                'Filter assigned by me by project'
              )}
              {renderDashSections('by', byMeBuckets)}
            </section>
          )}
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

      {showCreate && (
        <CreateTicketModal
          employees={employees}
          projects={projects}
          onClose={() => setShowCreate(false)}
          onCreate={handleCreate}
        />
      )}
    </AppShell>
  );
}

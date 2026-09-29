'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import TicketCard from './TicketCard';
import CreateTicketModal from './CreateTicketModal';
import ProjectModal from './ProjectModal';
import AppShell from './AppShell';
import Avatar from './Avatar';
import ProjectTabs from './ProjectTabs';
import {
  STATUS_META,
  STATUS_ORDER,
  PRIORITY_META,
  PRIORITY_ORDER,
} from './meta';

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

function ChevronIcon() {
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
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export default function Board({
  initialTickets,
  initialProjects,
  initialEmployees,
  currentUser,
}) {
  const [tickets, setTickets] = useState(initialTickets);
  const [projects, setProjects] = useState(initialProjects);
  const [employees, setEmployees] = useState(initialEmployees);
  const [projectId, setProjectId] = useState('all');
  const [showModal, setShowModal] = useState(false);
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [editingProject, setEditingProject] = useState(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');
  const [priority, setPriority] = useState('all');
  const [search, setSearch] = useState('');
  const [draggingId, setDraggingId] = useState(null);

  const isAdmin = currentUser.role === 'admin';
  // Any signed-in user can move a ticket. Only reassignment and creation stay admin-only.
  const canMove = true;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const initialProject = params.get('project');
    const initialFilter = params.get('filter');
    if (initialProject && initialProject !== 'all') setProjectId(initialProject);
    if (initialFilter === 'mine') setFilter('mine');
  }, []);

  const handleProjectChange = useCallback((next) => {
    setProjectId(String(next));
    const url = next === 'all' ? window.location.pathname : `?project=${next}`;
    window.history.replaceState(null, '', url);
  }, []);

  function matchesFilter(t) {
    if (filter === 'all') return true;
    return (
      t.created_by === currentUser.id ||
      t.assigned_to === currentUser.id ||
      (currentUser.employee_id != null && t.employee_id === currentUser.employee_id)
    );
  }

  function matchesProject(t) {
    if (projectId === 'all') return true;
    return String(t.project_id) === String(projectId);
  }

  function matchesSearch(t) {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      String(t.id).includes(q) ||
      t.title.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q) ||
      (t.project_name || '').toLowerCase().includes(q) ||
      (t.employee_name || '').toLowerCase().includes(q)
    );
  }

  const visible = useMemo(
    () =>
      tickets.filter(
        (t) =>
          matchesFilter(t) &&
          matchesProject(t) &&
          matchesSearch(t) &&
          (priority === 'all' || t.priority === priority)
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tickets, filter, priority, search, projectId]
  );

  const myIssuesCount = useMemo(
    () =>
      tickets.filter(
        (t) =>
          t.created_by === currentUser.id ||
          t.assigned_to === currentUser.id ||
          (currentUser.employee_id != null &&
            t.employee_id === currentUser.employee_id)
      ).length,
    [tickets, currentUser.id, currentUser.employee_id]
  );

  const projectCounts = useMemo(() => {
    const counts = {};
    for (const t of tickets) {
      if (t.project_id == null) continue;
      counts[t.project_id] = (counts[t.project_id] || 0) + 1;
    }
    return counts;
  }, [tickets]);

  const activeProject = useMemo(
    () => projects.find((p) => String(p.id) === String(projectId)) || null,
    [projects, projectId]
  );

  async function updateStatus(id, status) {
    setError('');
    const previous = tickets;
    setTickets((ts) => ts.map((t) => (t.id === id ? { ...t, status } : t)));

    try {
      const res = await fetch(`/api/tickets/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Update failed.');
      setTickets((ts) => ts.map((t) => (t.id === id ? { ...t, status } : t)));
    } catch (e) {
      setTickets(previous);
      setError(e.message);
    }
  }

  function handleDrop(targetStatus) {
    if (draggingId == null) return;
    updateStatus(draggingId, targetStatus);
    setDraggingId(null);
  }

  async function handleReassign(id, employeeId) {
    setError('');
    const previous = tickets;

    setTickets((ts) =>
      ts.map((t) => {
        if (t.id !== id) return t;
        const employee = employees.find((e) => e.id === Number(employeeId));
        return {
          ...t,
          employee_id: employee ? employee.id : null,
          employee_name: employee?.name || null,
          employee_email: employee?.email || null,
        };
      })
    );

    try {
      const res = await fetch(`/api/tickets/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_id: employeeId ? Number(employeeId) : null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Reassignment failed.');
      if (data.ticket) {
        setTickets((ts) => ts.map((t) => (t.id === id ? data.ticket : t)));
      }
    } catch (e) {
      setTickets(previous);
      setError(e.message);
    }
  }

  async function refresh() {
    const [ticketsRes, projectsRes, employeesRes] = await Promise.all([
      fetch('/api/tickets'),
      fetch('/api/projects'),
      fetch('/api/employees'),
    ]);
    const ticketsData = await ticketsRes.json();
    const projectsData = await projectsRes.json();
    const employeesData = await employeesRes.json();
    if (ticketsRes.ok) setTickets(ticketsData.tickets);
    if (projectsRes.ok) setProjects(projectsData.projects);
    if (employeesRes.ok) setEmployees(employeesData.employees);
  }

  async function handleCreate() {
    setShowModal(false);
    await refresh();
  }

  async function handleProjectSave() {
    setShowProjectModal(false);
    setEditingProject(null);
    await refresh();
  }

  const total = visible.length;

  return (
    <AppShell
      currentUser={currentUser}
      projects={projects}
      projectCounts={projectCounts}
      employeeCount={employees.filter((e) => e.active).length}
      myIssuesCount={myIssuesCount}
      view="board"
      filter={filter}
      onFilterChange={setFilter}
      projectId={projectId}
      onProjectChange={handleProjectChange}
      onCreate={isAdmin ? () => setShowModal(true) : null}
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
              <Link href="/">Projects</Link>
              {activeProject && (
                <>
                  <span className="breadcrumb-sep" aria-hidden="true">
                    /
                  </span>
                  <span>{activeProject.name}</span>
                </>
              )}
              {!activeProject && (
                <>
                  <span className="breadcrumb-sep" aria-hidden="true">
                    /
                  </span>
                  <span>All issues</span>
                </>
              )}
            </nav>
            <div className="toolbar-title-row">
              {activeProject && (
                <span
                  className="project-dot project-dot-lg"
                  style={{ background: activeProject.color }}
                  aria-hidden="true"
                />
              )}
              <h1>{activeProject ? activeProject.name : 'Board'}</h1>
            </div>
            <p className="board-subtitle">
              {activeProject && (
                <button
                  type="button"
                  className="link-button"
                  onClick={() => handleProjectChange('all')}
                >
                  All issues
                </button>
              )}
              {activeProject && ' · '}
              {filter === 'mine' ? 'My tickets' : 'All tickets'} · {total}{' '}
              {total === 1 ? 'ticket' : 'tickets'}
            </p>
          </div>

          <div className="toolbar-actions">
            {canMove && <span className="drag-hint">Drag between columns</span>}

            {!isAdmin && (
              <span
                className="drag-hint"
                title="Creating issues and reassigning tickets are limited to admins"
              >
                Creating and reassigning is admin-only
              </span>
            )}

            <div className="search-field">
              <SearchIcon />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search tickets…"
                aria-label="Search tickets"
              />
            </div>

            <div className="select-field">
              <select
                value={projectId}
                onChange={(e) => handleProjectChange(e.target.value)}
                aria-label="Filter by project"
              >
                <option value="all">All projects</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <ChevronIcon />
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
              <ChevronIcon />
            </div>

            {isAdmin && (
              <button
                className="btn-secondary"
                onClick={() => {
                  setEditingProject(null);
                  setShowProjectModal(true);
                }}
              >
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
                New project
              </button>
            )}

            {isAdmin && (
              <button className="btn-primary" onClick={() => setShowModal(true)}>
                <svg
                  viewBox="0 0 24 24"
                  width="15"
                  height="15"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                >
                  <path d="M12 5v14M5 12h14" />
                </svg>
                New ticket
              </button>
            )}
          </div>
        </div>

        {activeProject && <ProjectTabs projectId={activeProject.id} active="board" />}

        <div className="board-columns">
          {STATUS_ORDER.map((status) => {
            const meta = STATUS_META[status];
            const columnTickets = visible.filter((t) => t.status === status);
            const droppable = canMove && draggingId != null;

            return (
              <div
                key={status}
                className={`column${droppable ? ' droppable' : ''}`}
                onDragOver={(e) => canMove && e.preventDefault()}
                onDrop={(e) => {
                  if (canMove) {
                    e.preventDefault();
                    handleDrop(status);
                  }
                }}
              >
                <div className="column-head">
                  <span className="column-name">{meta.label}</span>
                  <span className="column-count">{columnTickets.length}</span>
                </div>

                <div className="column-body">
                  {columnTickets.length === 0 ? (
                    <div className="column-empty">
                      {droppable ? 'Drop here' : 'No tickets in this column'}
                    </div>
                  ) : (
                    columnTickets.map((t) => (
                      <TicketCard
                        key={t.id}
                        ticket={t}
                        canUpdate={canMove}
                        employees={employees}
                        canReassign={isAdmin}
                        onDragStart={setDraggingId}
                        onDragEnd={() => setDraggingId(null)}
                        onUpdate={updateStatus}
                        onReassign={handleReassign}
                        isDragging={draggingId === t.id}
                      />
                    ))
                  )}
                </div>

                {isAdmin && (
                  <button
                    className="column-create"
                    onClick={() => setShowModal(true)}
                  >
                    <span aria-hidden="true">+</span>
                    Create issue
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {showModal && (
        <CreateTicketModal
          employees={employees}
          projects={projects}
          defaultProjectId={activeProject ? activeProject.id : ''}
          onClose={() => setShowModal(false)}
          onCreate={handleCreate}
        />
      )}

      {showProjectModal && (
        <ProjectModal
          project={editingProject}
          onClose={() => setShowProjectModal(false)}
          onSave={handleProjectSave}
        />
      )}
    </AppShell>
  );
}

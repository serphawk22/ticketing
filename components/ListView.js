'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AppShell from './AppShell';
import Avatar from './Avatar';
import ProjectTabs from './ProjectTabs';
import CreateTicketModal from './CreateTicketModal';
import { TicketDetailModal } from './TicketCard';
import {
  STATUS_META,
  STATUS_ORDER,
  PRIORITY_META,
  PRIORITY_ORDER,
  TYPE_META,
  TYPE_ORDER,
  PriorityIcon,
  TypeIcon,
  formatListDateTime,
  ticketKey,
} from './meta';

const GROUPS = [
  { key: 'none', label: 'None' },
  { key: 'status', label: 'Status' },
  { key: 'assignee', label: 'Assignee' },
  { key: 'priority', label: 'Priority' },
];

const PAGE_SIZE = 25;

const COLUMNS = [
  { key: 'work', label: 'Work', always: true },
  { key: 'assignee', label: 'Assignee', always: true },
  { key: 'reporter', label: 'Reporter' },
  { key: 'priority', label: 'Priority' },
  { key: 'status', label: 'Status', always: true },
  { key: 'resolution', label: 'Resolution' },
  { key: 'created', label: 'Created' },
];

const DEFAULT_HIDDEN = ['reporter', 'resolution'];

// Jira tints the status lozenge by outcome, not by the board column colour:
// open work sits grey/blue and finished work sits green.
const LOZENGE = {
  open: { bg: '#DEEBFF', text: '#0C66E4' },
  in_progress: { bg: '#DEEBFF', text: '#0C66E4' },
  resolved: { bg: '#E3FCEF', text: '#216E4E' },
  closed: { bg: '#E3FCEF', text: '#216E4E' },
};

const PRIORITY_RANK = Object.fromEntries(PRIORITY_ORDER.map((p, i) => [p, i]));

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.35-4.35" />
    </svg>
  );
}

function FunnelIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 5h18l-7 8v6l-4 2v-8L3 5Z" />
    </svg>
  );
}

function LayersIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m12 2 9 5-9 5-9-5 9-5Z" />
      <path d="m3 12 9 5 9-5" />
      <path d="m3 17 9 5 9-5" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function CaretIcon({ open }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{
        transform: open ? 'rotate(90deg)' : 'none',
        transition: 'transform var(--t-fast)',
      }}
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

function SortArrow({ dir }) {
  if (!dir) return null;
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true" style={{ opacity: 0.8 }}>
      <path d={dir === 'asc' ? 'M12 6l6 8H6l6-8Z' : 'M12 18l-6-8h12l-6 8Z'} />
    </svg>
  );
}

function ColumnsIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16M15 4v16" />
    </svg>
  );
}

function MenuCheck() {
  return (
    <span className="menu-check" aria-hidden="true">
      ✓
    </span>
  );
}

function isDone(t) {
  return t.status === 'resolved' || t.status === 'closed';
}

function EmptyState({ hasAny, filtered, onReset }) {
  return (
    <div className="list-empty">
      <svg viewBox="0 0 64 48" width="64" height="48" aria-hidden="true">
        <rect x="6" y="10" width="52" height="30" rx="4" fill="#F4F5F7" />
        <rect x="12" y="17" width="24" height="4" rx="2" fill="#DFE1E6" />
        <rect x="12" y="25" width="34" height="4" rx="2" fill="#EBECF0" />
        <circle cx="46" cy="34" r="11" fill="#E9F2FF" />
        <path d="M46 28v12M40 34h12" stroke="#0C66E4" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
      <p className="list-empty-title">
        {hasAny ? 'No work matches these filters' : 'No work items yet'}
      </p>
      <p className="list-empty-text">
        {hasAny
          ? 'Try clearing the search box or the active filters.'
          : 'Create a ticket to start tracking work in this project.'}
      </p>
      {filtered && (
        <button type="button" className="btn-secondary" onClick={onReset}>
          Clear filters
        </button>
      )}
    </div>
  );
}

export default function ListView({
  initialTickets,
  project,
  projects,
  employees = [],
  projectCounts,
  myIssuesCount,
  currentUser,
}) {
  const [tickets, setTickets] = useState(initialTickets);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({ assignee: 'all', priority: 'all', status: 'all', type: 'all' });
  const [group, setGroup] = useState('none');
  const [sort, setSort] = useState({ key: 'created', dir: 'desc' });
  const [hidden, setHidden] = useState(() => new Set(DEFAULT_HIDDEN));
  const [selected, setSelected] = useState(() => new Set());
  const [openTicket, setOpenTicket] = useState(null);
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [openMenu, setOpen] = useState(null);
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState('');

  const rootRef = useRef(null);
  const projectId = project.id;
  const isAdmin = currentUser.role === 'admin';
  // Moving a ticket is open to any signed-in user, matching the board.
  const canUpdate = true;

  const visibleColumns = useMemo(
    () => COLUMNS.filter((c) => c.always || !hidden.has(c.key)),
    [hidden]
  );

  useEffect(() => {
    function onDocClick(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(null);
    }
    function onKey(e) {
      if (e.key === 'Escape') setOpen(null);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  const people = useMemo(() => {
    const byId = new Map();
    for (const t of tickets) {
      if (t.employee_id == null) continue;
      if (!byId.has(t.employee_id)) {
        byId.set(t.employee_id, { id: t.employee_id, name: t.employee_name, count: 0 });
      }
      byId.get(t.employee_id).count += 1;
    }
    return [...byId.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [tickets]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tickets.filter((t) => {
      if (filters.assignee !== 'all') {
        const key = t.employee_id == null ? 'unassigned' : String(t.employee_id);
        if (key !== filters.assignee) return false;
      }
      if (filters.priority !== 'all' && t.priority !== filters.priority) return false;
      if (filters.status !== 'all' && t.status !== filters.status) return false;
      if (filters.type !== 'all' && (t.type || 'task') !== filters.type) return false;
      if (!q) return true;
      return (
        t.title.toLowerCase().includes(q) ||
        ticketKey(t).toLowerCase().includes(q) ||
        (t.description || '').toLowerCase().includes(q)
      );
    });
  }, [tickets, search, filters]);

  const sorted = useMemo(() => {
    const dir = sort.dir === 'asc' ? 1 : -1;
    const value = (t) => {
      switch (sort.key) {
        case 'work':
          return t.title.toLowerCase();
        case 'assignee':
          return (t.employee_name || '￿').toLowerCase();
        case 'reporter':
          return (t.created_by_name || '￿').toLowerCase();
        case 'priority':
          return PRIORITY_RANK[t.priority] ?? 99;
        case 'status':
          return STATUS_ORDER.indexOf(t.status);
        case 'resolution':
          return isDone(t) ? 1 : 0;
        case 'created':
          return String(t.created_at || '');
        default:
          return t.id;
      }
    };
    return [...filtered].sort((a, b) => {
      const av = value(a);
      const bv = value(b);
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return a.id - b.id;
    });
  }, [filtered, sort]);

  const groups = useMemo(() => {
    if (group === 'none') return null;
    const buckets = new Map();
    for (const t of sorted) {
      let label;
      if (group === 'status') label = STATUS_META[t.status].label;
      else if (group === 'priority') label = PRIORITY_META[t.priority].label;
      else if (group === 'assignee') label = t.employee_name || 'Unassigned';
      else label = 'All work';

      if (!buckets.has(label)) buckets.set(label, []);
      buckets.get(label).push(t);
    }
    return [...buckets.entries()].map(([label, rows]) => ({ label, rows }));
  }, [sorted, group]);

  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);

  // Ungrouped paginates rows. Grouped paginates whole groups, so the count in a
  // section header ("In Progress (3)") always reflects the full group rather
  // than whatever slice of it happens to land on the page.
  const paged = groups
    ? groups.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
    : sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  // Any change to the inputs invalidates the current page number.
  useEffect(() => {
    setPage(1);
  }, [search, filters, group, sort]);

  const pageRows = groups ? paged.flatMap((g) => g.rows) : paged;
  const pageIds = pageRows.map((t) => t.id);
  const allOnPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const someOnPageSelected = pageIds.some((id) => selected.has(id));

  const hasActiveFilters =
    filters.assignee !== 'all' ||
    filters.priority !== 'all' ||
    filters.status !== 'all' ||
    filters.type !== 'all' ||
    search.trim() !== '';

  function clearFilters() {
    setSearch('');
    setFilters({ assignee: 'all', priority: 'all', status: 'all', type: 'all' });
  }

  function toggleSort(key) {
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'created' || key === 'work' ? 'asc' : 'asc' }
    );
  }

  function toggleSelect(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectPage() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  }

  function toggleGroup(label) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  function toggleColumn(key) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function pickAssignee(id) {
    setFilters((f) => ({ ...f, assignee: id == null ? 'all' : String(id) }));
    setOpen(null);
  }

  async function updateStatus(id, status) {
    const previous = tickets;
    setError('');
    setTickets((ts) => ts.map((t) => (t.id === id ? { ...t, status } : t)));

    try {
      const res = await fetch(`/api/tickets/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
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

  async function handleReassign(id, employeeId) {
    const previous = tickets;
    setError('');

    setTickets((ts) =>
      ts.map((t) => {
        if (t.id !== id) return t;
        const employee = employees.find((e) => e.id === Number(employeeId));
        return {
          ...t,
          employee_id: employee ? employee.id : null,
          employee_name: employee?.name || null,
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

  const detailTicket = openTicket ? tickets.find((t) => t.id === openTicket) : null;

  function renderRow(t) {
    const priority = PRIORITY_META[t.priority];
    const done = isDone(t);
    const lozenge = LOZENGE[t.status] || LOZENGE.open;
    const isSelected = selected.has(t.id);

    return (
      <tr
        key={t.id}
        className={`list-row${isSelected ? ' is-selected' : ''}`}
        aria-selected={isSelected}
      >
        <td className="list-cell list-cell-check">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => toggleSelect(t.id)}
            aria-label={`Select ${ticketKey(t)}`}
          />
        </td>

        <td className="list-cell list-cell-expand">
          <span className="list-expand-slot" aria-hidden="true" />
        </td>

        <td className="list-cell list-cell-work">
          <span className="list-work">
            <span className="card-type-icon is-plain" title={(TYPE_META[t.type] || TYPE_META.task).label}>
              <TypeIcon type={t.type} size={12} />
            </span>
            <button type="button" className={`list-key${done ? ' is-done' : ''}`} onClick={() => setOpenTicket(t.id)}>
              {ticketKey(t)}
            </button>
            <button type="button" className={`list-title${done ? ' is-done' : ''}`} onClick={() => setOpenTicket(t.id)}>
              {t.title}
            </button>
          </span>
        </td>

        {visibleColumns.some((c) => c.key === 'assignee') && (
          <td className="list-cell list-cell-assignee">
            <span className="list-person">
              <Avatar name={t.employee_name} assigned={Boolean(t.employee_id)} size={24} unassignedIcon />
              <span className={t.employee_id ? 'list-person-name' : 'list-person-name is-empty'}>
                {t.employee_name || 'Unassigned'}
              </span>
            </span>
          </td>
        )}

        {visibleColumns.some((c) => c.key === 'reporter') && (
          <td className="list-cell">
            <span className="list-person">
              <Avatar name={t.created_by_name} assigned size={24} />
              <span className="list-person-name">{t.created_by_name}</span>
            </span>
          </td>
        )}

        {visibleColumns.some((c) => c.key === 'priority') && (
          <td className="list-cell">
            <span className="list-priority">
              <PriorityIcon color={priority.color} arrow={priority.arrow} />
              <span>{priority.label}</span>
            </span>
          </td>
        )}

        {visibleColumns.some((c) => c.key === 'status') && (
          <td className="list-cell">
            <span className="list-status-wrap">
              <span className="list-lozenge" style={{ background: lozenge.bg, color: lozenge.text }}>
                {STATUS_META[t.status].label}
              </span>
              {canUpdate ? (
                <span className="list-status-select">
                  <select
                    value={t.status}
                    onChange={(e) => updateStatus(t.id, e.target.value)}
                    aria-label={`Change status of ${ticketKey(t)}`}
                  >
                    {STATUS_ORDER.map((s) => (
                      <option key={s} value={s}>
                        {STATUS_META[s].label}
                      </option>
                    ))}
                  </select>
                  <ChevronIcon />
                </span>
              ) : (
                <ChevronIcon />
              )}
            </span>
          </td>
        )}

        {visibleColumns.some((c) => c.key === 'resolution') && (
          <td className="list-cell list-cell-muted">{done ? 'Done' : 'Unresolved'}</td>
        )}

        {visibleColumns.some((c) => c.key === 'created') && (
          <td className="list-cell list-cell-muted list-cell-date">
            {formatListDateTime(t.created_at)}
          </td>
        )}

        <td className="list-cell list-cell-more">
          <button type="button" className="list-row-more" onClick={() => setOpenTicket(t.id)} aria-label={`More actions for ${ticketKey(t)}`}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
              <circle cx="5" cy="12" r="1.8" />
              <circle cx="12" cy="12" r="1.8" />
              <circle cx="19" cy="12" r="1.8" />
            </svg>
          </button>
        </td>
      </tr>
    );
  }

  return (
    <AppShell
      currentUser={currentUser}
      projects={projects}
      projectCounts={projectCounts}
      myIssuesCount={myIssuesCount}
      view="summary"
      filter="all"
      onFilterChange={() => {}}
      projectId={String(projectId)}
      onProjectChange={(id) => router.push(`/projects/${id}/list`)}
      onCreate={isAdmin ? () => setShowCreate(true) : undefined}
    >
      <div className="board" ref={rootRef}>
        {error && (
          <div className="error-banner">
            <strong>Error:</strong> {error}
            <button type="button" onClick={() => setError('')}>Dismiss</button>
          </div>
        )}

        <div className="board-toolbar">
          <div className="toolbar-title">
            <nav className="breadcrumb" aria-label="Breadcrumb">
              <Link href="/projects">Projects</Link>
              <span className="breadcrumb-sep" aria-hidden="true">/</span>
              <span>{project.name}</span>
            </nav>
            <div className="toolbar-title-row">
              <span
                className="project-icon project-icon-sm"
                style={{ background: project.color }}
                aria-hidden="true"
              >
                {project.name.charAt(0).toUpperCase()}
              </span>
              <h1>{project.name}</h1>
            </div>
            {project.description && <p className="board-subtitle">{project.description}</p>}
          </div>
        </div>

        <ProjectTabs projectId={projectId} active="list" />

        <div className="list-toolbar">
          <div className="search-field list-search">
            <SearchIcon />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search work"
              aria-label="Search work by title or key"
            />
          </div>

          <div className="list-people" aria-label="Filter by assignee">
            {people.map((p) => {
              const active = filters.assignee === String(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  className={`list-person-btn${active ? ' is-active' : ''}`}
                  onClick={() => pickAssignee(active ? null : p.id)}
                  title={`${p.name} — ${p.count}`}
                  aria-pressed={active}
                >
                  <Avatar name={p.name} assigned size={24} showTitle={false} />
                </button>
              );
            })}
          </div>

          <div className="list-menu-wrap">
            <button
              type="button"
              className={`filter-btn${filters.status !== 'all' || filters.priority !== 'all' || filters.type !== 'all' || filters.assignee !== 'all' ? ' active' : ''}`}
              aria-expanded={openMenu === 'filter'}
              aria-haspopup="true"
              onClick={() => setOpen(openMenu === 'filter' ? null : 'filter')}
            >
              <FunnelIcon />
              <span>Filter</span>
            </button>

            {openMenu === 'filter' && (
              <div className="menu-popup list-menu" role="menu">
                <p className="list-menu-label">Assignee</p>
                <button type="button" className="menu-item" role="menuitemradio" aria-checked={filters.assignee === 'all'} onClick={() => pickAssignee(null)}>
                  <Avatar name="Unassigned" assigned={false} size={20} unassignedIcon showTitle={false} />
                  <span className="menu-item-text">Everyone</span>
                  {filters.assignee === 'all' && <MenuCheck />}
                </button>
                {people.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="menu-item"
                    role="menuitemradio"
                    aria-checked={filters.assignee === String(p.id)}
                    onClick={() => pickAssignee(p.id)}
                  >
                    <Avatar name={p.name} assigned size={20} showTitle={false} />
                    <span className="menu-item-text">{p.name}</span>
                    <span className="menu-count">{p.count}</span>
                    {filters.assignee === String(p.id) && <MenuCheck />}
                  </button>
                ))}

                <p className="list-menu-label">Status</p>
                <button type="button" className="menu-item" role="menuitemradio" aria-checked={filters.status === 'all'} onClick={() => setFilters((f) => ({ ...f, status: 'all' }))}>
                  <span className="menu-item-text">Any status</span>
                  {filters.status === 'all' && <MenuCheck />}
                </button>
                {STATUS_ORDER.map((s) => (
                  <button key={s} type="button" className="menu-item" role="menuitemradio" aria-checked={filters.status === s} onClick={() => setFilters((f) => ({ ...f, status: s }))}>
                    <span className="list-menu-dot" style={{ background: STATUS_META[s].color }} />
                    <span className="menu-item-text">{STATUS_META[s].label}</span>
                    {filters.status === s && <MenuCheck />}
                  </button>
                ))}

                <p className="list-menu-label">Priority</p>
                <button type="button" className="menu-item" role="menuitemradio" aria-checked={filters.priority === 'all'} onClick={() => setFilters((f) => ({ ...f, priority: 'all' }))}>
                  <span className="menu-item-text">Any priority</span>
                  {filters.priority === 'all' && <MenuCheck />}
                </button>
                {PRIORITY_ORDER.map((p) => (
                  <button key={p} type="button" className="menu-item" role="menuitemradio" aria-checked={filters.priority === p} onClick={() => setFilters((f) => ({ ...f, priority: p }))}>
                    <PriorityIcon color={PRIORITY_META[p].color} arrow={PRIORITY_META[p].arrow} />
                    <span className="menu-item-text">{PRIORITY_META[p].label}</span>
                    {filters.priority === p && <MenuCheck />}
                  </button>
                ))}

                <p className="list-menu-label">Issue type</p>
                <button type="button" className="menu-item" role="menuitemradio" aria-checked={filters.type === 'all'} onClick={() => setFilters((f) => ({ ...f, type: 'all' }))}>
                  <span className="menu-item-text">Any type</span>
                  {filters.type === 'all' && <MenuCheck />}
                </button>
                {TYPE_ORDER.map((t) => (
                  <button key={t} type="button" className="menu-item" role="menuitemradio" aria-checked={filters.type === t} onClick={() => setFilters((f) => ({ ...f, type: t }))}>
                    <TypeIcon type={t} size={14} />
                    <span className="menu-item-text">{TYPE_META[t].label}</span>
                    {filters.type === t && <MenuCheck />}
                  </button>
                ))}

                <div className="menu-sep" />
                <button type="button" className="menu-item" onClick={clearFilters}>
                  <span className="menu-item-text">Clear all filters</span>
                </button>
              </div>
            )}
          </div>

          <div className="list-menu-wrap">
            <button
              type="button"
              className={`filter-btn${group !== 'none' ? ' active' : ''}`}
              aria-expanded={openMenu === 'group'}
              aria-haspopup="true"
              onClick={() => setOpen(openMenu === 'group' ? null : 'group')}
            >
              <LayersIcon />
              <span>Group</span>
            </button>

            {openMenu === 'group' && (
              <div className="menu-popup list-menu" role="menu">
                {GROUPS.map((g) => (
                  <button
                    key={g.key}
                    type="button"
                    className="menu-item"
                    role="menuitemradio"
                    aria-checked={group === g.key}
                    onClick={() => {
                      setGroup(g.key);
                      setCollapsed(new Set());
                      setOpen(null);
                    }}
                  >
                    <span className="menu-item-text">{g.label}</span>
                    {group === g.key && <MenuCheck />}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="list-menu-wrap list-menu-wrap-right">
            <button
              type="button"
              className="filter-btn"
              aria-expanded={openMenu === 'more'}
              aria-haspopup="true"
              aria-label="View options"
              title="View options"
              onClick={() => setOpen(openMenu === 'more' ? null : 'more')}
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
                <circle cx="5" cy="12" r="1.8" />
                <circle cx="12" cy="12" r="1.8" />
                <circle cx="19" cy="12" r="1.8" />
              </svg>
            </button>

            {openMenu === 'more' && (
              <div className="menu-popup list-menu list-menu-right" role="menu">
                <p className="list-menu-label">Columns</p>
                {COLUMNS.filter((c) => !c.always).map((c) => {
                  const on = !hidden.has(c.key);
                  return (
                    <button key={c.key} type="button" className="menu-item" role="menuitemcheckbox" aria-checked={on} onClick={() => toggleColumn(c.key)}>
                      <span className={`list-column-check${on ? ' is-on' : ''}`} aria-hidden="true">
                        {on ? '✓' : ''}
                      </span>
                      <span className="menu-item-text">{c.label}</span>
                    </button>
                  );
                })}
                <div className="menu-sep" />
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    setSearch('');
                    setFilters({ assignee: 'all', priority: 'all', status: 'all', type: 'all' });
                    setGroup('none');
                    setSort({ key: 'created', dir: 'desc' });
                    setHidden(new Set(DEFAULT_HIDDEN));
                    setPage(1);
                    setOpen(null);
                  }}
                >
                  <span className="menu-item-text">Reset view</span>
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="list-frame">
          <div className="list-scroll" role="region" aria-label="Work items" tabIndex={0}>
            <table className="list-table">
              <thead>
                <tr>
                  <th className="list-th list-cell-check" scope="col">
                    <input
                      type="checkbox"
                      checked={allOnPageSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = !allOnPageSelected && someOnPageSelected;
                      }}
                      onChange={toggleSelectPage}
                      aria-label="Select all work items on this page"
                    />
                  </th>
                  <th className="list-th list-cell-expand" scope="col">
                    <span className="list-expand-slot" aria-hidden="true" />
                  </th>

                  {visibleColumns.map((c) => {
                    const active = sort.key === c.key;
                    return (
                      <th
                        key={c.key}
                        scope="col"
                        className={`list-th list-th-sortable${active ? ' is-sorted' : ''}`}
                        aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                      >
                        <button type="button" className="list-th-btn" onClick={() => toggleSort(c.key)}>
                          {c.label}
                          <SortArrow dir={active ? sort.dir : null} />
                        </button>
                      </th>
                    );
                  })}

                  <th className="list-th list-cell-more" scope="col">
                    <span className="list-columns-hint" title="Choose columns from the view options menu" aria-hidden="true">
                      <ColumnsIcon />
                    </span>
                  </th>
                </tr>
              </thead>

              <tbody>
                {groups
                  ? paged.map((g) => {
                      const isCollapsed = collapsed.has(g.label);
                      return [
                        <tr
                          key={`g-${g.label}`}
                          className="list-group-row"
                          aria-expanded={!isCollapsed}
                        >
                          <td className="list-group-cell" colSpan={visibleColumns.length + 3}>
                            <button type="button" className="list-group-btn" onClick={() => toggleGroup(g.label)}>
                              <CaretIcon open={!isCollapsed} />
                              <span className="list-group-name">{g.label}</span>
                              <span className="list-group-count">({g.rows.length})</span>
                            </button>
                          </td>
                        </tr>,
                        ...(isCollapsed ? [] : g.rows.map(renderRow)),
                      ];
                    })
                  : paged.map(renderRow)}
              </tbody>
            </table>

            {total === 0 && (
              <EmptyState hasAny={tickets.length > 0} filtered={hasActiveFilters} onReset={clearFilters} />
            )}
          </div>

          <div className="list-footer">
            {isAdmin ? (
              <button type="button" className="btn-ghost list-create" onClick={() => setShowCreate(true)}>
                <PlusIcon />
                Create
              </button>
            ) : (
              <span />
            )}

            <div className="list-count">
              <span>
                {safePage * PAGE_SIZE >= total ? total : (safePage - 1) * PAGE_SIZE + 1}
                {'–'}
                {Math.min(safePage * PAGE_SIZE, total)} of {total}
              </span>
              {selected.size > 0 && (
                <span className="list-selected-note">{selected.size} selected</span>
              )}
              <button
                type="button"
                className="list-reset"
                onClick={() => {
                  clearFilters();
                  setGroup('none');
                  setSort({ key: 'created', dir: 'desc' });
                  setHidden(new Set(DEFAULT_HIDDEN));
                  setSelected(new Set());
                  setCollapsed(new Set());
                  setPage(1);
                }}
                title="Reset the view"
                aria-label="Reset the view"
              >
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M3 12a9 9 0 0 1 15.5-6.2L21 8" />
                  <path d="M21 3v5h-5" />
                  <path d="M21 12a9 9 0 0 1-15.5 6.2L3 16" />
                  <path d="M3 21v-5h5" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {pageCount > 1 && (
          <div className="list-pager">
            <button type="button" className="btn-ghost" disabled={safePage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              Previous
            </button>
            <span>{`Page ${safePage} of ${pageCount}`}</span>
            <button type="button" className="btn-ghost" disabled={safePage >= pageCount} onClick={() => setPage((p) => Math.min(pageCount, p + 1))}>
              Next
            </button>
          </div>
        )}
      </div>

      {detailTicket && (
        <TicketDetailModal
          ticket={detailTicket}
          employees={employees}
          canReassign={isAdmin}
          onReassign={handleReassign}
          onClose={() => setOpenTicket(null)}
        />
      )}

      {showCreate && (
        <CreateTicketModal
          employees={employees}
          projects={projects}
          defaultProjectId={projectId}
          onClose={() => setShowCreate(false)}
          onCreate={async () => {
            setShowCreate(false);
            const res = await fetch('/api/tickets');
            const data = await res.json();
            if (res.ok) setTickets(data.tickets.filter((t) => t.project_id === projectId));
          }}
        />
      )}
    </AppShell>
  );
}

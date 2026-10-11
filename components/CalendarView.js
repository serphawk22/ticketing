'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppShell from './AppShell';
import PageHeader from './PageHeader';
import Avatar from './Avatar';
import ProjectTabs from './ProjectTabs';
import CreateTicketModal from './CreateTicketModal';
import TicketDetailModal from './ticket/TicketDetailModal';
import { mergeArchiveChange } from './archiveChange';
import useTicketModal from './useTicketModal';
import UnscheduledPanel from './calendar/UnscheduledPanel';
import {
  STATUS_META,
  STATUS_ORDER,
  PRIORITY_META,
  PRIORITY_ORDER,
  TYPE_META,
  PriorityIcon,
  TypeIcon,
  ticketKey,
} from './meta';
import {
  WEEKDAY_LABELS,
  buildMonthGrid,
  buildWeekGrid,
  bucketByDueDate,
  dateFromISO,
  monthLabel,
  normalizeDueDate,
  toISO,
  weekLabel,
  TICKET_DRAG_TYPE,
} from '../lib/calendar';

const EMPTY_FILTERS = { assignee: 'all', status: 'all', priority: 'all', type: 'all' };

// A cell is 90px tall, and a chip is 20px plus a 2px gap, so three chips and the
// date number fit. Anything past the third goes behind "+N more" rather than
// stretching the row, which keeps the whole grid the same height.
const MAX_CHIPS = 3;

const MIN_PANEL = 220;
const MAX_PANEL = 520;
const DEFAULT_PANEL = 300;

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

function LeftIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 6l-6 6 6 6" />
    </svg>
  );
}

function RightIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 6l6 6-6 6" />
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

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M3 10h18" />
    </svg>
  );
}

function ExpandIcon({ active }) {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {active ? (
        <path d="M9 3v6H3M15 21v-6h6M3 15h6V3M21 9h-6V3" />
      ) : (
        <path d="M3 9V3h6M21 9V3h-6M3 15v6h6M21 15v6h-6" />
      )}
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

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

function CalendarChip({ ticket, onOpen, onDragStart, onDragEnd, dragging }) {
  return (
    <div
      className={`cal-chip${dragging ? ' is-dragging' : ''}`}
      style={{ '--chip-accent': STATUS_META[ticket.status]?.color }}
      draggable
      role="button"
      tabIndex={0}
      title={`${ticketKey(ticket)} · ${ticket.title}`}
      aria-label={`${ticketKey(ticket)}: ${ticket.title}`}
      onClick={(e) => {
        e.stopPropagation();
        onOpen(ticket.id);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(ticket.id);
        }
      }}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData(TICKET_DRAG_TYPE, String(ticket.id));
        e.dataTransfer.setData('text/plain', String(ticket.id));
        onDragStart(ticket.id);
      }}
      onDragEnd={onDragEnd}
    >
      <span className="cal-chip-dot" aria-hidden="true" />
      <span className="cal-chip-key">{ticketKey(ticket)}</span>
      <span className="cal-chip-title">{ticket.title}</span>
    </div>
  );
}

export default function CalendarView({
  initialTickets = [],
  project,
  projects = [],
  employees = [],
  projectCounts = {},
  myIssuesCount = 0,
  currentUser,
  today,
}) {
  const router = useRouter();
  const [tickets, setTickets] = useState(initialTickets);
  const [error, setError] = useState('');

  // The cursor is derived from the `today` the server handed down, so the grid
  // renders identically on both sides of hydration.
  const [cursor, setCursor] = useState(() => {
    const d = dateFromISO(today);
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() };
  });
  const [weekAnchor, setWeekAnchor] = useState(today);
  const [viewMode, setViewMode] = useState('month');
  const [viewMenuOpen, setViewMenuOpen] = useState(false);

  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);

  const [panelOpen, setPanelOpen] = useState(true);
  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL);
  const [unschedSearch, setUnschedSearch] = useState('');
  const [sort, setSort] = useState('recent');
  const [sortOpen, setSortOpen] = useState(false);
  const [panelFilterOpen, setPanelFilterOpen] = useState(false);

  const [dragId, setDragId] = useState(null);
  const [dropDate, setDropDate] = useState(null);
  const [overflowDay, setOverflowDay] = useState(null);

  const [showCreate, setShowCreate] = useState(false);
  const [createDueDate, setCreateDueDate] = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const shellRef = useRef(null);
  const isAdmin = currentUser?.role === 'admin';

  const modal = useTicketModal({ visible: tickets, lookup: tickets });

  const patchFields = useCallback(
    async (id, fields, describe) => {
      const previous = tickets;
      setError('');
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
        setError(`${describe} failed: ${e.message}`);
      }
    },
    [tickets]
  );

  const setDueDate = useCallback(
    (id, iso) => patchFields(id, { due_date: iso }, iso ? 'Setting the due date' : 'Clearing the due date'),
    [patchFields]
  );

  // Separate from setDueDate so the panel's "drop here to unschedule" has one
  // argument and cannot be wired up with the date left off by accident. Passing
  // undefined would drop the key on the way to JSON and patch nothing at all.
  const clearDueDate = useCallback((id) => setDueDate(id, null), [setDueDate]);

  const updateStatus = useCallback(
    (id, status) => patchFields(id, { status }, 'Updating the status'),
    [patchFields]
  );

  const applyTicketUpdate = useCallback((next) => {
    if (!next) return;
    setTickets((ts) => ts.map((t) => (t.id === next.id ? { ...t, ...next } : t)));
  }, []);

  const openTicket = useCallback((id) => {
    const hit = tickets.find((t) => t.id === id);
    if (hit) modal.select(hit);
  }, [tickets, modal]);

  // ---- filtering -----------------------------------------------------------

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

  const matchesFilters = useCallback(
    (t, text) => {
      if (filters.assignee !== 'all' && String(t.employee_id) !== filters.assignee) return false;
      if (filters.status !== 'all' && t.status !== filters.status) return false;
      if (filters.priority !== 'all' && t.priority !== filters.priority) return false;
      if (filters.type !== 'all' && t.type !== filters.type) return false;
      if (text) {
        const hay = `${ticketKey(t)} ${t.title}`.toLowerCase();
        if (!hay.includes(text)) return false;
      }
      return true;
    },
    [filters]
  );

  // The calendar search and the panel search are separate boxes, but both
  // respect the shared assignee/status/priority/type filters, which is what
  // makes one Filter control narrow both lists at once.
  const onCalendar = useMemo(
    () => tickets.filter((t) => matchesFilters(t, search.trim().toLowerCase())),
    [tickets, matchesFilters, search]
  );
  const onPanel = useMemo(
    () => tickets.filter((t) => matchesFilters(t, unschedSearch.trim().toLowerCase())),
    [tickets, matchesFilters, unschedSearch]
  );

  const scheduled = useMemo(
    () => onCalendar.filter((t) => normalizeDueDate(t.due_date)),
    [onCalendar]
  );
  const unscheduled = useMemo(
    () => onPanel.filter((t) => !normalizeDueDate(t.due_date)),
    [onPanel]
  );
  const unscheduledTotal = useMemo(
    () => tickets.filter((t) => !normalizeDueDate(t.due_date)).length,
    [tickets]
  );

  const buckets = useMemo(() => bucketByDueDate(scheduled), [scheduled]);

  // ---- the grid ------------------------------------------------------------

  const grid = useMemo(
    () => (viewMode === 'week' ? buildWeekGrid(weekAnchor) : buildMonthGrid(cursor.year, cursor.month)),
    [viewMode, weekAnchor, cursor]
  );

  const periodLabel = useMemo(
    () => (viewMode === 'week' ? weekLabel(grid[0]) : monthLabel(cursor.year, cursor.month)),
    [viewMode, grid, cursor]
  );

  const todayDate = dateFromISO(today);

  const shiftPeriod = useCallback(
    (delta) => {
      if (viewMode === 'week') {
        setWeekAnchor((anchor) => {
          const d = dateFromISO(anchor);
          const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + delta * 7));
          return toISO(next);
        });
        return;
      }
      // Functional updates, so holding the arrow down and clicking repeatedly
      // walks several months instead of collapsing into one: a plain read of
      // `cursor` would hand every click in the same batch the same starting
      // month.
      setCursor(({ year, month }) => {
        const d = new Date(Date.UTC(year, month + delta, 1));
        return { year: d.getUTCFullYear(), month: d.getUTCMonth() };
      });
    },
    [viewMode]
  );

  const goToday = useCallback(() => {
    const d = dateFromISO(today);
    setWeekAnchor(today);
    setCursor({ year: d.getUTCFullYear(), month: d.getUTCMonth() });
  }, [today]);

  const setView = useCallback(
    (mode) => {
      setViewMode(mode);
      setViewMenuOpen(false);
      if (mode === 'week') setWeekAnchor(today);
    },
    [today]
  );

  // ---- drag and drop -------------------------------------------------------

  // If a drag ends anywhere the browser does not tell us about -- released
  // outside the window, cancelled with Escape -- the ghost indicator would stay
  // on screen forever.
  useEffect(() => {
    const end = () => {
      setDragId(null);
      setDropDate(null);
      setOverflowDay(null);
    };
    window.addEventListener('dragend', end);
    window.addEventListener('drop', end);
    return () => {
      window.removeEventListener('dragend', end);
      window.removeEventListener('drop', end);
    };
  }, []);

  useEffect(() => {
    if (dragId == null) return;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setDragId(null);
        setDropDate(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dragId]);

  // ---- panel resize --------------------------------------------------------

  const startResize = useCallback((e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = panelWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev) => {
      // Dragging the handle left widens the panel, so the delta is inverted.
      const next = Math.min(MAX_PANEL, Math.max(MIN_PANEL, startWidth - (ev.clientX - startX)));
      setPanelWidth(next);
    };
    const onUp = () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [panelWidth]);

  // ---- fullscreen ----------------------------------------------------------

  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === shellRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = shellRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else el.requestFullscreen?.().catch(() => setError('Fullscreen was blocked by the browser.'));
  }, []);

  // ---- menu wiring ---------------------------------------------------------

  useEffect(() => {
    if (!filterOpen && !sortOpen && !viewMenuOpen && !panelFilterOpen && overflowDay == null) return;
    const onDown = (e) => {
      if (e.target.closest('.menu-popup') || e.target.closest('.filter-btn') || e.target.closest('.cal-ghost-btn') || e.target.closest('.cal-view-btn')) return;
      setFilterOpen(false);
      setSortOpen(false);
      setViewMenuOpen(false);
      setPanelFilterOpen(false);
      // The overflow list is a popover, so clicking anywhere else puts it away.
      if (!e.target.closest('.cal-overflow-wrap')) setOverflowDay(null);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [filterOpen, sortOpen, viewMenuOpen, panelFilterOpen, overflowDay]);

  useEffect(() => {
    if (overflowDay == null) return;
    const onKey = (e) => {
      if (e.key === 'Escape') setOverflowDay(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [overflowDay]);

  // The panel starts collapsed on a narrow screen, where it would otherwise
  // squeeze the grid down to two readable columns.
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px)');
    const apply = () => {
      if (mq.matches) setPanelOpen(false);
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  const activeFilterCount =
    (filters.status !== 'all' ? 1 : 0) +
    (filters.priority !== 'all' ? 1 : 0) +
    (filters.type !== 'all' ? 1 : 0);

  const renderCell = (iso, columnIndex) => {
    const date = dateFromISO(iso);
    const isToday = iso === today;
    const isCurrentMonth = date.getUTCMonth() === cursor.month && date.getUTCFullYear() === cursor.year;
    const inWeekView = viewMode === 'week';
    const items = buckets.get(iso) || [];
    const shown = items.slice(0, MAX_CHIPS);
    const rest = items.slice(MAX_CHIPS);
    const isDrop = dragId != null && dropDate === iso;

    return (
      <div
        key={iso}
        className={`cal-cell${isToday ? ' is-today' : ''}${isCurrentMonth || inWeekView ? '' : ' is-outside'}${
          dragId != null ? ' is-droppable' : ''
        }${isDrop ? ' is-drop' : ''}`}
        data-date={iso}
        onDragOver={(e) => {
          // The payload decides whether this is one of our drags, so the cell
          // does not depend on `dragId` having rendered before the first
          // dragover. State is left to drive the highlight alone.
          if (!e.dataTransfer.types.includes(TICKET_DRAG_TYPE)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          if (dropDate !== iso) setDropDate(iso);
        }}
        onDragEnter={(e) => {
          if (!e.dataTransfer.types.includes(TICKET_DRAG_TYPE)) return;
          e.preventDefault();
          setDropDate(iso);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget)) return;
          setDropDate((d) => (d === iso ? null : d));
        }}
        onDrop={(e) => {
          if (!e.dataTransfer.types.includes(TICKET_DRAG_TYPE)) return;
          e.preventDefault();
          setDueDate(Number(e.dataTransfer.getData(TICKET_DRAG_TYPE)), iso);
          setDragId(null);
          setDropDate(null);
        }}
      >
        <div className="cal-cell-head">
          <span className={`cal-day${isToday ? ' is-today' : ''}`}>{date.getUTCDate()}</span>
          <button
            type="button"
            className="cal-cell-add"
            onClick={() => {
              setCreateDueDate(iso);
              setShowCreate(true);
            }}
            aria-label={`Create a work item due ${iso}`}
            title={`Create a work item due ${iso}`}
          >
            <PlusIcon />
          </button>
        </div>

        <div className="cal-cell-body">
          {shown.map((t) => (
            <CalendarChip
              key={t.id}
              ticket={t}
              dragging={dragId === t.id}
              onOpen={openTicket}
              onDragStart={setDragId}
              onDragEnd={() => {
                setDragId(null);
                setDropDate(null);
              }}
            />
          ))}

          {rest.length > 0 && (
            <div className="cal-overflow-wrap">
              <button
                type="button"
                className="cal-overflow-btn"
                aria-expanded={overflowDay === iso}
                onClick={(e) => {
                  e.stopPropagation();
                  setOverflowDay(overflowDay === iso ? null : iso);
                }}
              >
                +{rest.length} more
              </button>
              {overflowDay === iso && (
                <div className="menu-popup cal-overflow" role="menu">
                  {rest.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className="menu-item"
                      role="menuitem"
                      onClick={(e) => {
                        e.stopPropagation();
                        setOverflowDay(null);
                        openTicket(t.id);
                      }}
                    >
                      <TypeIcon type={t.type} size={12} />
                      <span className="menu-item-text">
                        <strong>{ticketKey(t)}</strong> {t.title}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <AppShell
      currentUser={currentUser}
      projects={projects}
      projectCounts={projectCounts}
      myIssuesCount={myIssuesCount}
      view="summary"
      filter="all"
      onFilterChange={() => {}}
      projectId={String(project.id)}
      onProjectChange={(id) => router.push(`/projects/${id}/calendar`)}
      onCreate={isAdmin ? () => { setCreateDueDate(null); setShowCreate(true); } : undefined}
    >
      <div className="board cal-view" ref={shellRef}>
        {error && (
          <div className="error-banner">
            <strong>Error:</strong> {error}
            <button type="button" onClick={() => setError('')}>Dismiss</button>
          </div>
        )}

        <PageHeader
          breadcrumb={[{ label: 'Projects', href: '/projects' }, { label: project.name }]}
          title={project.name}
          project={project}
          subtitle={project.description}
        />

        <ProjectTabs projectId={project.id} active="calendar" />

        <div className="cal-toolbar">
          <div className="search-field cal-search">
            <SearchIcon />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search calendar"
              aria-label="Search the calendar by title or key"
            />
          </div>

          <div className="list-people cal-people" aria-label="Filter by assignee">
            {people.map((p) => {
              const active = filters.assignee === String(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  className={`list-person-btn${active ? ' is-active' : ''}`}
                  onClick={() =>
                    setFilters((f) => ({ ...f, assignee: active ? 'all' : String(p.id) }))
                  }
                  title={`${p.name} — ${p.count}`}
                  aria-pressed={active}
                >
                  <Avatar name={p.name} assigned size={24} showTitle={false} />
                </button>
              );
            })}
          </div>

          <div className="cal-menu-wrap">
            <button
              type="button"
              className={`filter-btn${activeFilterCount ? ' active' : ''}`}
              aria-expanded={filterOpen}
              aria-haspopup="true"
              onClick={() => setFilterOpen((v) => !v)}
            >
              <FunnelIcon />
              <span>Filter</span>
              {activeFilterCount > 0 && <span className="cal-filter-badge">{activeFilterCount}</span>}
            </button>
            {filterOpen && (
              <div className="menu-popup cal-menu" role="menu">
                <p className="cal-menu-label">Status</p>
                {STATUS_ORDER.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className="menu-item"
                    role="menuitemradio"
                    aria-checked={filters.status === s}
                    onClick={() => setFilters((f) => ({ ...f, status: f.status === s ? 'all' : s }))}
                  >
                    <span className="cal-menu-dot" style={{ background: STATUS_META[s].color }} />
                    <span className="menu-item-text">{STATUS_META[s].label}</span>
                    {filters.status === s && <CheckIcon />}
                  </button>
                ))}
                <p className="cal-menu-label">Priority</p>
                {PRIORITY_ORDER.map((p) => (
                  <button
                    key={p}
                    type="button"
                    className="menu-item"
                    role="menuitemradio"
                    aria-checked={filters.priority === p}
                    onClick={() => setFilters((f) => ({ ...f, priority: f.priority === p ? 'all' : p }))}
                  >
                    <PriorityIcon color={PRIORITY_META[p].color} arrow={PRIORITY_META[p].arrow} />
                    <span className="menu-item-text">{PRIORITY_META[p].label}</span>
                    {filters.priority === p && <CheckIcon />}
                  </button>
                ))}
                <p className="cal-menu-label">Type</p>
                {['task', 'bug', 'story', 'epic'].map((t) => (
                  <button
                    key={t}
                    type="button"
                    className="menu-item"
                    role="menuitemradio"
                    aria-checked={filters.type === t}
                    onClick={() => setFilters((f) => ({ ...f, type: f.type === t ? 'all' : t }))}
                  >
                    <TypeIcon type={t} size={12} />
                    <span className="menu-item-text">{TYPE_META[t].label}</span>
                    {filters.type === t && <CheckIcon />}
                  </button>
                ))}
                {activeFilterCount > 0 && (
                  <>
                    <p className="cal-menu-label" />
                    <button type="button" className="menu-item" role="menuitem" onClick={() => setFilters(EMPTY_FILTERS)}>
                      <span className="menu-item-text">Clear filters</span>
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="cal-toolbar-right">
            <button type="button" className="btn-ghost" onClick={goToday}>
              Today
            </button>

            <div className="cal-period">
              <button
                type="button"
                className="cal-step-btn"
                onClick={() => shiftPeriod(-1)}
                aria-label={viewMode === 'week' ? 'Previous week' : 'Previous month'}
              >
                <LeftIcon />
              </button>
              <span className="cal-period-label" aria-live="polite">
                {periodLabel}
              </span>
              <button
                type="button"
                className="cal-step-btn"
                onClick={() => shiftPeriod(1)}
                aria-label={viewMode === 'week' ? 'Next week' : 'Next month'}
              >
                <RightIcon />
              </button>
            </div>

            <div className="cal-menu-wrap">
              <button
                type="button"
                className="btn-ghost cal-view-btn"
                aria-expanded={viewMenuOpen}
                aria-haspopup="menu"
                onClick={() => setViewMenuOpen((v) => !v)}
              >
                <span>{viewMode === 'week' ? 'Week' : 'Month'}</span>
                <ChevronIcon />
              </button>
              {viewMenuOpen && (
                <div className="menu-popup cal-menu" role="menu">
                  <button
                    type="button"
                    className="menu-item"
                    role="menuitemradio"
                    aria-checked={viewMode === 'month'}
                    onClick={() => setView('month')}
                  >
                    <span className="menu-item-text">Month</span>
                    {viewMode === 'month' && <CheckIcon />}
                  </button>
                  <button
                    type="button"
                    className="menu-item"
                    role="menuitemradio"
                    aria-checked={viewMode === 'week'}
                    onClick={() => setView('week')}
                  >
                    <span className="menu-item-text">Week</span>
                    {viewMode === 'week' && <CheckIcon />}
                  </button>
                </div>
              )}
            </div>

            <button
              type="button"
              className={`cal-icon-btn${panelOpen ? ' is-active' : ''}`}
              onClick={() => setPanelOpen((v) => !v)}
              aria-pressed={panelOpen}
              aria-label={panelOpen ? 'Hide the unscheduled work panel' : 'Show the unscheduled work panel'}
              title={panelOpen ? 'Hide unscheduled work' : 'Show unscheduled work'}
            >
              <CalendarIcon />
            </button>

            <button
              type="button"
              className={`cal-icon-btn${isFullscreen ? ' is-active' : ''}`}
              onClick={toggleFullscreen}
              aria-label={isFullscreen ? 'Exit fullscreen' : 'View fullscreen'}
              title={isFullscreen ? 'Exit fullscreen' : 'View fullscreen'}
            >
              <ExpandIcon active={isFullscreen} />
            </button>
          </div>
        </div>

        <div className="cal-body">
          <div className="cal-main">
            <div className="cal-grid-wrap">
              <div className="cal-weekdays" role="row">
                {WEEKDAY_LABELS.map((d) => (
                  <div key={d} className="cal-weekday" role="columnheader">
                    {d}
                  </div>
                ))}
              </div>

              <div className={`cal-grid${viewMode === 'week' ? ' is-week' : ''}`}>
                {grid.map((week) => (
                  <div className="cal-week" key={week[0]} role="row">
                    {week.map((iso, i) => renderCell(iso, i))}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {panelOpen && (
            <>
              <div
                className="cal-resizer"
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize the unscheduled work panel"
                tabIndex={0}
                onMouseDown={startResize}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowLeft') setPanelWidth((w) => Math.min(MAX_PANEL, w + 16));
                  if (e.key === 'ArrowRight') setPanelWidth((w) => Math.max(MIN_PANEL, w - 16));
                }}
              >
                <span className="cal-resizer-grip" aria-hidden="true" />
              </div>

              <div className="cal-panel-slot" style={{ width: panelWidth }}>
                <UnscheduledPanel
                  tickets={unscheduled}
                  total={unscheduledTotal}
                  search={unschedSearch}
                  onSearch={setUnschedSearch}
                  sort={sort}
                  onSort={(v) => {
                    setSort(v);
                    setSortOpen(false);
                  }}
                  sortOpen={sortOpen}
                  onSortToggle={() => setSortOpen((v) => !v)}
                  filtersOpen={panelFilterOpen}
                  onFiltersToggle={() => setPanelFilterOpen((v) => !v)}
                  filters={filters}
                  onFilters={(patch) => setFilters((f) => ({ ...f, ...patch }))}
                  onClose={() => setPanelOpen(false)}
                  onOpenTicket={openTicket}
                  onStatusChange={updateStatus}
                  onDropClear={clearDueDate}
                  onDragStart={setDragId}
                  onDragEnd={() => {
                    setDragId(null);
                    setDropDate(null);
                  }}
                  draggingId={dragId}
                  isDropTarget={dragId != null}
                  canUpdate
                />
              </div>
            </>
          )}
        </div>
      </div>

      {modal.selected && (
        <TicketDetailModal
          ticket={modal.selected}
          employees={employees}
          currentUser={currentUser}
          siblingTickets={tickets}
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
          defaultProjectId={project.id}
          defaultDueDate={createDueDate}
          onClose={() => {
            setShowCreate(false);
            setCreateDueDate(null);
          }}
          onCreate={async () => {
            setShowCreate(false);
            const due = createDueDate;
            setCreateDueDate(null);
            // Land on the month the new ticket belongs to, or creating from a
            // trailing October cell would leave the user staring at September.
            if (due) {
              const d = dateFromISO(due);
              setCursor({ year: d.getUTCFullYear(), month: d.getUTCMonth() });
              setWeekAnchor(due);
            }
            // Refetched rather than appended, so the new row comes back with the
            // id, key and derived fields the rest of the view expects. Matches
            // what the list does after a create.
            const res = await fetch('/api/tickets');
            const data = await res.json();
            if (!res.ok) {
              setError(data.error || 'Could not load the project after creating.');
              return;
            }
            setTickets(data.tickets.filter((t) => t.project_id === project.id));
          }}
        />
      )}
    </AppShell>
  );
}

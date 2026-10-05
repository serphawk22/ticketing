'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AppShell from './AppShell';
import Avatar from './Avatar';
import ProjectTabs from './ProjectTabs';
import CreateTicketModal from './CreateTicketModal';
import TicketDetailModal from './ticket/TicketDetailModal';
import useTicketModal from './useTicketModal';
import {
  STATUS_META,
  STATUS_ORDER,
  PRIORITY_META,
  PRIORITY_ORDER,
  TYPE_META,
  TYPE_ORDER,
  TypeIcon,
  PriorityIcon,
  ticketKey,
} from './meta';
import { normalizeDueDate } from '../lib/calendar';
import { isDone } from '../lib/ticketTree';
import {
  HEAD_H,
  ROW_H,
  SIDE_W,
  ZOOM_ORDER,
  ZOOMS,
  barGeometry,
  buildColumns,
  buildRange,
  buildTimelineRows,
  clampDelta,
  dateAtX,
  daysBetween,
  groupBy,
  includeAncestors,
  isScheduleConflict,
  linkPath,
  prettyDate,
  resizePatch,
  scheduleFields,
  shiftPatches,
  visibleRows,
  weekGroups,
  withDatePatch,
} from '../lib/timeline';

const EMPTY_FILTERS = { assignee: 'all', status: 'all', priority: 'all', type: 'all' };
const EMPTY_SET = new Set();

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

function ChevronIcon({ open }) {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={open ? 'M6 9l6 6 6-6' : 'M9 6l6 6-6 6'} />
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

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function barColor(ticket, parentBar) {
  if (parentBar) {
    if (ticket.type === 'epic') return TYPE_META.epic.color;
    return ticket.project_color || '#0C66E4';
  }
  if (ticket.status === 'resolved') return '#22A06B';
  if (ticket.status === 'closed') return '#8590A2';
  if (ticket.status === 'in_progress') return '#0C66E4';
  return '#579DFF';
}

function dateHint(ticket, span) {
  if (span) return `${prettyDate(span.start)} – ${prettyDate(span.end)}`;
  const start = normalizeDueDate(ticket.start_date);
  const due = normalizeDueDate(ticket.due_date);
  if (start && !due) return `Starts ${prettyDate(start)}. Drag across the row to schedule it.`;
  if (due && !start) return `Due ${prettyDate(due)}. Drag across the row to schedule it.`;
  return 'No dates yet. Drag across the row to set a start and due date.';
}

export default function TimelineView({
  initialTickets = [],
  initialLinks = [],
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
  const [links, setLinks] = useState(initialLinks);
  const [error, setError] = useState('');
  const [zoomId, setZoomId] = useState('months');
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);
  const [previewPatch, setPreviewPatch] = useState(null);
  const [draft, setDraft] = useState(null);
  const [linkDrag, setLinkDrag] = useState(null);
  const [linkOver, setLinkOver] = useState(null);
  const [hoverId, setHoverId] = useState(null);
  const [gesture, setGesture] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createRange, setCreateRange] = useState(null);

  const scrollRef = useRef(null);
  const chartBodyRef = useRef(null);
  const filterRef = useRef(null);
  const dragRef = useRef(null);
  const linkOverRef = useRef(null);

  const isAdmin = currentUser?.role === 'admin';
  const zoom = ZOOMS[zoomId];
  const dayWidth = zoom.dayWidth;

  const activeFilterCount = ['assignee', 'status', 'priority', 'type']
    .filter((key) => filters[key] !== 'all').length;

  const people = useMemo(() => {
    const byId = new Map();
    for (const ticket of tickets) {
      if (ticket.employee_id == null) continue;
      if (!byId.has(ticket.employee_id)) {
        byId.set(ticket.employee_id, { id: ticket.employee_id, name: ticket.employee_name, count: 0 });
      }
      byId.get(ticket.employee_id).count += 1;
    }
    return [...byId.values()].sort((a, b) => b.count - a.count || String(a.name).localeCompare(String(b.name)));
  }, [tickets]);

  const filtered = useMemo(() => {
    const text = search.trim().toLowerCase();
    const narrowing = Boolean(text) || activeFilterCount > 0;
    if (!narrowing) return tickets;
    const matched = tickets.filter((ticket) => {
      if (filters.assignee !== 'all' && String(ticket.employee_id) !== filters.assignee) return false;
      if (filters.status !== 'all' && ticket.status !== filters.status) return false;
      if (filters.priority !== 'all' && ticket.priority !== filters.priority) return false;
      if (filters.type !== 'all' && ticket.type !== filters.type) return false;
      if (text && !`${ticketKey(ticket)} ${ticket.title}`.toLowerCase().includes(text)) return false;
      return true;
    });
    return includeAncestors(tickets, matched);
  }, [tickets, search, filters, activeFilterCount]);

  const narrowing = Boolean(search.trim()) || activeFilterCount > 0;
  const collapsedNow = narrowing ? EMPTY_SET : collapsed;
  const roots = useMemo(() => buildTimelineRows(filtered), [filtered]);
  const previewRoots = useMemo(
    () => withDatePatch(roots, previewPatch),
    [roots, previewPatch]
  );
  const rows = useMemo(
    () => visibleRows(previewRoots, collapsedNow),
    [previewRoots, collapsedNow]
  );

  const modal = useTicketModal({
    visible: rows.map((row) => row.ticket),
    lookup: tickets,
  });

  const range = useMemo(() => {
    const spans = [];
    const walk = (nodes) => {
      for (const node of nodes) {
        if (node.span) spans.push(node.span);
        walk(node.children);
      }
    };
    walk(roots);
    return buildRange(today, spans, zoom);
  }, [roots, today, zoom]);

  const columns = useMemo(
    () => buildColumns(range.start, range.count),
    [range.start, range.count]
  );

  // Extra room so a dependency handle sitting past the last day is not clipped.
  const chartWidth = range.count * dayWidth + 20;
  const bodyRows = rows.length + (isAdmin ? 1 : 0);
  const bodyHeight = Math.max(bodyRows * ROW_H, 360);
  const scheduledCount = rows.reduce((count, row) => count + (row.span ? 1 : 0), 0);

  const reloadTickets = useCallback(async () => {
    const res = await fetch('/api/tickets');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not reload work items.');
    setTickets(
      (data.tickets || []).filter((ticket) => Number(ticket.project_id) === Number(project.id))
    );
  }, [project.id]);

  const commit = useCallback(async (patches, describe) => {
    const real = (patches || []).filter((patch) => patch?.fields && Object.keys(patch.fields).length);
    if (!real.length) return;
    const previous = tickets;
    setError('');
    setTickets((current) => current.map((ticket) => {
      const patch = real.find((item) => item.id === ticket.id);
      return patch ? { ...ticket, ...patch.fields } : ticket;
    }));
    try {
      const updated = await Promise.all(real.map(async (patch) => {
        const res = await fetch(`/api/tickets/${patch.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch.fields),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Update failed.');
        return data.ticket;
      }));
      setTickets((current) => current.map((ticket) => (
        updated.find((next) => next && next.id === ticket.id) || ticket
      )));
    } catch (err) {
      setTickets(previous);
      setError(`${describe} failed: ${err.message}`);
    }
  }, [tickets]);

  const createLink = useCallback(async (fromId, toId) => {
    if (fromId === toId) return;
    if (links.some((link) => link.fromId === fromId && link.toId === toId)) {
      setError('That dependency already exists.');
      return;
    }
    const tempId = -Date.now();
    setLinks((current) => [...current, { id: tempId, fromId, toId }]);
    setError('');
    try {
      const res = await fetch(`/api/tickets/${fromId}/relations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ related_ticket_id: toId, relation_type: 'blocks' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not add the dependency.');
      const created = (data.relations || []).find((relation) => (
        relation.direction === 'outgoing'
        && relation.relation_type === 'blocks'
        && Number(relation.related_ticket_id) === Number(toId)
      ));
      setLinks((current) => current.map((link) => (
        link.id === tempId
          ? { id: created?.relation_id ?? link.id, fromId, toId }
          : link
      )));
    } catch (err) {
      setLinks((current) => current.filter((link) => link.id !== tempId));
      setError(err.message);
    }
  }, [links]);

  const openTicket = useCallback((id) => {
    const hit = tickets.find((ticket) => ticket.id === id);
    if (hit) modal.select(hit);
  }, [tickets, modal]);

  const applyTicketUpdate = useCallback((next) => {
    if (!next) return;
    setTickets((current) => {
      if (next.project_id != null && Number(next.project_id) !== Number(project.id)) {
        return current.filter((ticket) => ticket.id !== next.id);
      }
      return current.map((ticket) => (ticket.id === next.id ? { ...ticket, ...next } : ticket));
    });
  }, [project.id]);

  function clientToChart(event) {
    const rect = chartBodyRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function startDrag(event, row, kind) {
    if (event.button !== 0 || !row.span) return;
    event.stopPropagation();
    event.preventDefault();
    const originX = event.clientX;
    const originY = event.clientY;
    const span = row.span;
    setGesture(kind === 'move' ? 'move' : 'resize');
    dragRef.current = {
      moved: false,
      pending: [],
      move(ev) {
        if (Math.abs(ev.clientX - originX) >= 4 || Math.abs(ev.clientY - originY) >= 4) {
          this.moved = true;
        }
        const raw = Math.round((ev.clientX - originX) / dayWidth);
        if (kind === 'move') {
          const patches = shiftPatches(row, clampDelta(span, raw, range));
          const patch = {};
          for (const item of patches) patch[item.id] = item.fields;
          setPreviewPatch(Object.keys(patch).length ? patch : null);
          this.pending = patches;
        } else {
          const fields = resizePatch(row.ticket, kind, raw, range);
          setPreviewPatch(fields ? { [row.ticket.id]: fields } : null);
          this.pending = fields ? [{ id: row.ticket.id, fields }] : [];
        }
      },
      up() {
        const pending = this.pending;
        const moved = this.moved;
        setGesture(null);
        setPreviewPatch(null);
        if (!moved) {
          if (kind === 'move') openTicket(row.ticket.id);
          return;
        }
        commit(pending, 'Rescheduling');
      },
    };
  }

  function startLink(event, row) {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    setGesture('link');
    linkOverRef.current = null;
    dragRef.current = {
      move(ev) {
        const point = clientToChart(ev);
        const index = Math.floor(point.y / ROW_H);
        const target = rows[index];
        const targetId = target && target.ticket.id !== row.ticket.id ? target.ticket.id : null;
        linkOverRef.current = targetId;
        setLinkDrag({ fromId: row.ticket.id, x: point.x, y: point.y });
        setLinkOver(targetId);
      },
      up() {
        const targetId = linkOverRef.current;
        linkOverRef.current = null;
        setGesture(null);
        setLinkDrag(null);
        setLinkOver(null);
        if (targetId) createLink(row.ticket.id, targetId);
      },
    };
  }

  function startSchedule(event, id) {
    if (event.button !== 0 || event.pointerType === 'touch') return;
    event.preventDefault();
    const anchor = dateAtX(range.start, range.count, clientToChart(event).x, dayWidth);
    const originX = event.clientX;
    const originY = event.clientY;
    setGesture('schedule');
    setDraft({ id, start: anchor, end: anchor });
    dragRef.current = {
      moved: false,
      pending: { start: anchor, end: anchor },
      move(ev) {
        if (Math.abs(ev.clientX - originX) >= 4 || Math.abs(ev.clientY - originY) >= 4) {
          this.moved = true;
        }
        const date = dateAtX(range.start, range.count, clientToChart(ev).x, dayWidth);
        const fields = scheduleFields(anchor, date);
        this.pending = { start: fields.start_date, end: fields.due_date };
        setDraft({ id, start: fields.start_date, end: fields.due_date });
      },
      up() {
        const pending = this.pending;
        const moved = this.moved;
        setGesture(null);
        setDraft(null);
        if (id === 'new') {
          setCreateRange(moved ? pending : null);
          setShowCreate(true);
          return;
        }
        if (!moved) return;
        commit(
          [{ id, fields: { start_date: pending.start, due_date: pending.end } }],
          'Scheduling'
        );
      },
    };
  }

  useEffect(() => {
    function onMove(event) {
      dragRef.current?.move?.(event);
    }
    function onUp() {
      const session = dragRef.current;
      if (!session) return;
      dragRef.current = null;
      session.up?.();
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, []);

  useEffect(() => {
    if (!gesture) return undefined;
    const previous = document.body.style.cursor;
    const cursor = gesture === 'link'
      ? 'crosshair'
      : gesture === 'move'
        ? 'grabbing'
        : 'ew-resize';
    document.body.style.cursor = cursor;
    return () => {
      document.body.style.cursor = previous;
    };
  }, [gesture]);

  useEffect(() => {
    if (!filterOpen) return undefined;
    function onDoc(event) {
      if (!filterRef.current?.contains(event.target)) setFilterOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [filterOpen]);

  function scrollToToday(smooth) {
    const el = scrollRef.current;
    if (!el) return;
    const offset = daysBetween(range.start, today) * dayWidth;
    const visible = Math.max(0, el.clientWidth - SIDE_W);
    const left = Math.max(0, offset - visible * 0.28);
    el.scrollTo({ left, behavior: smooth ? 'smooth' : 'auto' });
  }

  function nudge(direction) {
    const el = scrollRef.current;
    if (!el) return;
    const visible = Math.max(240, el.clientWidth - SIDE_W);
    el.scrollBy({ left: direction * visible * 0.75, behavior: 'smooth' });
  }

  const rangeStartRef = useRef(range.start);
  const dayWidthRef = useRef(dayWidth);
  rangeStartRef.current = range.start;
  dayWidthRef.current = dayWidth;

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const offset = daysBetween(rangeStartRef.current, today) * dayWidthRef.current;
    const visible = Math.max(0, el.clientWidth - SIDE_W);
    el.scrollLeft = Math.max(0, offset - visible * 0.28);
  }, [zoomId, today]);

  function toggle(id) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function collapseAll() {
    const ids = [];
    const walk = (nodes) => {
      for (const node of nodes) {
        if (node.hasChildren) ids.push(node.ticket.id);
        walk(node.children);
      }
    };
    walk(roots);
    setCollapsed(new Set(ids));
  }

  function openCreate() {
    setCreateRange(null);
    setShowCreate(true);
  }

  const indexById = new Map(rows.map((row, index) => [Number(row.ticket.id), index]));

  function visibleAnchor(id) {
    const byId = new Map(tickets.map((ticket) => [Number(ticket.id), ticket]));
    const seen = new Set();
    let current = Number(id);
    if (indexById.has(current)) return current;
    while (current != null && !indexById.has(current) && !seen.has(current)) {
      seen.add(current);
      const parentId = byId.get(Number(current))?.parent_id;
      current = parentId == null ? null : Number(parentId);
    }
    return current != null && indexById.has(current) ? current : null;
  }

  const segments = [];
  for (const link of links) {
    const fromId = visibleAnchor(link.fromId);
    const toId = visibleAnchor(link.toId);
    if (fromId == null || toId == null || fromId === toId) continue;
    const fromRow = rows[indexById.get(fromId)];
    const toRow = rows[indexById.get(toId)];
    if (!fromRow?.span || !toRow?.span) continue;
    const fromBox = barGeometry(range.start, fromRow.span, dayWidth);
    const toBox = barGeometry(range.start, toRow.span, dayWidth);
    const y1 = indexById.get(fromId) * ROW_H + ROW_H / 2;
    const y2 = indexById.get(toId) * ROW_H + ROW_H / 2;
    segments.push({
      id: link.id,
      d: linkPath(fromBox.left + fromBox.width, y1, toBox.left, y2),
      conflict: isScheduleConflict(fromRow.span, toRow.span),
    });
  }

  let linkPreview = null;
  if (linkDrag) {
    const fromIndex = indexById.get(linkDrag.fromId);
    const fromRow = fromIndex == null ? null : rows[fromIndex];
    if (fromRow?.span) {
      const fromBox = barGeometry(range.start, fromRow.span, dayWidth);
      linkPreview = linkPath(
        fromBox.left + fromBox.width,
        fromIndex * ROW_H + ROW_H / 2,
        linkDrag.x,
        linkDrag.y
      );
    }
  }

  const topGroups = groupBy(
    columns,
    (col) => (zoomId === 'quarters' ? col.quarterLabel : col.monthLabel)
  );
  const bottomGroups = zoomId === 'months'
    ? weekGroups(columns)
    : zoomId === 'quarters'
      ? groupBy(columns, (col) => col.monthShort)
      : null;

  const todayIndex = daysBetween(range.start, today);
  const todayVisible = todayIndex >= 0 && todayIndex < range.count;

  function spanOf(row) {
    if (draft && draft.id === row.ticket.id) return { start: draft.start, end: draft.end };
    return row.span;
  }

  function nudgeRow(row, direction) {
    if (!row.span) return;
    commit(shiftPatches(row, clampDelta(row.span, direction, range)), 'Rescheduling');
  }

  const hasParents = roots.some(function parentExists(node) {
    return node.hasChildren || node.children.some(parentExists);
  });

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
      onProjectChange={(id) => router.push(`/projects/${id}/timeline`)}
      onCreate={isAdmin ? openCreate : undefined}
    >
      <div className={`board tl-view${gesture ? ` is-${gesture}` : ''}`}>
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
              <span className="project-icon project-icon-sm" style={{ background: project.color }} aria-hidden="true">
                {project.name.charAt(0).toUpperCase()}
              </span>
              <h1>{project.name}</h1>
            </div>
            {project.description && <p className="board-subtitle">{project.description}</p>}
          </div>
        </div>

        <ProjectTabs projectId={project.id} active="timeline" />

        <div className="cal-toolbar">
          <div className="search-field cal-search">
            <SearchIcon />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search timeline"
              aria-label="Search the timeline by title or key"
            />
          </div>

          <div className="list-people cal-people" aria-label="Filter by assignee">
            {people.map((person) => {
              const active = filters.assignee === String(person.id);
              return (
                <button
                  key={person.id}
                  type="button"
                  className={`list-person-btn${active ? ' is-active' : ''}`}
                  onClick={() => setFilters((current) => ({
                    ...current,
                    assignee: active ? 'all' : String(person.id),
                  }))}
                  title={`${person.name} — ${person.count}`}
                  aria-pressed={active}
                >
                  <Avatar name={person.name} assigned size={24} showTitle={false} />
                </button>
              );
            })}
          </div>

          <div className="cal-menu-wrap" ref={filterRef}>
            <button
              type="button"
              className={`filter-btn${activeFilterCount ? ' active' : ''}`}
              aria-expanded={filterOpen}
              aria-haspopup="true"
              onClick={() => setFilterOpen((open) => !open)}
            >
              <FunnelIcon />
              <span>Filter</span>
              {activeFilterCount > 0 && <span className="cal-filter-badge">{activeFilterCount}</span>}
            </button>
            {filterOpen && (
              <div className="menu-popup cal-menu" role="menu">
                <p className="cal-menu-label">Status</p>
                {STATUS_ORDER.map((status) => (
                  <button
                    key={status}
                    type="button"
                    className="menu-item"
                    role="menuitemradio"
                    aria-checked={filters.status === status}
                    onClick={() => setFilters((current) => ({
                      ...current,
                      status: current.status === status ? 'all' : status,
                    }))}
                  >
                    <span className="cal-menu-dot" style={{ background: STATUS_META[status].color }} />
                    <span className="menu-item-text">{STATUS_META[status].label}</span>
                    {filters.status === status && <CheckIcon />}
                  </button>
                ))}
                <p className="cal-menu-label">Priority</p>
                {PRIORITY_ORDER.map((priority) => (
                  <button
                    key={priority}
                    type="button"
                    className="menu-item"
                    role="menuitemradio"
                    aria-checked={filters.priority === priority}
                    onClick={() => setFilters((current) => ({
                      ...current,
                      priority: current.priority === priority ? 'all' : priority,
                    }))}
                  >
                    <PriorityIcon color={PRIORITY_META[priority].color} arrow={PRIORITY_META[priority].arrow} />
                    <span className="menu-item-text">{PRIORITY_META[priority].label}</span>
                    {filters.priority === priority && <CheckIcon />}
                  </button>
                ))}
                <p className="cal-menu-label">Type</p>
                {TYPE_ORDER.map((type) => (
                  <button
                    key={type}
                    type="button"
                    className="menu-item"
                    role="menuitemradio"
                    aria-checked={filters.type === type}
                    onClick={() => setFilters((current) => ({
                      ...current,
                      type: current.type === type ? 'all' : type,
                    }))}
                  >
                    <TypeIcon type={type} size={12} />
                    <span className="menu-item-text">{TYPE_META[type].label}</span>
                    {filters.type === type && <CheckIcon />}
                  </button>
                ))}
                {activeFilterCount > 0 && (
                  <button
                    type="button"
                    className="menu-item"
                    role="menuitem"
                    onClick={() => setFilters(EMPTY_FILTERS)}
                  >
                    <span className="menu-item-text">Clear filters</span>
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="tl-nav">
            <button type="button" className="cal-step-btn" onClick={() => nudge(-1)} aria-label="Scroll backward">
              <LeftIcon />
            </button>
            <button type="button" className="btn-ghost" onClick={() => scrollToToday(true)}>
              Today
            </button>
            <button type="button" className="cal-step-btn" onClick={() => nudge(1)} aria-label="Scroll forward">
              <RightIcon />
            </button>
            <div className="tl-zoom" role="group" aria-label="Zoom">
              {ZOOM_ORDER.map((id) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={zoomId === id}
                  onClick={() => setZoomId(id)}
                >
                  {ZOOMS[id].label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {rows.length === 0 && (
          <p className="tl-note">
            {tickets.length === 0
              ? 'No work items in this project yet.'
              : 'No work items match the current filters.'}
          </p>
        )}
        {scheduledCount === 0 && rows.length > 0 && (
          <p className="tl-note">
            Drag across a work item to set its start and due dates. Drag the dot on a bar onto another item to mark it as blocked.
          </p>
        )}

        <div className="tl-scroll" ref={scrollRef}>
          <div className="tl-canvas" style={{ width: SIDE_W + chartWidth, minHeight: HEAD_H + bodyHeight }}>
            <div className="tl-side" style={{ width: SIDE_W }}>
              <div className="tl-side-head">
                <strong>Work</strong>
                <div className="tl-head-actions">
                  <button
                    type="button"
                    className="tl-icon-btn"
                    aria-label="Expand all"
                    title="Expand all"
                    disabled={!hasParents}
                    onClick={() => setCollapsed(new Set())}
                  >
                    <ChevronIcon open />
                  </button>
                  <button
                    type="button"
                    className="tl-icon-btn"
                    aria-label="Collapse all"
                    title="Collapse all"
                    disabled={!hasParents}
                    onClick={collapseAll}
                  >
                    <ChevronIcon />
                  </button>
                </div>
              </div>
              {rows.map((row) => {
                const ticket = row.ticket;
                const selected = modal.selected?.id === ticket.id;
                const hovered = hoverId === ticket.id;
                return (
                  <div
                    key={ticket.id}
                    className={`tl-side-row${hovered ? ' is-hover' : ''}${selected ? ' is-selected' : ''}`}
                    style={{ paddingLeft: 8 + row.depth * 16 }}
                    onMouseEnter={() => setHoverId(ticket.id)}
                    onMouseLeave={() => setHoverId(null)}
                  >
                    {row.hasChildren ? (
                      <button
                        type="button"
                        className={`tl-chev${collapsedNow.has(ticket.id) ? '' : ' is-open'}`}
                        aria-expanded={!collapsedNow.has(ticket.id)}
                        aria-label={collapsedNow.has(ticket.id) ? 'Expand' : 'Collapse'}
                        onClick={() => toggle(ticket.id)}
                      >
                        <ChevronIcon open={!collapsedNow.has(ticket.id)} />
                      </button>
                    ) : (
                      <span className="tl-chev-spacer" />
                    )}
                    <TypeIcon type={ticket.type} size={14} />
                    <button
                      type="button"
                      className="tl-side-main"
                      title={dateHint(ticket, row.span)}
                      onClick={() => openTicket(ticket.id)}
                    >
                      <span className="tl-key">{ticketKey(ticket)}</span>
                      <span className="tl-title">{ticket.title}</span>
                    </button>
                    {row.hasChildren && (
                      <span className="tl-count" title={`${row.descendantDone} of ${row.descendantTotal} done`}>
                        {row.descendantTotal}
                      </span>
                    )}
                    <Avatar
                      name={ticket.employee_name}
                      assigned={Boolean(ticket.employee_id)}
                      size={22}
                    />
                  </div>
                );
              })}
              {isAdmin && (
                <button type="button" className="tl-create" onClick={openCreate}>
                  <PlusIcon />
                  Create
                </button>
              )}
            </div>

            <div className={`tl-chart${zoomId === 'weeks' ? ' is-weeks' : ''}`} style={{ width: chartWidth, '--day': `${dayWidth}px` }}>
              {todayVisible && (
                <div className="tl-today" style={{ left: todayIndex * dayWidth + dayWidth / 2 }} />
              )}
              <div className="tl-chart-head">
                <div className="tl-band">
                  {topGroups.map((group) => (
                    <div
                      key={`${group.label}-${group.index}`}
                      className={`tl-band-cell${group.isos.includes(today) ? ' is-today' : ''}`}
                      style={{ width: group.span * dayWidth }}
                    >
                      {group.label}
                    </div>
                  ))}
                </div>
                <div className="tl-band">
                  {bottomGroups
                    ? bottomGroups.map((group) => (
                      <div
                        key={group.key || `${group.label}-${group.index}`}
                        className={`tl-band-cell tl-band-sub${group.isos.includes(today) ? ' is-today' : ''}`}
                        style={{ width: group.span * dayWidth }}
                      >
                        {group.label}
                      </div>
                    ))
                    : columns.map((col) => (
                      <div
                        key={col.iso}
                        className={`tl-day${col.weekend ? ' is-weekend' : ''}${col.iso === today ? ' is-today' : ''}`}
                      >
                        {col.dayNum}
                      </div>
                    ))}
                </div>
              </div>

              <div className="tl-chart-body" ref={chartBodyRef} style={{ height: bodyHeight }}>
                {dayWidth >= 14 && columns.map((col, index) => (
                  col.weekend ? (
                    <div
                      key={col.iso}
                      className="tl-weekend"
                      style={{ left: index * dayWidth, width: dayWidth }}
                    />
                  ) : null
                ))}
                {columns.map((col, index) => (
                  col.monthStart && index > 0 ? (
                    <div key={`m-${col.iso}`} className="tl-month-line" style={{ left: index * dayWidth }} />
                  ) : null
                ))}

                {rows.map((row, index) => (
                  <div
                    key={row.ticket.id}
                    className={`tl-chart-row${hoverId === row.ticket.id ? ' is-hover' : ''}${modal.selected?.id === row.ticket.id ? ' is-selected' : ''}${linkOver === row.ticket.id ? ' is-link-target' : ''}${row.span ? '' : ' is-schedulable'}`}
                    style={{ top: index * ROW_H }}
                    onMouseEnter={() => setHoverId(row.ticket.id)}
                    onMouseLeave={() => setHoverId(null)}
                    onPointerDown={(event) => {
                      if (row.span) return;
                      startSchedule(event, row.ticket.id);
                    }}
                  />
                ))}

                {isAdmin && (
                  <div
                    className="tl-chart-row is-schedulable"
                    style={{ top: rows.length * ROW_H }}
                    onPointerDown={(event) => startSchedule(event, 'new')}
                  />
                )}

                <svg className="tl-deps" width={chartWidth} height={bodyHeight} aria-hidden="true">
                  <defs>
                    <marker id="tl-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                      <path d="M0 0 L8 4 L0 8 Z" fill="#626F86" />
                    </marker>
                    <marker id="tl-arrow-warn" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                      <path d="M0 0 L8 4 L0 8 Z" fill="#DE350B" />
                    </marker>
                  </defs>
                  {segments.map((segment) => (
                    <path
                      key={segment.id}
                      d={segment.d}
                      fill="none"
                      stroke={segment.conflict ? '#DE350B' : '#626F86'}
                      strokeWidth="1.5"
                      markerEnd={segment.conflict ? 'url(#tl-arrow-warn)' : 'url(#tl-arrow)'}
                    />
                  ))}
                  {linkPreview && (
                    <path d={linkPreview} fill="none" stroke="#0C66E4" strokeWidth="1.5" strokeDasharray="4 3" markerEnd="url(#tl-arrow)" />
                  )}
                </svg>

                {rows.map((row, index) => {
                  const span = spanOf(row);
                  if (!span) return null;
                  const box = barGeometry(range.start, span, dayWidth);
                  const drafting = draft?.id === row.ticket.id;
                  const parentBar = row.rolledUp || row.hasChildren;
                  const color = barColor(row.ticket, parentBar);
                  const done = isDone(row.ticket);
                  const label = `${ticketKey(row.ticket)} ${row.ticket.title}. ${prettyDate(span.start)} – ${prettyDate(span.end)}`;
                  return (
                    <div
                      key={row.ticket.id}
                      className={`tl-bar${parentBar ? ' is-parent' : ''}${done && !parentBar ? ' is-done' : ''}${drafting ? ' is-draft' : ''}`}
                      style={{ left: box.left, width: box.width, top: index * ROW_H + (parentBar ? 7 : 9), '--bar': color }}
                      role="button"
                      tabIndex={0}
                      title={row.rolledUp
                        ? `${label}. ${row.descendantDone} of ${row.descendantTotal} done. Drag to move this work and its children.`
                        : `${label}. Drag to reschedule.`}
                      aria-label={label}
                      onMouseEnter={() => setHoverId(row.ticket.id)}
                      onMouseLeave={() => setHoverId(null)}
                      onPointerDown={(event) => startDrag(event, row, 'move')}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          openTicket(row.ticket.id);
                        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                          event.preventDefault();
                          nudgeRow(row, event.key === 'ArrowLeft' ? -1 : 1);
                        }
                      }}
                    >
                      {parentBar && (
                        <span
                          className="tl-bar-fill"
                          style={{ width: `${Math.round(row.progress * 100)}%` }}
                        />
                      )}
                      {done && !parentBar && <span className="tl-check" aria-hidden="true">✓</span>}
                      {!drafting && !row.rolledUp && row.own && (
                        <>
                          <span
                            className="tl-resize tl-resize-start"
                            title="Drag to change the start date"
                            onPointerDown={(event) => startDrag(event, row, 'start')}
                          />
                          <span
                            className="tl-resize tl-resize-end"
                            title="Drag to change the due date"
                            onPointerDown={(event) => startDrag(event, row, 'end')}
                          />
                        </>
                      )}
                      {!drafting && (
                        <span
                          className="tl-depend"
                          title="Drag onto the work item this blocks"
                          onPointerDown={(event) => startLink(event, row)}
                        />
                      )}
                    </div>
                  );
                })}

                {draft?.id === 'new' && (
                  <div
                    className="tl-bar is-draft"
                    style={{
                      ...barGeometry(range.start, draft, dayWidth),
                      top: rows.length * ROW_H + 9,
                      '--bar': '#579DFF',
                    }}
                  />
                )}
              </div>
            </div>
          </div>
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
          onOpenTicket={openTicket}
        />
      )}

      {showCreate && (
        <CreateTicketModal
          employees={employees}
          projects={projects}
          defaultProjectId={project.id}
          defaultStartDate={createRange?.start || null}
          defaultDueDate={createRange?.end || null}
          onClose={() => {
            setShowCreate(false);
            setCreateRange(null);
          }}
          onCreate={async () => {
            setShowCreate(false);
            setCreateRange(null);
            try {
              await reloadTickets();
            } catch (err) {
              setError(err.message);
            }
          }}
        />
      )}
    </AppShell>
  );
}

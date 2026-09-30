'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AppShell from './AppShell';
import Avatar from './Avatar';
import ProjectTabs from './ProjectTabs';
import CreateTicketModal from './CreateTicketModal';
import TicketDetailModal from './ticket/TicketDetailModal';
import useTicketModal from './useTicketModal';
import ConfirmModal from './ConfirmModal';
import { HierarchyIcon } from './ticket/icons';
import ListOverflowMenu from './list/ListOverflowMenu';
import ListColumnsMenu from './list/ListColumnsMenu';
import ChartViewModal from './list/ChartViewModal';
import FormatRulesModal from './list/FormatRulesModal';
import ImportCsvModal from './list/ImportCsvModal';
import BulkBar from './list/BulkBar';
import FeedbackModal from './list/FeedbackModal';
import TicketRowMenu from './list/TicketRowMenu';
import RowMenuDialog from './list/RowMenuDialog';
import { useToasts, Toaster } from './Toaster';
import { isOverdue, matchRules, readViewPrefs, rowStyle, writeViewPrefs } from './list/viewPrefs';
import {
  STATUS_META,
  STATUS_ORDER,
  PRIORITY_META,
  PRIORITY_ORDER,
  TYPE_META,
  TYPE_ORDER,
  LOZENGE_TINTS,
  PriorityIcon,
  TypeIcon,
  formatListDateTime,
  formatListDate,
  ticketKey,
} from './meta';
import { buildTicketTree, countHidden, flattenTree, isDone } from '../lib/ticketTree';

// Items that run on click. The rest open a dialog or navigate first, so a
// destructive or structural change is never one stray click away.
const DIRECT_ACTIONS = new Set(['delete', 'archive', 'vote']);

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
  { key: 'category', label: 'Category' },
  { key: 'resolution', label: 'Resolution' },
  { key: 'created', label: 'Created' },
  { key: 'updated', label: 'Updated' },
  { key: 'due', label: 'Due date' },
];

const DEFAULT_HIDDEN = [];

// Jira tints the status lozenge by outcome, not by the board column colour:
// open work sits grey/blue and finished work sits green. The tints live in
// lib/ticketMeta so the calendar draws them from the same source.

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

function MenuCheck() {
  return (
    <span className="menu-check" aria-hidden="true">
      ✓
    </span>
  );
}

// Which parents are folded away is a per-project view preference, so it is
// remembered across visits. The closed set is what gets stored rather than the
// open one: a parent nobody has touched should show its children, and an
// "expanded" allowlist cannot tell "never seen" apart from "closed on purpose".
const COLLAPSED_KEY = (projectId) => `ticketing:collapsed-parents:${projectId}`;

function readCollapsed(projectId) {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(COLLAPSED_KEY(projectId));
    if (!raw) return new Set();
    const ids = JSON.parse(raw);
    return Array.isArray(ids) ? new Set(ids.map(Number).filter(Number.isInteger)) : new Set();
  } catch {
    return new Set();
  }
}

function writeCollapsed(projectId, ids) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(COLLAPSED_KEY(projectId), JSON.stringify([...ids]));
  } catch {
    // A full or blocked storage is not worth failing the view over.
  }
}

function EmptyState({ hasAny, filtered, onReset }) {  return (
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
  const router = useRouter();
  const [tickets, setTickets] = useState(initialTickets);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({ assignee: 'all', priority: 'all', status: 'all', type: 'all' });
  const [group, setGroup] = useState('none');
  const [sort, setSort] = useState({ key: 'created', dir: 'desc' });
  const [hidden, setHidden] = useState(() => new Set(DEFAULT_HIDDEN));
  const [selected, setSelected] = useState(() => new Set());
  const [collapsedGroups, setCollapsedGroups] = useState(() => new Set());
  const [collapsedParents, setCollapsedParents] = useState(() => new Set());
  const [openMenu, setOpen] = useState(null);
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [createParent, setCreateParent] = useState(null);
  const [error, setError] = useState('');

  // Saved view preferences, keyed per project so one project's toggles do not
  // leak into another's list.
  const [hideDone, setHideDone] = useState(false);
  const [showHierarchyPref, setShowHierarchyPref] = useState(true);
  const [formatRules, setFormatRules] = useState([]);
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [chartOpen, setChartOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [notice, setNotice] = useState('');
  // Which row's menu is open, and the dialog it handed off to. Both live here
  // rather than in the menu itself so a row action can close the menu and open
  // a dialog without the two fighting over unmounting.
  const [rowMenu, setRowMenu] = useState(null);
  const [rowDialog, setRowDialog] = useState(null);
  const [rowUsers, setRowUsers] = useState([]);
  const { toasts, push, dismiss, pause, resume } = useToasts();

  const rootRef = useRef(null);
  const projectId = project?.id ?? null;
  const isAdmin = currentUser.role === 'admin';
  // Moving a ticket is open to any signed-in user, matching the board.
  const canUpdate = true;

  // Load the saved folded branches whenever the project changes. Only the
  // toggle writes back, so mounting never clobbers the stored set with the
  // empty one this component starts with.
  useEffect(() => {
    setCollapsedParents(readCollapsed(projectId));
  }, [projectId]);

  // The saved preferences are re-read per project. Reading on mount only would
  // leave the previous project's toggles on screen when switching projects
  // without a remount.
  useEffect(() => {
    const prefs = readViewPrefs(projectId);
    setHideDone(prefs.hideDone);
    setShowHierarchyPref(prefs.showHierarchy);
    setFormatRules(prefs.formatRules);
    setSelected(new Set());
  }, [projectId]);

  // One write path for the three saved preferences, so a toggle can never
  // persist a stale copy of the other two.
  function savePrefs(patch) {
    const next = {
      hideDone: 'hideDone' in patch ? patch.hideDone : hideDone,
      showHierarchy: 'showHierarchy' in patch ? patch.showHierarchy : showHierarchyPref,
      formatRules: 'formatRules' in patch ? patch.formatRules : formatRules,
    };
    writeViewPrefs(projectId, next);
    if ('hideDone' in patch) setHideDone(next.hideDone);
    if ('showHierarchy' in patch) setShowHierarchyPref(next.showHierarchy);
    if ('formatRules' in patch) setFormatRules(next.formatRules);
  }

  function toggleParent(id) {
    setCollapsedParents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      writeCollapsed(projectId, next);
      return next;
    });
  }

  const visibleColumns = useMemo(
    () => COLUMNS.filter((c) => c.always || !hidden.has(c.key)),
    [hidden]
  );

  // Shared by the overflow menu's Columns section and the header's column
  // settings icon, so toggling one always matches the other.
  const columnsMenu = (
    <>
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
    </>
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
      // A finished work item is still there, it is just not listed, which is
      // why this sits with the other filters rather than after the sort.
      if (hideDone && isDone(t)) return false;
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
  }, [tickets, search, filters, hideDone]);

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
        case 'category':
          return (t.category || '￿').toLowerCase();
        case 'resolution':
          return isDone(t) ? 1 : 0;
        case 'created':
          return String(t.created_at || '');
        case 'updated':
          return String(t.updated_at || '');
        case 'due':
          return String(t.due_date || '￿');
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

  // Hierarchy is a view concern layered on top of the sorted flat list: the
  // sort applies to every ticket, and the tree just decides which rows end up
  // next to which. When a group is active the tree is bypassed entirely, since
  // a parent whose children sit in a different bucket cannot stay intact. The
  // saved preference is the other half of the condition: turning it off
  // flattens the list back to the sort order.
  const hierarchyActive = group === 'none' && showHierarchyPref;

  const tree = useMemo(() => buildTicketTree(sorted), [sorted]);

  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);

  // Ungrouped paginates rows. Grouped paginates whole groups, so the count in a
  // section header ("In Progress (3)") always reflects the full group rather
  // than whatever slice of it happens to land on the page.
  const paged = groups
    ? groups.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
    : sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  // Top-level count drives both the footer and pagination, the way Jira counts
  // a parent as one row and hides however many children it has.
  const topLevelCount = hierarchyActive
    ? tree.roots.length
    : groups
      ? groups.reduce((sum, g) => sum + g.rows.length, 0)
      : total;
  const topLevelPageCount = Math.max(1, Math.ceil(topLevelCount / PAGE_SIZE));
  const safeTopLevelPage = Math.min(safePage, topLevelPageCount);

  // Slice the tree to the current page of top-level rows, then flatten, so a
  // parent on page 2 never drags its children onto page 1.
  const visibleNodes = useMemo(() => {
    if (!hierarchyActive) return [];
    const roots = tree.roots.slice(
      (safeTopLevelPage - 1) * PAGE_SIZE,
      safeTopLevelPage * PAGE_SIZE
    );
    return flattenTree(roots, collapsedParents);
  }, [hierarchyActive, tree, collapsedParents, safeTopLevelPage]);

  // Any change to the inputs invalidates the current page number.
  useEffect(() => {
    setPage(1);
  }, [search, filters, group, sort]);

  // Visible rows in draw order, which is also the order the modal's previous /
  // next chevrons walk.
  // Children that exist but are not on screen because a branch above them is
  // folded away.
  const hiddenChildren = useMemo(
    () => (hierarchyActive ? countHidden(tree.roots, collapsedParents) : 0),
    [hierarchyActive, tree, collapsedParents]
  );

  const pageRows = hierarchyActive
    ? visibleNodes.map((n) => n.ticket)
    : groups
      ? paged.flatMap((g) => g.rows)
      : paged;
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
    setCollapsedGroups((prev) => {
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

  /**
   * The one write path for a ticket change. Status, assignee and bulk edits all
   * go through here, so the optimistic update, the server response and the
   * rollback behave identically whichever entry point was used.
   */
  const patchTicket = useCallback(
    async (id, fields, { rollbackTo } = {}) => {
      setError('');
      setTickets((ts) =>
        ts.map((t) => {
          if (t.id !== id) return t;
          const next = { ...t, ...fields };
          if ('employee_id' in fields) {
            const employee = employees.find((e) => e.id === Number(fields.employee_id));
            next.employee_id = employee ? employee.id : null;
            next.employee_name = employee?.name || null;
          }
          return next;
        })
      );

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
        return data.ticket;
      } catch (e) {
        // Only this row goes back; anything that already succeeded stays put.
        setTickets((ts) => {
          if (!rollbackTo) return ts;
          const prior = rollbackTo.find((t) => t.id === id);
          return prior ? ts.map((t) => (t.id === id ? prior : t)) : ts;
        });
        throw e;
      }
    },
    [employees]
  );

  async function updateStatus(id, status) {
    try {
      await patchTicket(id, { status }, { rollbackTo: tickets });
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleReassign(id, employeeId) {
    try {
      await patchTicket(
        id,
        { employee_id: employeeId ? Number(employeeId) : null },
        { rollbackTo: tickets }
      );
    } catch (e) {
      setError(e.message);
    }
  }

  /**
   * Bulk change, reusing the single-row PATCH rather than a second write path.
   * Applied one ticket at a time with an optimistic update and a rollback, the
   * same contract the status editor has, so a partial failure leaves the rows
   * that did succeed correct instead of reverting all of them.
   */
  async function bulkApply(fields) {
    const ids = [...selected];
    if (ids.length === 0) return;

    setBulkBusy(true);
    setError('');
    setNotice('');

    // patchTicket paints each row as it goes, which is the same optimistic
    // contract the single-row editors have.
    const previous = tickets;

    const failures = [];
    for (const id of ids) {
      try {
        await patchTicket(id, fields, { rollbackTo: previous });
      } catch (e) {
        failures.push(`${ticketKey(previous.find((t) => t.id === id) || { id })}: ${e.message}`);
      }
    }

    setBulkBusy(false);

    if (failures.length > 0) {
      // Each failed row rolled itself back, so the table already shows the
      // server's state and only the failures need reporting.
      setError(failures.join(' · '));
    } else {
      setNotice(`Updated ${ids.length} ${ids.length === 1 ? 'work item' : 'work items'}.`);
      setSelected(new Set());
      setBulkMode(false);
    }
  }

  async function bulkDelete() {
    const ids = [...selected];
    if (ids.length === 0) return;

    setBulkBusy(true);
    setError('');
    setNotice('');

    const previous = tickets;
    setTickets((ts) => ts.filter((t) => !selected.has(t.id)));

    const failures = [];
    let reparented = 0;
    for (const id of ids) {
      try {
        const res = await fetch(`/api/tickets/${id}`, { method: 'DELETE' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Delete failed.');
        reparented += data.reparentedChildren || 0;
      } catch (e) {
        failures.push(`${id}: ${e.message}`);
      }
    }

    setBulkBusy(false);
    setConfirmDelete(false);

    if (failures.length > 0) {
      setTickets(previous);
      setError(failures.join(' · '));
    } else {
      setSelected(new Set());
      setBulkMode(false);
      setNotice(
        `Deleted ${ids.length} ${ids.length === 1 ? 'work item' : 'work items'}.` +
          (reparented > 0
            ? ` ${reparented} child ${reparented === 1 ? 'work was' : 'works were'} moved up a level.`
            : '')
      );
    }
  }

  // The chevrons walk the rows actually on screen, which is the page slice when
  // the list is paginated.
  const modal = useTicketModal({ visible: pageRows, lookup: tickets });

  const applyTicketUpdate = useCallback((next) => {
    if (!next) return;
    setTickets((ts) => ts.map((t) => (t.id === next.id ? { ...t, ...next } : t)));
  }, []);

  function openTicket(id) {
    const found = tickets.find((t) => t.id === id);
    if (found) modal.select(found);
  }

  // Open the create modal pre-loaded with this row as the parent, and open the
  // parent afterwards so the new child is visible without hunting for it.
  function addChildTo(parent) {
    setCreateParent(parent);
    setShowCreate(true);
  }

  function toggleRowMenu(t, anchor) {
    setRowMenu((cur) => (cur?.id === t.id ? null : { id: t.id, anchor }));
    setRowDialog(null);
  }

  const closeRowMenu = useCallback(() => setRowMenu(null), []);

  async function openRowAction(key, ticket) {
    setError('');
    setNotice('');

    // These only jump somewhere or copy, so they never open a dialog.
    if (key === 'view' || key === 'comment' || key === 'log' || key === 'attach') {
      // Comment, Log work and Attach files are all fields inside the detail
      // modal, so the modal is the only place they can be filled in.
      return openTicket(ticket.id);
    }

    if (key === 'copylink') {
      const link = `${window.location.origin}/projects/${ticket.project_id}/list?issue=${ticket.id}`;
      return copyText(link, 'Link copied.');
    }

    if (key === 'copykey') {
      return copyText(ticketKey(ticket), `${ticketKey(ticket)} copied.`);
    }

    // The rest open a dialog. Watchers and voters need data the rows do not
    // carry, so that is fetched by the dialog itself.
    return setRowDialog({ key, ticket });
  }

  // Clipboard writes are async and can be denied, so both paths report through
  // the toast rather than failing silently.
  async function copyText(text, message) {
    try {
      await navigator.clipboard.writeText(text);
      push({ message });
    } catch {
      push({ message: 'Could not copy to the clipboard.', tone: 'error' });
    }
  }

  async function runRowAction(key, ticket) {
    // Everything past this point is a mutation the user has committed to.
    try {
      if (key === 'delete') {
        const res = await fetch(`/api/tickets/${ticket.id}`, { method: 'DELETE' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Delete failed.');
        setTickets((ts) => ts.filter((x) => x.id !== ticket.id));
        setSelected(new Set());
        push({
          message: `Deleted ${ticketKey(ticket)}.`,
          action: { label: 'Undo', onClick: () => restoreDeleted(ticket) },
        });
        return;
      }

      if (key === 'archive') {
        const archived = ticket;
        await patchTicket(ticket.id, { archived: true });
        // Archived work leaves the working list, so it goes with it. The toast
        // holds the only handle to bring it back.
        setTickets((ts) => ts.filter((x) => x.id !== ticket.id));
        push({
          message: `Archived ${ticketKey(ticket)}.`,
          action: {
            label: 'Undo',
            onClick: () => unarchiveRow(archived),
          },
        });
        return;
      }

      // Voting is a one-click toggle: the item already reads "Add vote", so it
      // only opens the list when the user has already voted and is undoing it.
      if (key === 'vote') {
        const res = await fetch(`/api/tickets/${ticket.id}/votes`);
        const before = await res.json();
        const already = before.voted;
        const action = already ? 'DELETE' : 'POST';
        const done = await fetch(`/api/tickets/${ticket.id}/votes`, { method: action });
        const after = await done.json();
        if (!done.ok) throw new Error(after.error || 'Could not update your vote.');
        setRowDialog({ key: 'voters', ticket });
        push({ message: already ? 'Vote removed.' : 'Vote added.' });
        return;
      }

      if (key === 'subtask' || key === 'clone' || key === 'move' || key === 'link' || key === 'weblink' || key === 'slack' || key === 'watch' || key === 'voters' || key === 'watchers') {
        return setRowDialog({ key, ticket });
      }
    } catch (e) {
      setError(e.message);
      push({ message: e.message, tone: 'error' });
    }
    return undefined;
  }

  // Restoring an archived row from the toast. patchTicket maps over existing
  // rows, but the archive flow removed this one, so it is re-inserted here
  // rather than left to silently not come back.
  async function unarchiveRow(ticket) {
    try {
      const res = await fetch(`/api/tickets/${ticket.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived: false }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not restore the work item.');
      setTickets((ts) => {
        if (ts.some((x) => x.id === ticket.id)) {
          return ts.map((x) => (x.id === ticket.id ? { ...x, ...data.ticket } : x));
        }
        return [...ts, { ...ticket, ...data.ticket }].sort((a, b) => b.id - a.id);
      });
      push({ message: `Restored ${ticketKey(ticket)}.` });
    } catch (e) {
      push({ message: e.message, tone: 'error' });
    }
  }

  // Undo for delete. The row is gone, so it is re-inserted at its old position
  // rather than appended, which keeps the list from reordering under the user.
  async function restoreDeleted(ticket) {
    try {
      const res = await fetch(`/api/tickets/${ticket.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: ticket.project_id,
          title: ticket.title,
          status: ticket.status,
          priority: ticket.priority,
          type: ticket.type,
          parent_id: ticket.parent_id ?? null,
          labels: ticket.labels,
          employee_id: ticket.employee_id,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not restore the work item.');
      setTickets((ts) => [...ts, { ...ticket, ...data.ticket }].sort((a, b) => b.id - a.id));
      push({ message: `Restored ${ticketKey(ticket)}.` });
    } catch (e) {
      push({ message: e.message, tone: 'error' });
    }
  }

  function renderRow(node) {
    const t = node.ticket;
    const depth = node.depth;
    const hasChildren = node.hasChildren;
    const isOpen = !collapsedParents.has(t.id);
    const priority = PRIORITY_META[t.priority];
    const done = isDone(t);
    const lozenge = LOZENGE_TINTS[t.status] || LOZENGE_TINTS.open;
    const isSelected = selected.has(t.id);

    // Conditional formatting is evaluated per render, so a saved rule shows up
    // on the row without any extra state to keep in sync. The background goes
    // through a custom property because each cell paints its own surface, which
    // would otherwise cover a background set on the row itself.
    const effects = matchRules(t, formatRules).map((r) => r.effect);
    const style = rowStyle(effects);

    return (
      <tr
        key={t.id}
        className={`list-row${isSelected ? ' is-selected' : ''}${depth > 0 ? ' is-child' : ''}${style['--fmt-bg'] ? ' is-formatted' : ''}`}
        aria-selected={isSelected}
        style={Object.keys(style).length ? style : undefined}
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
          {hasChildren ? (
            <button
              type="button"
              className={`list-tree-toggle${isOpen ? ' is-open' : ''}`}
              onClick={() => toggleParent(t.id)}
              aria-expanded={isOpen}
              aria-label={`${isOpen ? 'Collapse' : 'Expand'} child work items of ${ticketKey(t)}`}
              title={`${node.childCount} child work ${node.childCount === 1 ? 'item' : 'items'}`}
            >
              <CaretIcon open={isOpen} />
            </button>
          ) : (
            <span className="list-expand-slot" aria-hidden="true" />
          )}
        </td>

        <td className="list-cell list-cell-work">
          <span className="list-work" style={{ paddingLeft: `${depth * 20}px` }}>
            {/* A reserved gutter, so the "+" revealed on hover never overlaps
                or nudges the row content (or the Assignee column). */}
            {isAdmin && (
              <span className="list-add-child-slot">
                <button
                  type="button"
                  className="list-add-child"
                  onClick={() => addChildTo(t)}
                  title={`Add a child work item to ${ticketKey(t)}`}
                  aria-label={`Add a child work item to ${ticketKey(t)}`}
                >
                  <PlusIcon />
                </button>
              </span>
            )}
            {hasChildren && !isOpen && (
              <span className="list-child-count" title={`${node.childCount} hidden child work items`}>
                {node.childCount}
              </span>
            )}
            {hasChildren && (
              <span className="list-hierarchy-icon" title="Has child work items" aria-label="Parent ticket">
                <HierarchyIcon size={12} />
              </span>
            )}
            <span className="card-type-icon is-plain" title={(TYPE_META[t.type] || TYPE_META.task).label}>
              <TypeIcon type={t.type} size={12} />
            </span>
            <button type="button" className={`list-key${done ? ' is-done' : ''}`} onClick={() => openTicket(t.id)}>
              {ticketKey(t)}
            </button>
            <button type="button" className={`list-title${done ? ' is-done' : ''}`} onClick={() => openTicket(t.id)}>
              {t.title}
            </button>
            {hasChildren && node.doneCount > 0 && (
              <span className="list-child-progress" title={`${node.doneCount} of ${node.childCount} children done`}>
                {node.doneCount}/{node.childCount} done
              </span>
            )}
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
              <span
                className={`list-lozenge${canUpdate ? ' is-editable' : ''}`}
                style={{ background: lozenge.bg, color: lozenge.text }}
              >
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

        {visibleColumns.some((c) => c.key === 'category') && (
          <td className={`list-cell${t.category ? '' : ' list-cell-muted'}`}>
            {t.category || 'None'}
          </td>
        )}

        {visibleColumns.some((c) => c.key === 'resolution') && (
          <td className="list-cell list-cell-muted">
            {done ? STATUS_META[t.status].label : 'Unresolved'}
          </td>
        )}

        {visibleColumns.some((c) => c.key === 'created') && (
          <td className="list-cell list-cell-muted list-cell-date">
            {formatListDateTime(t.created_at)}
          </td>
        )}

        {visibleColumns.some((c) => c.key === 'updated') && (
          <td className="list-cell list-cell-muted list-cell-date">
            {formatListDateTime(t.updated_at)}
          </td>
        )}

        {visibleColumns.some((c) => c.key === 'due') && (
          <td className="list-cell list-cell-muted list-cell-date">
            {t.due_date ? formatListDate(t.due_date) : 'None'}
          </td>
        )}

        <td className="list-cell list-cell-columns" aria-hidden="true" />

        <td className="list-cell list-cell-more">
          <button
            type="button"
            className="list-row-more"
            onClick={(e) => toggleRowMenu(t, e.currentTarget)}
            aria-label={`More actions for ${ticketKey(t)}`}
            aria-haspopup="menu"
            aria-expanded={rowMenu?.id === t.id}
          >
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
      projectId={projectId == null ? null : String(projectId)}
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

        {notice && (
          <div className="notice-banner" role="status">
            {notice}
            <button type="button" onClick={() => setNotice('')} aria-label="Dismiss">
              ×
            </button>
          </div>
        )}

        <div className="board-toolbar">
          <div className="toolbar-title">
            <nav className="breadcrumb" aria-label="Breadcrumb">
              <Link href="/projects">Projects</Link>
              <span className="breadcrumb-sep" aria-hidden="true">/</span>
              <span>{project?.name || 'All work items'}</span>
            </nav>
            <div className="toolbar-title-row">
              <span
                className="project-icon project-icon-sm"
                style={{ background: project?.color || 'var(--primary)' }}
                aria-hidden="true"
              >
                {(project?.name || 'All').charAt(0).toUpperCase()}
              </span>
              <h1>{project?.name || 'All work items'}</h1>
            </div>
            <p className="board-subtitle">
              {project?.description || 'Every work item across every project in this workspace.'}
            </p>
          </div>
        </div>

        {/* The project tab strip has no meaning without a single project, so
            the cross-project list shows the heading on its own. */}
        {project && <ProjectTabs projectId={projectId} active="list" />}

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
                      setCollapsedGroups(new Set());
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

          <ListOverflowMenu
            isAdmin={isAdmin}
            hideDone={hideDone}
            showHierarchy={showHierarchyPref}
            selectedCount={selected.size}
            scopeId={projectId}
            scopeName={project?.name}
            visibleColumns={visibleColumns}
            rows={sorted}
            columns={columnsMenu}
            resetView={() => {
              setSearch('');
              setFilters({ assignee: 'all', priority: 'all', status: 'all', type: 'all' });
              setGroup('none');
              setSort({ key: 'created', dir: 'desc' });
              setHidden(new Set(DEFAULT_HIDDEN));
              setPage(1);
            }}
            onToggleHideDone={() => savePrefs({ hideDone: !hideDone })}
            onToggleHierarchy={() => savePrefs({ showHierarchy: !showHierarchyPref })}
            onOpenChart={() => setChartOpen(true)}
            onOpenFormatRules={() => setRulesOpen(true)}
            onOpenImport={() => setImportOpen(true)}
            onOpenBulk={() => setBulkMode(true)}
            onGoToAll={() => router.push('/work-items')}
            onOpenFeedback={() => setFeedbackOpen(true)}
          />
        </div>

        <div className="list-frame">
          {groups && (
            <p className="list-hierarchy-note" role="status">
              Hierarchy hidden while grouped. Turn grouping off to see parent and child rows together.
            </p>
          )}
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

                  <th className="list-th list-th-columns" scope="col">
                    <ListColumnsMenu>{columnsMenu}</ListColumnsMenu>
                  </th>

                  <th className="list-th list-cell-more" scope="col">
                    <span className="list-more-hint" aria-hidden="true">
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
                        <circle cx="5" cy="12" r="1.8" />
                        <circle cx="12" cy="12" r="1.8" />
                        <circle cx="19" cy="12" r="1.8" />
                      </svg>
                    </span>
                  </th>
                </tr>
              </thead>

                <tbody>
                {groups
                  ? paged.map((g) => {
                      const isCollapsed = collapsedGroups.has(g.label);
                      return [
                        <tr
                          key={`g-${g.label}`}
                          className="list-group-row"
                          aria-expanded={!isCollapsed}
                        >
                          <td className="list-group-cell" colSpan={visibleColumns.length + 4}>
                            <button type="button" className="list-group-btn" onClick={() => toggleGroup(g.label)}>
                              <CaretIcon open={!isCollapsed} />
                              <span className="list-group-name">{g.label}</span>
                              <span className="list-group-count">({g.rows.length})</span>
                            </button>
                          </td>
                        </tr>,
                        ...(isCollapsed ? [] : g.rows.map((t) => renderRow({ ticket: t, depth: 0, hasChildren: false, childCount: 0, doneCount: 0 }))),
                      ];
                    })
                  // With the tree switched off the flat, sorted page is the row
                  // set; visibleNodes is empty in that case by design.
                  : hierarchyActive
                    ? visibleNodes.map(renderRow)
                    : paged.map((t) => renderRow({ ticket: t, depth: 0, hasChildren: false, childCount: 0, doneCount: 0 }))}
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
                {safeTopLevelPage * PAGE_SIZE >= topLevelCount
                  ? topLevelCount
                  : (safeTopLevelPage - 1) * PAGE_SIZE + 1}
                {'–'}
                {Math.min(safeTopLevelPage * PAGE_SIZE, topLevelCount)} of {topLevelCount}
              </span>
              {hiddenChildren > 0 && (
                <span className="list-count-note">
                  {' · '}
                  {hiddenChildren} nested {hiddenChildren === 1 ? 'item' : 'items'}
                </span>
              )}
              {selected.size > 0 && (
                <span className="list-selected-note">{selected.size} selected</span>
              )}
              {bulkMode && selected.size === 0 && (
                <span className="list-selected-note">Tick rows to bulk edit</span>
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
                  setCollapsedGroups(new Set());
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

        {bulkMode && selected.size > 0 && (
          <BulkBar
            count={selected.size}
            employees={employees}
            isAdmin={isAdmin}
            busy={bulkBusy}
            onApply={bulkApply}
            onDelete={() => setConfirmDelete(true)}
            onClear={() => {
              setSelected(new Set());
              setBulkMode(false);
            }}
          />
        )}

        {topLevelPageCount > 1 && (
          <div className="list-pager">
            <button type="button" className="btn-ghost" disabled={safeTopLevelPage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              Previous
            </button>
            <span>{`Page ${safeTopLevelPage} of ${topLevelPageCount}`}</span>
            <button type="button" className="btn-ghost" disabled={safeTopLevelPage >= topLevelPageCount} onClick={() => setPage((p) => Math.min(topLevelPageCount, p + 1))}>
              Next
            </button>
          </div>
        )}
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

      {chartOpen && (
        <ChartViewModal
          tickets={sorted}
          scopeLabel={project?.name ? `${project.name} work items` : 'Work items'}
          onClose={() => setChartOpen(false)}
        />
      )}

      {rulesOpen && (
        <FormatRulesModal
          rules={formatRules}
          onSave={(next) => {
            savePrefs({ formatRules: next });
            setRulesOpen(false);
          }}
          onClose={() => setRulesOpen(false)}
        />
      )}

      {importOpen && (
        <ImportCsvModal
          projectId={projectId}
          employees={employees}
          onClose={() => setImportOpen(false)}
          onImported={async ({ created, failures }) => {
            setImportOpen(false);
            if (created.length > 0) {
              const res = await fetch('/api/tickets');
              const data = await res.json();
              if (res.ok) {
                setTickets(
                  projectId == null
                    ? data.tickets
                    : data.tickets.filter((t) => t.project_id === projectId)
                );
              }
              setPage(1);
            }
            setNotice(
              `Imported ${created.length} ${created.length === 1 ? 'work item' : 'work items'}.` +
                (failures.length > 0 ? ` ${failures.length} failed: ${failures.map((f) => `line ${f.line} (${f.message})`).join('; ')}` : '')
            );
          }}
        />
      )}

      {feedbackOpen && (
        <FeedbackModal
          scopeId={projectId ?? 'all'}
          scopeName={project?.name}
          onClose={() => setFeedbackOpen(false)}
        />
      )}

      {confirmDelete && (
        <ConfirmModal
          title="Delete work items"
          message={
            selected.size === 1
              ? 'This permanently deletes the selected work item. Any child work items move up a level rather than being deleted.'
              : `This permanently deletes ${selected.size} work items. Any child work items move up a level rather than being deleted.`
          }
          confirmLabel="Delete"
          onCancel={() => setConfirmDelete(false)}
          onConfirm={bulkDelete}
        />
      )}

      {showCreate && (
        <CreateTicketModal
          employees={employees}
          projects={projects}
          defaultProjectId={projectId}
          parent={createParent}
          onClose={() => {
            setShowCreate(false);
            setCreateParent(null);
          }}
          onCreate={async (created) => {
            setShowCreate(false);
            const parent = createParent;
            setCreateParent(null);
            const res = await fetch('/api/tickets');
            const data = await res.json();
            if (!res.ok) return;
            setTickets(data.tickets.filter((t) => t.project_id === projectId));
            // Make sure the branch that just grew is open, so the new child is
            // on screen without the user having to go looking for it.
            if (parent) {
              setCollapsedParents((prev) => {
                const next = new Set(prev);
                next.delete(parent.id);
                return next;
              });
            }
            if (created) {
              const found = tickets.find((t) => t.id === parent?.id);
              if (found) modal.select(found);
            }
          }}
        />
      )}
      {rowMenu && (() => {
        const ticket = tickets.find((t) => t.id === rowMenu.id);
        // The row can vanish mid-menu, e.g. archived from a different surface.
        if (!ticket) return null;
        return (
          <TicketRowMenu
            open
            ticket={ticket}
            anchor={rowMenu.anchor}
            // Everything routes through one of the two handlers, so the menu
            // itself does not have to know which items are safe to run directly.
            onOpen={(key) => {
              if (DIRECT_ACTIONS.has(key)) runRowAction(key, ticket);
              else openRowAction(key, ticket);
            }}
            onClose={closeRowMenu}
          />
        );
      })()}

      {rowDialog && (
        <RowMenuDialog
          state={rowDialog}
          tickets={tickets}
          projects={projects}
          projectId={projectId}
          employees={employees}
          currentUser={currentUser}
          isAdmin={isAdmin}
          onClose={() => setRowDialog(null)}
          onPatch={patchTicket}
          onMove={async (id, patch) => {
            const t = tickets.find((x) => x.id === id);
            const updated = await patchTicket(id, patch);
            // A move into another project takes the row with it: this page is
            // scoped to one project, so keeping a cross-project row sitting in
            // the table would show work that belongs somewhere else.
            if (patch.project_id != null && t && Number(patch.project_id) !== t.project_id) {
              setTickets((ts) => ts.filter((x) => x.id !== id));
            }
            return updated;
          }}
          onCreate={async (payload) => {
            const res = await fetch('/api/tickets', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Could not create the work item.');
            setTickets((ts) => [data.ticket, ...ts]);
            return data.ticket;
          }}
          onError={(m) => {
            setError(m);
            push({ message: m, tone: 'error' });
          }}
          onDone={(message, action) => push({ message, action })}
        />
      )}

      <Toaster toasts={toasts} onDismiss={dismiss} onPause={pause} onResume={resume} />
    </AppShell>
  );
}

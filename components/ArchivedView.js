'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppShell from './AppShell';
import Avatar from './Avatar';
import EmptyState from './EmptyState';
import PageHeader from './PageHeader';
import ProjectTabs from './ProjectTabs';
import ArchiveDialog from './ArchiveDialog';
import TicketDetailModal from './ticket/TicketDetailModal';
import useTicketModal from './useTicketModal';
import { useToasts, Toaster } from './Toaster';
import { mergeArchiveChange } from './archiveChange';
import { ArchiveIcon } from './ticket/icons';
import {
  LOZENGE_TINTS,
  PRIORITY_META,
  PRIORITY_ORDER,
  PriorityIcon,
  STATUS_META,
  STATUS_ORDER,
  TYPE_META,
  TYPE_ORDER,
  TypeIcon,
  formatListDateTime,
  ticketKey,
} from './meta';

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.35-4.35" />
    </svg>
  );
}

function Chevron() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function SortArrow({ dir }) {
  if (!dir) return null;
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true">
      <path d={dir === 'asc' ? 'M12 6l6 8H6l6-8Z' : 'M12 18l-6-8h12l-6 8Z'} />
    </svg>
  );
}

const COLUMNS = [
  { key: 'key', label: 'Key' },
  { key: 'title', label: 'Summary' },
  { key: 'priority', label: 'Priority' },
  { key: 'status', label: 'Status' },
  { key: 'assignee', label: 'Assignee' },
  { key: 'archived', label: 'Archived' },
  { key: 'archivedBy', label: 'Archived by' },
];

function rank(order, value) {
  const index = order.indexOf(value);
  return index === -1 ? order.length : index;
}

function compare(a, b, key) {
  if (key === 'key') return a.id - b.id;
  if (key === 'title') return a.title.localeCompare(b.title);
  if (key === 'priority') return rank(PRIORITY_ORDER, a.priority) - rank(PRIORITY_ORDER, b.priority);
  if (key === 'status') return rank(STATUS_ORDER, a.status) - rank(STATUS_ORDER, b.status);
  if (key === 'assignee') return (a.employee_name || '').localeCompare(b.employee_name || '');
  if (key === 'archivedBy') return (a.archived_by_name || '').localeCompare(b.archived_by_name || '');
  return String(a.archived_at || '').localeCompare(String(b.archived_at || ''));
}

/**
 * Archived work items, laid out like Jira's archived list.
 *
 * The rows are findable, filterable, and restorable. They are not edited from
 * this table: opening one shows the work item, with a banner and a Restore
 * action, and restoring is what puts it back on the board.
 */
export default function ArchivedView({
  initialTickets,
  project,
  projects,
  projectCounts,
  myIssuesCount,
  employees = [],
  currentUser,
}) {
  const [tickets, setTickets] = useState(initialTickets);
  const [query, setQuery] = useState('');
  const [type, setType] = useState('all');
  const [status, setStatus] = useState('all');
  const [priority, setPriority] = useState('all');
  const [assignee, setAssignee] = useState('all');
  const [sort, setSort] = useState({ key: 'archived', dir: 'desc' });
  const [selected, setSelected] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [prompt, setPrompt] = useState(null);
  const router = useRouter();
  const { toasts, push, dismiss, pause, resume } = useToasts();
  const modal = useTicketModal({ visible: tickets, lookup: tickets });

  function openTicket(id) {
    const found = tickets.find((ticket) => ticket.id === id);
    if (found) modal.select(found);
  }

  function toggleSort(key) {
    setSort((current) =>
      current.key === key
        ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'archived' ? 'desc' : 'asc' }
    );
  }

  const people = useMemo(() => {
    const names = new Map();
    for (const ticket of tickets) {
      if (ticket.employee_id) names.set(ticket.employee_id, ticket.employee_name || 'Assignee');
    }
    return [...names.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [tickets]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rows = tickets.filter((ticket) => {
      if (type !== 'all' && ticket.type !== type) return false;
      if (status !== 'all' && ticket.status !== status) return false;
      if (priority !== 'all' && ticket.priority !== priority) return false;
      if (assignee === 'unassigned' && ticket.employee_id) return false;
      if (assignee !== 'all' && assignee !== 'unassigned' && String(ticket.employee_id) !== assignee) return false;
      if (!needle) return true;
      const haystack = [
        ticket.title,
        ticketKey(ticket),
        ticket.employee_name,
        ticket.archived_by_name,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(needle);
    });
    const direction = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => compare(a, b, sort.key) * direction);
  }, [tickets, query, type, status, priority, assignee, sort]);

  const visibleIds = visible.map((ticket) => ticket.id);
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const someSelected = visibleIds.some((id) => selected.has(id));

  function toggleAll() {
    setSelected((current) => {
      const next = new Set(current);
      if (allSelected) visibleIds.forEach((id) => next.delete(id));
      else visibleIds.forEach((id) => next.add(id));
      return next;
    });
  }

  function toggleOne(id) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function writeArchived(list, archived, includeChildren) {
    const affected = [];
    for (const ticket of list) {
      const res = await fetch(`/api/tickets/${ticket.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived, includeChildren }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not update the work item.');
      affected.push(...(data.affected || [data.ticket]));
    }
    return affected;
  }

  async function restoreTickets(list, includeChildren) {
    setBusy(true);
    try {
      const affected = await writeArchived(list, false, includeChildren);
      setTickets((current) => mergeArchiveChange(current, { archived: false, tickets: affected }, 'archived'));
      setSelected(new Set());
      const extra = Math.max(0, affected.length - list.length);
      const message = list.length === 1
        ? extra > 0
          ? `Restored ${ticketKey(list[0])} and ${extra} child work ${extra === 1 ? 'item' : 'items'}.`
          : `Restored ${ticketKey(list[0])}.`
        : `Restored ${list.length} work items.`;
      push({
        message,
        action: {
          label: 'Undo',
          onClick: () => rearchive(affected),
        },
      });
      router.refresh();
    } catch (error) {
      push({ message: error.message, tone: 'error' });
    } finally {
      setBusy(false);
      setPrompt(null);
    }
  }

  async function rearchive(list) {
    try {
      const affected = await writeArchived(list, true, false);
      setTickets((current) => mergeArchiveChange(current, { archived: true, tickets: affected }, 'archived'));
      push({
        message: affected.length === 1
          ? `Re-archived ${ticketKey(affected[0])}.`
          : `Re-archived ${affected.length} work items.`,
      });
    } catch (error) {
      push({ message: error.message, tone: 'error' });
    }
  }

  function askRestore(list) {
    const childCount = list.reduce((sum, ticket) => sum + (Number(ticket.archived_child_count) || 0), 0);
    if (childCount > 0) {
      setPrompt({ tickets: list, childCount });
      return;
    }
    restoreTickets(list, false);
  }

  return (
    <AppShell
      currentUser={currentUser}
      projects={projects}
      projectCounts={projectCounts}
      myIssuesCount={myIssuesCount}
      projectId={project.id}
      onProjectChange={(id) => router.push(`/projects/${id}/archived`)}
    >
      <div className="board">
        <PageHeader
          breadcrumb={[
            { label: 'Projects', href: '/projects' },
            { label: project.name, href: `/projects/${project.id}/summary` },
            { label: 'Archived' },
          ]}
          title="Archived work items"
          icon={
            <span
              className="project-icon project-icon-sm"
              style={{ background: project.color || 'var(--primary)' }}
              aria-hidden="true"
            >
              <ArchiveIcon size={14} />
            </span>
          }
          subtitle={
            tickets.length === 0
              ? 'Nothing archived in this project.'
              : `${tickets.length} archived ${tickets.length === 1 ? 'work item' : 'work items'}.`
          }
        />

        <ProjectTabs projectId={project.id} active="archived" />

        <div className="archive-banner" role="note">
          <ArchiveIcon size={18} />
          <div>
            <strong>Archived work is hidden from the board, list, calendar, and reports.</strong>
            <p>Restore a work item to bring it back in the status it had when it was archived.</p>
          </div>
        </div>

        {tickets.length === 0 ? (
          <EmptyState
            icon={
              <svg viewBox="0 0 64 48" width="64" height="48" aria-hidden="true">
                <rect x="10" y="11" width="32" height="10" rx="3" fill="#DFE1E6" />
                <path d="M14 21v15a3 3 0 003 3h18a3 3 0 003-3V21" stroke="#DFE1E6" strokeWidth="3" strokeLinecap="round" fill="none" />
                <rect x="22" y="28" width="10" height="3" rx="1.5" fill="#EBECF0" />
              </svg>
            }
            title="No archived work items"
            text="Archive a work item from the list or from its detail view. It will show up here, and you can restore it at any time."
          />
        ) : (
          <>
            <div className="list-toolbar">
              <div className="search-field list-search">
                <SearchIcon />
                <input
                  type="search"
                  placeholder="Search archived work items"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  aria-label="Search archived work items"
                />
              </div>

              <label className="select-field">
                <select value={type} onChange={(event) => setType(event.target.value)} aria-label="Filter by type">
                  <option value="all">All types</option>
                  {TYPE_ORDER.map((key) => (
                    <option key={key} value={key}>{TYPE_META[key].label}</option>
                  ))}
                </select>
                <Chevron />
              </label>
              <label className="select-field">
                <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter by status">
                  <option value="all">All statuses</option>
                  {STATUS_ORDER.map((key) => (
                    <option key={key} value={key}>{STATUS_META[key].label}</option>
                  ))}
                </select>
                <Chevron />
              </label>
              <label className="select-field">
                <select value={priority} onChange={(event) => setPriority(event.target.value)} aria-label="Filter by priority">
                  <option value="all">All priorities</option>
                  {PRIORITY_ORDER.map((key) => (
                    <option key={key} value={key}>{PRIORITY_META[key].label}</option>
                  ))}
                </select>
                <Chevron />
              </label>
              <label className="select-field">
                <select value={assignee} onChange={(event) => setAssignee(event.target.value)} aria-label="Filter by assignee">
                  <option value="all">All assignees</option>
                  <option value="unassigned">Unassigned</option>
                  {people.map(([id, name]) => (
                    <option key={id} value={id}>{name}</option>
                  ))}
                </select>
                <Chevron />
              </label>
            </div>

            <div className="list-frame">
              <div className="list-scroll">
                <table className="list-table">
                  <thead>
                    <tr>
                      <th className="list-th list-cell-check" scope="col">
                        <input
                          type="checkbox"
                          checked={allSelected}
                          ref={(element) => {
                            if (element) element.indeterminate = !allSelected && someSelected;
                          }}
                          onChange={toggleAll}
                          aria-label="Select all archived work items"
                        />
                      </th>
                      <th className="list-th" scope="col">
                        <span className="sr-only">Type</span>
                      </th>
                      {COLUMNS.map((column) => {
                        const active = sort.key === column.key;
                        return (
                          <th
                            key={column.key}
                            scope="col"
                            className={`list-th list-th-sortable${active ? ' is-sorted' : ''}`}
                            aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                          >
                            <button type="button" className="list-th-btn" onClick={() => toggleSort(column.key)}>
                              {column.label}
                              <SortArrow dir={active ? sort.dir : null} />
                            </button>
                          </th>
                        );
                      })}
                      <th className="list-th" scope="col">
                        <span className="sr-only">Restore</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((ticket) => {
                      const tint = LOZENGE_TINTS[ticket.status] || LOZENGE_TINTS.open;
                      const priorityMeta = PRIORITY_META[ticket.priority] || PRIORITY_META.medium;
                      return (
                        <tr key={ticket.id} className={`list-row${selected.has(ticket.id) ? ' is-selected' : ''}`}>
                          <td className="list-cell list-cell-check">
                            <input
                              type="checkbox"
                              checked={selected.has(ticket.id)}
                              onChange={() => toggleOne(ticket.id)}
                              aria-label={`Select ${ticketKey(ticket)}`}
                            />
                          </td>
                          <td className="list-cell">
                            <span className="list-cell-type" title={TYPE_META[ticket.type]?.label}>
                              <TypeIcon type={ticket.type} size={14} />
                            </span>
                          </td>
                          <td className="list-cell">
                            <button type="button" className="list-key" onClick={() => openTicket(ticket.id)}>
                              {ticketKey(ticket)}
                            </button>
                          </td>
                          <td className="list-cell">
                            <button type="button" className="list-title" onClick={() => openTicket(ticket.id)}>
                              {ticket.title}
                            </button>
                          </td>
                          <td className="list-cell">
                            <span className="archive-priority">
                              <PriorityIcon color={priorityMeta.color} arrow={priorityMeta.arrow} />
                              {priorityMeta.label}
                            </span>
                          </td>
                          <td className="list-cell">
                            <span className="tm-child-status" style={{ background: tint.bg, color: tint.text }}>
                              {STATUS_META[ticket.status]?.label || ticket.status}
                            </span>
                          </td>
                          <td className="list-cell">
                            {ticket.employee_name ? (
                              <span className="list-assignee">
                                <Avatar name={ticket.employee_name} assigned size={24} />
                                {ticket.employee_name}
                              </span>
                            ) : (
                              <span className="list-cell-muted">Unassigned</span>
                            )}
                          </td>
                          <td className="list-cell list-cell-muted list-cell-date">
                            {formatListDateTime(ticket.archived_at) || '—'}
                          </td>
                          <td className="list-cell">
                            {ticket.archived_by_name ? (
                              <span className="list-assignee">
                                <Avatar name={ticket.archived_by_name} assigned size={24} />
                                {ticket.archived_by_name}
                              </span>
                            ) : (
                              <span className="list-cell-muted">—</span>
                            )}
                          </td>
                          <td className="list-cell">
                            <button
                              type="button"
                              className="btn-secondary"
                              disabled={busy}
                              onClick={() => askRestore([ticket])}
                            >
                              Restore
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                    {visible.length === 0 && (
                      <tr>
                        <td colSpan={10} className="list-cell list-cell-muted">
                          No archived work items match those filters.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {selected.size > 0 && (
                <div className="bulk-bar" role="region" aria-label={`Restore ${selected.size} selected work items`}>
                  <span className="bulk-count">{selected.size} selected</span>
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={busy}
                    onClick={() => askRestore(tickets.filter((ticket) => selected.has(ticket.id)))}
                  >
                    Restore
                  </button>
                  <button type="button" className="btn-ghost" disabled={busy} onClick={() => setSelected(new Set())}>
                    Clear
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <TicketDetailModal
        ticket={modal.selected}
        employees={employees}
        currentUser={currentUser}
        siblingTickets={tickets}
        canStep={modal.canStep}
        onClose={modal.close}
        onNext={modal.next}
        onPrev={modal.prev}
        onTicketChanged={() => {}}
        onArchiveChange={(change) => {
          setTickets((current) => mergeArchiveChange(current, change, 'archived'));
        }}
        onOpenTicket={openTicket}
      />

      {prompt && (
        <ArchiveDialog
          mode="restore"
          itemKey={prompt.tickets.length === 1 ? ticketKey(prompt.tickets[0]) : ''}
          count={prompt.tickets.length}
          childCount={prompt.childCount}
          onCancel={() => setPrompt(null)}
          onConfirm={(includeChildren) => restoreTickets(prompt.tickets, includeChildren)}
        />
      )}

      <Toaster toasts={toasts} onDismiss={dismiss} onPause={pause} onResume={resume} />
    </AppShell>
  );
}

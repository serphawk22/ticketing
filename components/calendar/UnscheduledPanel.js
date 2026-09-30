'use client';

import { useCallback, useRef } from 'react';
import Avatar from '../Avatar';
import { TICKET_DRAG_TYPE } from '../../lib/calendar';
import {
  STATUS_META,
  STATUS_ORDER,
  PRIORITY_META,
  PRIORITY_ORDER,
  LOZENGE_TINTS,
  TYPE_META,
  PriorityIcon,
  TypeIcon,
  ticketKey,
} from '../meta';

export const SORTS = [
  { key: 'recent', label: 'Most recent' },
  { key: 'created', label: 'Recently created' },
  { key: 'priority', label: 'Priority' },
  { key: 'key', label: 'Key' },
];

const PRIORITY_RANK = Object.fromEntries(PRIORITY_ORDER.map((p, i) => [p, i]));

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.35-4.35" />
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

function FilterIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 5h18l-7 8v6l-4 2v-8L3 5Z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
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

/**
 * Sort the unscheduled list. Created and updated are ISO-ish strings that sort
 * correctly as plain text, so they need no parsing.
 */
export function sortUnscheduled(tickets, sort) {
  const copy = [...tickets];
  switch (sort) {
    case 'created':
      return copy.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
    case 'priority':
      return copy.sort(
        (a, b) =>
          (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9) ||
          ticketKey(a).localeCompare(ticketKey(b))
      );
    case 'key':
      return copy.sort((a, b) => ticketKey(a).localeCompare(ticketKey(b), undefined, { numeric: true }));
    case 'recent':
    default:
      return copy.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
  }
}

/**
 * The docked "Unscheduled work" panel: every ticket in the project with no due
 * date, which is the only place a ticket with no date can be dragged out of.
 *
 * The panel is itself a drop target. Dropping anything on it clears the due
 * date, which is the only way to take a ticket back off the calendar without
 * opening it and clearing the field by hand.
 */
export default function UnscheduledPanel({
  tickets = [],
  total = 0,
  search,
  onSearch,
  sort,
  onSort,
  sortOpen,
  onSortToggle,
  filtersOpen,
  onFiltersToggle,
  filters,
  onFilters,
  onClose,
  onOpenTicket,
  onStatusChange,
  onDropClear,
  onDragStart,
  onDragEnd,
  draggingId = null,
  isDropTarget = false,
  canUpdate = true,
}) {
  const sortMenuRef = useRef(null);
  const filterMenuRef = useRef(null);

  // A drag fires a click at the end of it in some browsers, which would open
  // the ticket the user just moved. Suppress the click that follows a drop.
  const swallowClick = useCallback(() => {
    const until = Date.now() + 250;
    const block = (e) => {
      if (Date.now() > until) {
        document.removeEventListener('click', block, true);
        return;
      }
      e.preventDefault();
      e.stopPropagation();
    };
    document.addEventListener('click', block, true);
  }, []);

  const activeFilterCount =
    (filters.status !== 'all' ? 1 : 0) +
    (filters.priority !== 'all' ? 1 : 0) +
    (filters.type !== 'all' ? 1 : 0);

  return (
    <aside
      className={`cal-panel${isDropTarget ? ' is-drop-target' : ''}`}
      aria-label="Unscheduled work"
      onDragOver={(e) => {
        // Accept on the payload, not on local state: whether a drag is in
        // flight is something the payload can answer without waiting for a
        // render, and it keeps unrelated drags (selected text, a file) out.
        if (!e.dataTransfer.types.includes(TICKET_DRAG_TYPE)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes(TICKET_DRAG_TYPE)) return;
        e.preventDefault();
        onDropClear(Number(e.dataTransfer.getData(TICKET_DRAG_TYPE)));
        swallowClick();
      }}
    >
      <header className="cal-panel-head">
        <div>
          <h2 className="cal-panel-title">Unscheduled work</h2>
          <p className="cal-panel-hint">
            Drag each work item onto the calendar to set a due date for the work.
          </p>
        </div>
        <button
          type="button"
          className="cal-panel-close"
          onClick={onClose}
          aria-label="Hide the unscheduled work panel"
          title="Hide the unscheduled work panel"
        >
          <CloseIcon />
        </button>
      </header>

      <div className="cal-panel-search search-field">
        <SearchIcon />
        <input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search unscheduled items"
          aria-label="Search unscheduled items"
        />
      </div>

      <div className="cal-panel-controls">
        <div className="cal-menu-wrap" ref={sortMenuRef}>
          <button
            type="button"
            className="cal-ghost-btn"
            aria-haspopup="menu"
            aria-expanded={sortOpen}
            onClick={onSortToggle}
          >
            <span>{SORTS.find((s) => s.key === sort)?.label || 'Most recent'}</span>
            <ChevronIcon />
          </button>
          {sortOpen && (
            <div className="menu-popup cal-menu" role="menu">
              {SORTS.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  className="menu-item"
                  role="menuitemradio"
                  aria-checked={sort === s.key}
                  onClick={() => onSort(s.key)}
                >
                  <span className="menu-item-text">{s.label}</span>
                  {sort === s.key && <CheckIcon />}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="cal-menu-wrap" ref={filterMenuRef}>
          <button
            type="button"
            className={`cal-ghost-btn${activeFilterCount ? ' active' : ''}`}
            aria-haspopup="menu"
            aria-expanded={filtersOpen}
            onClick={onFiltersToggle}
          >
            <FilterIcon />
            <span>Filters</span>
            {activeFilterCount > 0 && <span className="cal-filter-badge">{activeFilterCount}</span>}
          </button>
          {filtersOpen && (
            <div className="menu-popup cal-menu" role="menu">
              <p className="cal-menu-label">Status</p>
              <button
                type="button"
                className="menu-item"
                role="menuitemradio"
                aria-checked={filters.status === 'all'}
                onClick={() => onFilters({ status: 'all' })}
              >
                <span className="menu-item-text">Any status</span>
                {filters.status === 'all' && <CheckIcon />}
              </button>
              {STATUS_ORDER.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="menu-item"
                  role="menuitemradio"
                  aria-checked={filters.status === s}
                  onClick={() => onFilters({ status: s })}
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
                  onClick={() => onFilters({ priority: filters.priority === p ? 'all' : p })}
                >
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
                  onClick={() => onFilters({ type: filters.type === t ? 'all' : t })}
                >
                  <TypeIcon type={t} size={12} />
                  <span className="menu-item-text">{TYPE_META[t].label}</span>
                  {filters.type === t && <CheckIcon />}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="cal-panel-list">
        {tickets.length === 0 ? (
          <p className="cal-panel-empty">
            {total === 0
              ? 'Every work item in this project has a due date.'
              : 'No unscheduled work matches these filters.'}
          </p>
        ) : (
          tickets.map((t) => {
            const priority = PRIORITY_META[t.priority] || PRIORITY_META.medium;
            const tint = LOZENGE_TINTS[t.status] || LOZENGE_TINTS.open;
            const isDragging = draggingId === t.id;
            return (
              <div
                key={t.id}
                className={`cal-unsched-card${isDragging ? ' is-dragging' : ''}`}
                style={{ '--card-accent': priority.color }}
                draggable={canUpdate}
                role="button"
                tabIndex={0}
                aria-label={`${ticketKey(t)}: ${t.title}`}
                onClick={() => onOpenTicket(t.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onOpenTicket(t.id);
                  }
                }}
                onDragStart={(e) => {
                  // The payload is authoritative: the drop target reads it
                  // first, because React state set in dragstart may not have
                  // rendered by the time the drop fires.
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData(TICKET_DRAG_TYPE, String(t.id));
                  e.dataTransfer.setData('text/plain', String(t.id));
                  onDragStart(t.id);
                }}
                onDragEnd={onDragEnd}
              >
                <div className="cal-unsched-top">
                  <span className="cal-unsched-title">{t.title}</span>
                  <Avatar name={t.employee_name} assigned={Boolean(t.employee_name)} size={24} unassignedIcon />
                </div>
                <div className="cal-unsched-bottom">
                  <span className="cal-unsched-key">
                    <TypeIcon type={t.type} size={12} />
                    <span className="cal-unsched-key-link">{ticketKey(t)}</span>
                  </span>
                  <span className="cal-unsched-side">
                    <span className="cal-unsched-priority" title={priority.label}>
                      <PriorityIcon color={priority.color} arrow={priority.arrow} />
                    </span>
                    <span className="cal-status-wrap">
                      <span
                        className={`list-lozenge${canUpdate ? ' is-editable' : ''}`}
                        style={{ background: tint.bg, color: tint.text }}
                      >
                        {STATUS_META[t.status].label}
                      </span>
                      {canUpdate ? (
                        <span className="list-status-select">
                          <select
                            value={t.status}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => onStatusChange(t.id, e.target.value)}
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
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>

      <footer className="cal-panel-foot">
        {tickets.length === total
          ? `${total} work ${total === 1 ? 'item' : 'items'}`
          : `${tickets.length} of ${total} work items`}
      </footer>
    </aside>
  );
}

'use client';

import { useMemo, useState } from 'react';
import Avatar from './Avatar';
import {
  DONE_STATUSES,
  LOZENGE_TINTS,
  PRIORITY_META,
  PriorityIcon,
  STATUS_META,
  STATUS_ORDER,
  ticketKey,
} from './meta';

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
      aria-hidden="true"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

/**
 * Admin-only roll-up of the day's work.
 *
 * "Today" means due today, the same rule the developer dashboard uses, and a
 * ticket is reported whether or not it is finished so the admin can see what is
 * still outstanding as well as what has landed.
 */
export default function TodayByDeveloper({
  tickets,
  employees,
  today,
  onOpenTicket,
  onAddTicket,
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [selectedRow, setSelectedRow] = useState(null);

  // The ticket item shared by the inline rows and the per-person modal: one
  // turn of the same controls, so both places read the same way.
  function renderTicketItem(t, onOpen = onOpenTicket) {
    const lozenge = LOZENGE_TINTS[t.status] || LOZENGE_TINTS.open;
    const priority = PRIORITY_META[t.priority];
    return (
      <li key={t.id}>
        <button
          type="button"
          className="today-sum-item"
          onClick={() => onOpen?.(t.id)}
          aria-label={`Open ${ticketKey(t)}: ${t.title}`}
          disabled={!onOpen}
        >
          <span className="priority-icon" title={`${priority.label} priority`}>
            <PriorityIcon color={priority.color} arrow={priority.arrow} />
          </span>
          <span className="today-sum-key">{ticketKey(t)}</span>
          <span className="today-sum-text">{t.title}</span>
          {t.project_name && (
            <span className="today-sum-project">{t.project_name}</span>
          )}
          <span
            className="list-lozenge"
            style={{ background: lozenge.bg, color: lozenge.text }}
          >
            {STATUS_META[t.status]?.label || t.status}
          </span>
        </button>
      </li>
    );
  }

  const rows = useMemo(() => {
    const dueToday = tickets.filter((t) => t.due_date === today);

    const byEmployee = new Map();
    for (const t of dueToday) {
      const key = t.employee_id == null ? 'none' : String(t.employee_id);
      if (!byEmployee.has(key)) byEmployee.set(key, []);
      byEmployee.get(key).push(t);
    }

    // Everyone on the developer roster appears, so a day with no assigned work
    // still reads as "nothing due" rather than disappearing from the summary.
    const roster = employees
      .filter((e) => e.active && e.name !== 'Admin User')
      .map((e) => ({ employee: e, list: byEmployee.get(String(e.id)) || [] }));

    if (byEmployee.has('none')) {
      roster.push({ employee: null, list: byEmployee.get('none') });
    }

    const rank = (list) => list.filter((t) => !DONE_STATUSES.includes(t.status)).length;

    return roster
      .map((row) => {
        const done = row.list.filter((t) => DONE_STATUSES.includes(t.status));
        const open = row.list.filter((t) => !DONE_STATUSES.includes(t.status));
        return {
          ...row,
          done,
          open,
          total: row.list.length,
        };
      })
      .sort((a, b) => {
        if (rank(b.list) !== rank(a.list)) return rank(b.list) - rank(a.list);
        const an = a.employee?.name || 'zzz';
        const bn = b.employee?.name || 'zzz';
        return an.localeCompare(bn);
      });
  }, [tickets, employees, today]);

  const total = rows.reduce((n, r) => n + r.total, 0);
  const doneTotal = rows.reduce((n, r) => n + r.done.length, 0);
  const openTotal = total - doneTotal;

  return (
    <section className="today-sum" aria-label="Today's work by developer">
      <button
        type="button"
        className="today-sum-head"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
      >
        <span className={`today-sum-caret${collapsed ? ' is-collapsed' : ''}`}>
          <ChevronIcon />
        </span>
        <span className="today-sum-title">Today&rsquo;s work</span>
        <span className="today-sum-meta">
          {total === 0
            ? 'Nothing due today'
            : `${total} due today · ${doneTotal} completed · ${openTotal} outstanding`}
        </span>
        <span className="today-sum-bar" aria-hidden="true">
          <span
            className="today-sum-bar-done"
            style={{ width: total ? `${(doneTotal / total) * 100}%` : '0%' }}
          />
        </span>
      </button>

      {!collapsed && (
        <div className="today-sum-body">
          {rows.map((row) => {
            const name = row.employee?.name || 'Unassigned';
            return (
              <div key={row.employee?.id ?? 'none'} className="today-sum-row">
                <div className="today-sum-who">
                  <Avatar name={name} size={28} />
                  <div className="today-sum-id">
                    <button
                      type="button"
                      className="today-sum-name-btn"
                      onClick={() => setSelectedRow(row)}
                      title={`Show ${name}'s tasks by status`}
                      aria-label={`Show ${name}'s tasks by status`}
                    >
                      <span className="today-sum-name">{name}</span>
                    </button>
                    {row.employee?.title && (
                      <span className="today-sum-role">{row.employee.title}</span>
                    )}
                  </div>
                  <span className="today-sum-counts">
                    {row.done.length > 0 && (
                      <span className="today-sum-done">{row.done.length} done</span>
                    )}
                    {row.open.length > 0 && (
                      <span className="today-sum-open">{row.open.length} open</span>
                    )}
                    {row.total === 0 && (
                      <span className="today-sum-none">No tasks due</span>
                    )}
                    {row.employee && onAddTicket && (
                      <button
                        type="button"
                        className="today-sum-add"
                        onClick={() => onAddTicket(row.employee)}
                        aria-label={`Add a task for ${name}`}
                        title={`Add a task for ${name}`}
                      >
                        <svg
                          viewBox="0 0 24 24"
                          width="13"
                          height="13"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          aria-hidden="true"
                        >
                          <path d="M12 5v14M5 12h14" />
                        </svg>
                      </button>
                    )}
                  </span>
                </div>

                {row.total > 0 && (
                  <ul className="today-sum-list">
                    {[...row.open, ...row.done].map((t) => renderTicketItem(t))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}

      {selectedRow && (
        <EmployeeBreakdownModal
          row={selectedRow}
          onClose={() => setSelectedRow(null)}
          onOpenTicket={onOpenTicket}
          renderTicketItem={renderTicketItem}
        />
      )}
    </section>
  );
}

/**
 * The per-person read of Today's work: click a name in the summary and get the
 * four status buckets with their counts, plus the tickets behind them.
 */
function EmployeeBreakdownModal({ row, onClose, onOpenTicket, renderTicketItem }) {
  const name = row.employee?.name || 'Unassigned';

  const counts = {};
  for (const s of STATUS_ORDER) counts[s] = 0;
  for (const t of row.list) {
    if (counts[t.status] != null) counts[t.status] += 1;
  }

  const grouped = STATUS_ORDER.map((s) => ({
    status: s,
    items: row.list.filter((t) => t.status === s),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Tickets for ${name}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header>
          <Avatar name={name} size={28} />
          <div className="account-text">
            <span className="account-name">{name}</span>
            <span className="account-email">
              {row.employee?.title || 'Team member'} · {row.total} due today
            </span>
          </div>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <div className="ticket-stats-body">
          <div className="metric-strip">
            {STATUS_ORDER.map((s) => (
              <div className="metric-card" key={s}>
                <span className="metric-value">{counts[s]}</span>
                <span className="metric-label status-stat-label">
                  <span
                    className="status-stat-dot"
                    style={{ background: STATUS_META[s].color }}
                    aria-hidden="true"
                  />
                  {STATUS_META[s].label}
                </span>
              </div>
            ))}
          </div>

          {row.total === 0 ? (
            <p className="today-breakdown-empty">No tasks due today.</p>
          ) : (
            <ul className="today-breakdown">
              {grouped.map((g) => (
                <li key={g.status}>
                  <div className="today-breakdown-head">
                    <span
                      className="status-stat-dot"
                      style={{ background: STATUS_META[g.status].color }}
                      aria-hidden="true"
                    />
                    {STATUS_META[g.status].label}
                    <span className="today-breakdown-count">{g.items.length}</span>
                  </div>
                  <ul className="today-sum-list">
                    {g.items.map((t) =>
                      renderTicketItem(t, (id) => {
                        onClose();
                        onOpenTicket?.(id);
                      })
                    )}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

'use client';

import Link from 'next/link';
import { PRIORITY_META } from '@/lib/ticketMeta';

const PREVIEW_LIMIT = 5;

export default function PriorityTicketsCard({
  total = 0,
  urgentCount = 0,
  highCount = 0,
  tickets = [],
  showAll = false,
  onToggleShowAll,
}) {
  const visibleTickets = showAll ? tickets : tickets.slice(0, PREVIEW_LIMIT);
  const hiddenCount = Math.max(0, tickets.length - PREVIEW_LIMIT);

  return (
    <div className={`rpt-kpi-card rpt-priority-card${total > 0 ? ' kpi-warn' : ' kpi-pos'}`}>
      <div className="rpt-kpi-head">
        <span className="rpt-kpi-title">Priority Tickets</span>
      </div>

      <div className="rpt-kpi-value">{total}</div>

      <div className="rpt-kpi-sub rpt-priority-sub">
        <span>
          Highest {urgentCount} · High {highCount}
        </span>
        {hiddenCount > 0 && (
          <button
            type="button"
            className="rpt-priority-viewall"
            onClick={onToggleShowAll}
          >
            {showAll ? 'Show less' : 'View all'}
          </button>
        )}
      </div>

      <div className="rpt-priority-list">
        {!tickets.length ? (
          <span className="rpt-priority-empty">No priority tickets</span>
        ) : (
          visibleTickets.map((ticket) => {
            const priority = PRIORITY_META[ticket.priority] || PRIORITY_META.high;

            return (
              <Link
                key={ticket.id}
                href={`/t/${encodeURIComponent(ticket.key)}`}
                className={`rpt-priority-chip rpt-priority-chip-${ticket.priority}`}
                title={`${priority.label}: ${ticket.title}`}
              >
                {ticket.key}
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}

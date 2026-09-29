'use client';

import Avatar from './Avatar';
import {
  PRIORITY_META,
  STATUS_META,
  STATUS_ORDER,
  TYPE_META,
  PriorityIcon,
  TypeIcon,
  formatShortDate,
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

export default function TicketCard({
  ticket,
  canUpdate,
  employees,
  canReassign,
  onDragStart,
  onDragEnd,
  onUpdate,
  onReassign,
  isDragging,
  isActive = false,
  onOpen,
}) {
  const priority = PRIORITY_META[ticket.priority];
  const status = STATUS_META[ticket.status];

  function handleKeyDown(e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onOpen(ticket.id);
    }
  }

  return (
    <div
      className={`ticket-card${isDragging ? ' dragging' : ''}${isActive ? ' is-active' : ''}`}
      style={{ '--card-accent': priority.color }}
      draggable={canUpdate}
      tabIndex={0}
      role="button"
      aria-label={`Ticket #${ticket.id}: ${ticket.title}`}
      aria-haspopup="dialog"
      onClick={(e) => {
        if (e.target.closest('.status-field')) return;
        onOpen(ticket.id);
      }}
      onKeyDown={handleKeyDown}
      onDragStart={(e) => {
        onDragStart(ticket.id);
      }}
      onDragEnd={onDragEnd}
    >
      <div className="card-head">
        <span
          className="card-type-icon is-plain"
          title={(TYPE_META[ticket.type] || TYPE_META.task).label}
        >
          <TypeIcon type={ticket.type} size={12} />
        </span>
        <span className="card-key">{ticketKey(ticket)}</span>
        {ticket.project_key && (
          <span
            className="project-chip"
            style={{ '--chip-color': ticket.project_color }}
            title={ticket.project_name}
          >
            {ticket.project_key}
          </span>
        )}
        <span className="card-head-spacer" />
        <span
          className="priority-icon"
          title={`${priority.label} priority`}
          aria-label={`${priority.label} priority`}
        >
          <PriorityIcon color={priority.color} arrow={priority.arrow} />
        </span>
      </div>

      <div className="card-title">{ticket.title}</div>

      <div className="card-foot">
        {canUpdate ? (
          <span className="status-field">
            <span
              className="status-field-dot"
              style={{ background: status.color }}
            />
            <select
              className="status-select"
              value={ticket.status}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => onUpdate(ticket.id, e.target.value)}
              aria-label={`Move ${ticket.title} to status`}
            >
              {STATUS_ORDER.map((s) => (
                <option key={s} value={s}>
                  {STATUS_META[s].label}
                </option>
              ))}
            </select>
          </span>
        ) : (
          <span
            className="status-badge"
            style={{ background: status.bg, color: status.text }}
          >
            {status.label}
          </span>
        )}

        <div className="card-meta">
          <span className="card-date">
            {formatShortDate(ticket.created_at)}
          </span>
          <Avatar
            name={ticket.employee_name}
            assigned={Boolean(ticket.employee_id)}
            size={24}
          />
        </div>
      </div>
    </div>
  );
}

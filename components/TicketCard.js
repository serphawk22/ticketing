'use client';

import { useEffect, useState } from 'react';
import Avatar from './Avatar';
import {
  PRIORITY_META,
  STATUS_META,
  STATUS_ORDER,
  PriorityIcon,
  formatShortDate,
  formatFullDateTime,
} from './meta';

function TicketDetailModal({ ticket, onClose }) {
  const priority = PRIORITY_META[ticket.priority];
  const status = STATUS_META[ticket.status];

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Ticket ${ticket.title}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header>
          <h3>TM-{ticket.id}</h3>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <div className="detail-body">
          <div className="detail-id">
            <span className="card-type-icon" title="Task">
              <svg viewBox="0 0 16 16" width="11" height="11" fill="currentColor">
                <path d="M7.4 2.2h1.2v3.1h3.1v1.2H8.6v3.1H7.4V6.5H4.3V5.3h3.1V2.2Z" />
              </svg>
            </span>
            <span className="card-key">{`TM-${ticket.id}`}</span>
            {ticket.project_key && (
              <span
                className="project-chip"
                style={{ '--chip-color': ticket.project_color }}
                title={ticket.project_name}
              >
                {ticket.project_key}
              </span>
            )}
            <span
              className="priority-icon"
              title={`${priority.label} priority`}
            >
              <PriorityIcon color={priority.color} arrow={priority.arrow} />
            </span>
            <span
              className="status-badge"
              style={{ background: status.bg, color: status.text }}
            >
              <span className="chip-dot" style={{ background: status.color }} />
              {status.label}
            </span>
          </div>

          <h2>{ticket.title}</h2>

          <div className="detail-section">
            <h4>Description</h4>
            <p className="detail-description">
              {ticket.description || 'No description.'}
            </p>
          </div>

          <div className="detail-section">
            <h4>Project</h4>
            {ticket.project_id ? (
              <div className="person">
                <span
                  className="project-dot"
                  style={{ background: ticket.project_color }}
                  aria-hidden="true"
                />
                <span className="person-name">{ticket.project_name}</span>
                <span className="project-key">{ticket.project_key}</span>
              </div>
            ) : (
              <p className="detail-description">No project.</p>
            )}
          </div>

          <div className="detail-section">
            <h4>People</h4>
            <div className="detail-people">
              <div className="person">
                <span className="person-label">Reporter</span>
                <Avatar name={ticket.created_by_name} assigned size={24} />
                <span className="person-name">{ticket.created_by_name}</span>
              </div>
              <div className="person">
                <span className="person-label">Assignee</span>
                <Avatar
                  name={ticket.assigned_to_name}
                  assigned={Boolean(ticket.assigned_to)}
                  size={24}
                />
                <span className="person-name">
                  {ticket.assigned_to_name || 'Unassigned'}
                </span>
              </div>
            </div>
          </div>

          <div className="detail-meta">
            Created {formatFullDateTime(ticket.created_at)} · Updated{' '}
            {formatFullDateTime(ticket.updated_at)}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function TicketCard({
  ticket,
  canUpdate,
  onDragStart,
  onDragEnd,
  onUpdate,
  isDragging,
}) {
  const [open, setOpen] = useState(false);
  const priority = PRIORITY_META[ticket.priority];
  const status = STATUS_META[ticket.status];

  function handleKeyDown(e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setOpen(true);
    }
  }

  return (
    <>
      <div
        className={`ticket-card${isDragging ? ' dragging' : ''}`}
        style={{ '--card-accent': priority.color }}
        draggable={canUpdate}
        tabIndex={0}
        role="button"
        aria-label={`Ticket #${ticket.id}: ${ticket.title}`}
        onClick={(e) => {
          if (e.target.closest('.status-field')) return;
          setOpen(true);
        }}
        onKeyDown={handleKeyDown}
        onDragStart={(e) => {
          onDragStart(ticket.id);
        }}
        onDragEnd={onDragEnd}
      >
        <div className="card-head">
          <span className="card-type-icon" title="Task">
            <svg viewBox="0 0 16 16" width="11" height="11" fill="currentColor">
              <path d="M7.4 2.2h1.2v3.1h3.1v1.2H8.6v3.1H7.4V6.5H4.3V5.3h3.1V2.2Z" />
            </svg>
          </span>
          <span className="card-key">TM-{ticket.id}</span>
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
                aria-label="Move to status"
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
              <span className="chip-dot" style={{ background: status.color }} />
              {status.label}
            </span>
          )}

          <div className="card-meta">
            <span className="card-date">
              {formatShortDate(ticket.created_at)}
            </span>
            <Avatar
              name={ticket.assigned_to_name}
              assigned={Boolean(ticket.assigned_to)}
              size={24}
            />
          </div>
        </div>
      </div>

      {open && <TicketDetailModal ticket={ticket} onClose={() => setOpen(false)} />}
    </>
  );
}
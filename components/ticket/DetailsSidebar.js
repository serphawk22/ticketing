'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  PRIORITY_META,
  PRIORITY_ORDER,
  STATUS_META,
  STATUS_ORDER,
  TYPE_META,
  TYPE_ORDER,
  formatDuration,
  formatFullDateTime,
  formatShortDate,
  parseDuration,
  ticketKey,
} from '../meta';
import { CalendarIcon, ChevronRight, ClockIcon, GearIcon, LightningIcon, PersonOutlineIcon } from './icons';
import { ChipInput, FieldRow, InlineText, Menu, MenuItem, MenuLabel } from './parts';
import UserPicker from '../UserPicker';
import { CategoryField, PriorityField, ReporterField, StatusField } from '../TicketFields';

function PersonField({ ticket, employees, canReassign, meEmployeeId, onSave }) {
  const assignable = useMemo(
    () =>
      employees
        // Clients raise requests but never take ownership of the work, so they
        // are kept out of the list of people a ticket can be assigned to.
        .filter((e) => e.active && e.role !== 'client')
        .map((e) => ({ id: e.id, name: e.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [employees]
  );

  return (
    <FieldRow label="Assignee">
      <div className="tm-person">
        <UserPicker
          value={ticket.employee_id}
          users={assignable}
          onSelect={onSave}
          readOnly={!canReassign}
          label="Assignee"
        />
      </div>
      {!ticket.employee_id && canReassign && meEmployeeId && (
        <button type="button" className="tm-inline-link" onClick={() => onSave(meEmployeeId)}>
          Assign to me
        </button>
      )}
    </FieldRow>
  );
}

function TypeField({ type, onSave, canEdit }) {
  const [open, setOpen] = useState(false);
  const meta = TYPE_META[type] || TYPE_META.task;
  return (
    <FieldRow label="Issue type">
      <button
        type="button"
        className="tm-value-btn"
        onClick={() => canEdit && setOpen((v) => !v)}
        disabled={!canEdit}
        title={canEdit ? '' : 'Only admins can change the issue type'}
      >
        <span className="tm-type-dot" style={{ background: meta.color }} aria-hidden="true" />
        {meta.label}
      </button>
      <Menu open={open} onClose={() => setOpen(false)}>
        <MenuLabel>Change issue type</MenuLabel>
        {TYPE_ORDER.map((key) => {
          const option = TYPE_META[key];
          return (
            <MenuItem
              key={key}
              active={key === type}
              onClick={() => {
                onSave(key);
                setOpen(false);
              }}
              icon={<span className="tm-type-dot" style={{ background: option.color }} />}
            >
              {option.label}
            </MenuItem>
          );
        })}
      </Menu>
    </FieldRow>
  );
}

function DateField({ label, value, onSave, canEdit }) {
  return (
    <FieldRow label={label}>
      <span className="tm-date-wrap">
        <CalendarIcon size={14} className="tm-date-icon" />
        {canEdit ? (
          <input
            type="date"
            className="tm-date-input"
            value={value || ''}
            onChange={(e) => onSave(e.target.value || null)}
            aria-label={label}
          />
        ) : (
          <span className={value ? 'tm-date-text' : 'tm-placeholder'}>
            {value ? formatShortDate(`${value} 12:00:00`) : `Add ${label.toLowerCase()}`}
          </span>
        )}
      </span>
    </FieldRow>
  );
}

function TimeField({ estimateSeconds, loggedSeconds, onSaveEstimate, onLog, canEdit }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState('');

  return (
    <FieldRow label="Time tracking">
      <div className="tm-time-rows">
        <div className="tm-time-row">
          <span className="tm-time-label">Original estimate</span>
          <span className={estimateSeconds ? 'tm-time-value' : 'tm-placeholder'}>
            {estimateSeconds ? formatDuration(estimateSeconds) : 'Add original estimate'}
          </span>
        </div>
        <div className="tm-time-row">
          <span className="tm-time-label">Time spent</span>
          <button
            type="button"
            className="tm-value-btn"
            onClick={() => canEdit && setOpen((v) => !v)}
            disabled={!canEdit}
          >
            <ClockIcon size={14} />
            {loggedSeconds ? formatDuration(loggedSeconds) : 'No time logged'}
          </button>
        </div>
      </div>
      <Menu open={open} onClose={() => setOpen(false)} className="tm-time-menu">
        <div className="tm-time-form" onClick={(e) => e.stopPropagation()}>
          <label className="tm-mini-label" htmlFor="tm-log-time">Time spent</label>
          <input
            id="tm-log-time"
            className="tm-input"
            placeholder="1h 30m"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <label className="tm-mini-label" htmlFor="tm-log-note">Work description</label>
          <input
            id="tm-log-note"
            className="tm-input"
            placeholder="Optional"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="tm-time-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={!parseDuration(draft)}
              onClick={async () => {
                await onLog(parseDuration(draft), note);
                setDraft('');
                setNote('');
                setOpen(false);
              }}
            >
              Log time
            </button>
          </div>
          <hr className="tm-rule" />
          <label className="tm-mini-label" htmlFor="tm-estimate">Estimate</label>
          <input
            id="tm-estimate"
            className="tm-input"
            defaultValue={estimateSeconds ? formatDuration(estimateSeconds) : ''}
            placeholder="2h"
            onBlur={(e) => onSaveEstimate(parseDuration(e.target.value))}
          />
        </div>
      </Menu>
    </FieldRow>
  );
}

// Custom fields commit on blur or Enter rather than on every keystroke, so
// typing a budget does not fire a request per character.
function CustomField({ label, value, onSave, canEdit, placeholder, type = 'text', prefix }) {
  const [draft, setDraft] = useState(value ?? '');
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(value ?? '');
  }, [value, editing]);

  function commit() {
    setEditing(false);
    const next = String(draft).trim();
    if (next !== String(value ?? '').trim()) onSave(next);
  }

  return (
    <FieldRow label={label}>
      {canEdit ? (
        editing ? (
          <span className="tm-input-wrap">
            {prefix ? <span className="tm-input-prefix">{prefix}</span> : null}
            <input
              className="tm-input"
              type={type}
              autoFocus
              value={draft}
              placeholder={placeholder}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commit();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setDraft(value ?? '');
                  setEditing(false);
                }
              }}
              aria-label={label}
            />
          </span>
        ) : (
          <button
            type="button"
            className={`inline-value${value ? '' : ' is-empty'}`}
            onClick={() => setEditing(true)}
          >
            {value ? (
              <span className="tm-value-text">
                {prefix ? <span className="tm-input-prefix">{prefix}</span> : null}
                {value}
              </span>
            ) : (
              placeholder
            )}
          </button>
        )
      ) : (
        <span className={value ? '' : 'tm-placeholder'}>{value || placeholder}</span>
      )}
    </FieldRow>
  );
}

export default function DetailsSidebar({
  ticket,
  detail,
  employees,
  isAdmin,
  onPatch,
  onLogTime,
  onOpenWatcherMenu,
  configureOpen,
  onToggleConfigure,
}) {
  // Same roster the list builds: employees carry the matching user id, because
  // a reporter is a user and tickets.created_by holds a user id.
  const reporters = useMemo(
    () =>
      employees
        .filter((e) => e.active && e.user_id)
        .map((e) => ({ id: e.user_id, name: e.name, email: e.email, role: e.role }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [employees]
  );

  const [detailsOpen, setDetailsOpen] = useState(true);
  const [automationOpen, setAutomationOpen] = useState(true);
  const labels = String(ticket.labels || '')
    .split(',')
    .map((l) => l.trim())
    .filter(Boolean);

  return (
    <aside className="tm-side" aria-label="Ticket details">
      <div className="tm-side-top">
        <StatusField
          value={ticket.status}
          onSelect={(v) => onPatch({ status: v })}
          variant="button"
          readOnly={false}
        />
        <button
          type="button"
          className="tm-icon-btn tm-automation-btn"
          title="Automation"
          aria-label="Automation"
          onClick={onOpenWatcherMenu}
        >
          <LightningIcon size={14} />
        </button>
      </div>

      <section className="tm-side-section">
        <button type="button" className="tm-side-heading" onClick={() => setDetailsOpen((v) => !v)} aria-expanded={detailsOpen}>
          <ChevronRight size={14} className={detailsOpen ? 'tm-rot90' : ''} />
          <span>Details</span>
          <span className="tm-grow" />
          <GearIcon size={14} />
        </button>

        {detailsOpen && (
          <div className="tm-fields">
            <PersonField
              ticket={ticket}
              employees={employees}
              canReassign={isAdmin}
              meEmployeeId={detail.meEmployeeId}
              onSave={(v) => onPatch({ employee_id: v })}
            />
            <FieldRow label="Reporter">
              <div className="tm-person">
                <ReporterField
                  value={ticket.created_by}
                  people={reporters}
                  readOnly={!isAdmin}
                />
              </div>
            </FieldRow>
            <FieldRow label="Priority">
              <div className="tm-person">
                <PriorityField value={ticket.priority} onSelect={(v) => onPatch({ priority: v })} />
              </div>
            </FieldRow>
            <TypeField type={ticket.type} onSave={(v) => onPatch({ type: v })} canEdit={isAdmin} />
            <FieldRow label="Labels">
              <ChipInput
                values={labels}
                disabled={false}
                onSave={(next) => onPatch({ labels: next.join(', ') })}
              />
            </FieldRow>
            <DateField
              label="Start date"
              value={ticket.start_date}
              onSave={(v) => onPatch({ start_date: v })}
              canEdit
            />
            <DateField
              label="Due date"
              value={ticket.due_date}
              onSave={(v) => onPatch({ due_date: v })}
              canEdit
            />
            <TimeField
              estimateSeconds={ticket.estimate_seconds}
              loggedSeconds={detail.loggedSeconds}
              onSaveEstimate={(v) => onPatch({ estimate_seconds: v })}
              onLog={onLogTime}
              canEdit
            />
            <FieldRow label="Category">
              <div className="tm-person">
                <CategoryField
                  value={ticket.category}
                  onSelect={(v) => onPatch({ category: v })}
                  readOnly={!isAdmin}
                />
              </div>
            </FieldRow>
            <CustomField
              label="Team"
              value={ticket.team}
              onSave={(v) => onPatch({ team: v })}
              canEdit={isAdmin}
              placeholder="Add team"
            />
            <CustomField
              label="Budget"
              type="number"
              prefix="$"
              value={ticket.budget ? ticket.budget : ''}
              onSave={(v) => onPatch({ budget: v === '' ? 0 : Number(v) })}
              canEdit={isAdmin}
              placeholder="0"
            />
          </div>
        )}
      </section>

      <section className="tm-side-section">
        <button
          type="button"
          className="tm-side-heading"
          onClick={() => setAutomationOpen((v) => !v)}
          aria-expanded={automationOpen}
        >
          <ChevronRight size={14} className={automationOpen ? 'tm-rot90' : ''} />
          <span>Automation</span>
          <span className="tm-grow" />
          <LightningIcon size={13} />
        </button>
        {automationOpen && (
          <p className="tm-side-note">
            <span className="tm-muted">No rules have run on this issue.</span>{' '}
            <button type="button" className="tm-inline-link">Rule executions</button>
          </p>
        )}
      </section>

      <div className="tm-side-foot">
        <p>Created {formatFullDateTime(ticket.created_at)}</p>
        <p>Updated {formatFullDateTime(ticket.updated_at)}</p>
        <button type="button" className="tm-inline-link" onClick={onToggleConfigure}>
          {configureOpen ? 'Done' : 'Configure fields'}
        </button>
      </div>
    </aside>
  );
}

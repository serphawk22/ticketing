'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  PRIORITY_META,
  PRIORITY_ORDER,
  STATUS_META,
  STATUS_ORDER,
  formatDuration,
  formatISTDateTime,
  formatShortDate,
  parseDuration,
  ticketKey,
} from '../meta';
import { CalendarIcon, ChevronRight, ClockIcon, GearIcon, LightningIcon, PersonOutlineIcon } from './icons';
import { ChipInput, FieldRow, InlineText, Menu } from './parts';
import { ActivityHistorySection } from './sections';
import InlineDateField from '../InlineDateField';
import { CategoryField, PriorityField, ReporterField, StatusField, ProductInclusionField, AssigneeField, IssueTypeField, TeamField } from '../TicketFields';

function DateField({ label, value, onSave, canEdit, clickToEdit = false }) {
  // The due date opens on click: the value sits there until it is clicked, the
  // click hands over to the picker with the saved date already in it, and the
  // change lands on Enter, Save or blur. The start date keeps its own
  // always-open input.
  if (clickToEdit) {
    return (
      <FieldRow label={label}>
        <span className="tm-date-wrap">
          <CalendarIcon size={14} className="tm-date-icon" />
          <InlineDateField
            value={value}
            onSave={onSave}
            readOnly={!canEdit}
            label={label}
            variant="sidebar"
            className="tm-date-value"
            format={(v) => formatShortDate(`${v} 12:00:00`)}
            emptyText={`Add ${label.toLowerCase()}`}
          />
        </span>
      </FieldRow>
    );
  }

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

function TimeField({ estimateSeconds, loggedSeconds, timeLogs = [], onSaveEstimate, onLog, canEdit }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState('');
  const [workDate, setWorkDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [logging, setLogging] = useState(false);

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
            title={canEdit ? 'View time spent and log work' : 'Only team members can log work time'}
          >
            <ClockIcon size={14} />
            {loggedSeconds ? formatDuration(loggedSeconds) : 'No time logged'}
          </button>
        </div>
      </div>
      <Menu open={open} onClose={() => setOpen(false)} className="tm-time-menu">
        <div className="tm-time-form" onClick={(e) => e.stopPropagation()} style={{ minWidth: '260px' }}>
          <label className="tm-mini-label" htmlFor="tm-log-time">Time spent</label>
          <input
            id="tm-log-time"
            className="tm-input"
            placeholder="e.g. 1h 30m, 45m"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <label className="tm-mini-label" htmlFor="tm-log-date">Work date</label>
          <input
            id="tm-log-date"
            type="date"
            className="tm-input"
            value={workDate}
            onChange={(e) => setWorkDate(e.target.value)}
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
              disabled={!parseDuration(draft) || logging}
              onClick={async () => {
                setLogging(true);
                try {
                  await onLog(parseDuration(draft), note, workDate);
                  setDraft('');
                  setNote('');
                  setOpen(false);
                } finally {
                  setLogging(false);
                }
              }}
            >
              {logging ? 'Logging...' : 'Log time'}
            </button>
          </div>

          {timeLogs && timeLogs.length > 0 && (
            <>
              <hr className="tm-rule" />
              <label className="tm-mini-label">Work entries ({timeLogs.length})</label>
              <div style={{ maxHeight: '140px', overflowY: 'auto', fontSize: '12px' }}>
                {timeLogs.map((entry) => (
                  <div
                    key={entry.id}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      padding: '4px 0',
                      borderBottom: '1px solid var(--border, #eee)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <strong>{entry.user_name || 'User'}</strong>
                      <span className="tm-chip-plain" style={{ fontWeight: 600 }}>
                        {formatDuration(entry.seconds)}
                      </span>
                    </div>
                    <div style={{ color: 'var(--muted, #666)', fontSize: '11px' }}>
                      {entry.work_date || (entry.created_at ? String(entry.created_at).slice(0, 10) : '')}
                      {entry.note ? ` — ${entry.note}` : ''}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

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
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
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
            {value && /^https?:\/\//i.test(value) && (
              <a
                href={value}
                target="_blank"
                rel="noopener noreferrer"
                className="tm-inline-link"
                title="Open reference link"
                style={{ fontSize: '12px' }}
              >
                Open ↗
              </a>
            )}
          </span>
        )
      ) : (
        <span className={value ? '' : 'tm-placeholder'}>
          {value || placeholder}
          {value && /^https?:\/\//i.test(value) && (
            <a
              href={value}
              target="_blank"
              rel="noopener noreferrer"
              className="tm-inline-link"
              title="Open reference link"
              style={{ marginLeft: 6, fontSize: '12px' }}
            >
              Open ↗
            </a>
          )}
        </span>
      )}
    </FieldRow>
  );
}

export default function DetailsSidebar({
  ticket,
  detail,
  employees,
  isAdmin,
  currentUser,
  onPatch,
  onLogTime,
  onOpenWatcherMenu,
  configureOpen,
  onToggleConfigure,
}) {
  // The people a ticket can be assigned to: active staff, never clients, the
  // same rule ticket creation and the list's inline picker apply. The email and
  // role ride along so the dropdown can be searched by either.
  const assignable = useMemo(
    () =>
      employees
        .filter((e) => e.active && e.role !== 'client')
        .map((e) => ({ id: e.id, name: e.name, email: e.email, role: e.role, title: e.title }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [employees]
  );

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
  const [historyOpen, setHistoryOpen] = useState(true);
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
            <FieldRow label="Assignee">
              <div className="tm-person">
                <AssigneeField
                  value={ticket.employee_id}
                  employees={assignable}
                  onSelect={(v) => onPatch({ employee_id: v })}
                  variant="sidebar"
                />
              </div>
              {!ticket.employee_id && isAdmin && detail.meEmployeeId && (
                <button type="button" className="tm-inline-link" onClick={() => onPatch({ employee_id: detail.meEmployeeId })}>
                  Assign to me
                </button>
              )}
            </FieldRow>
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
                <PriorityField value={ticket.priority} onSelect={(v) => onPatch({ priority: v })} variant="sidebar" searchable />
              </div>
            </FieldRow>
            <FieldRow label="Issue type">
              <div className="tm-person">
                <IssueTypeField
                  value={ticket.type}
                  onSelect={(v) => onPatch({ type: v })}
                  variant="sidebar"
                />
              </div>
            </FieldRow>
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
              clickToEdit
            />
            <TimeField
              estimateSeconds={ticket.estimate_seconds}
              loggedSeconds={detail.loggedSeconds}
              timeLogs={detail.timeLogs}
              onSaveEstimate={(v) => onPatch({ estimate_seconds: v })}
              onLog={onLogTime}
              canEdit={!ticket.archived && currentUser?.role !== 'client'}
            />
            <FieldRow label="Category">
              <div className="tm-person">
                <CategoryField
                  value={ticket.category}
                  onSelect={(v) => onPatch({ category: v })}
                  readOnly={ticket.archived || currentUser?.role === 'client'}
                />
              </div>
            </FieldRow>
            <FieldRow label="Team">
              <div className="tm-person">
                <TeamField
                  value={ticket.team}
                  employees={assignable}
                  onSelect={(v) => onPatch({ team: v })}
                  readOnly={ticket.archived || currentUser?.role === 'client'}
                  variant="sidebar"
                />
              </div>
            </FieldRow>
            <CustomField
              label="Budget"
              type="number"
              prefix="$"
              value={ticket.budget ? ticket.budget : ''}
              onSave={(v) => onPatch({ budget: v === '' ? 0 : Number(v) })}
              canEdit={isAdmin}
              placeholder="0"
            />
            <FieldRow label="Main product">
              <div className="tm-person">
                <ProductInclusionField
                  value={ticket.product_inclusion_status}
                  onSelect={(v) => onPatch({ product_inclusion_status: v })}
                  readOnly={ticket.archived || currentUser?.role === 'client'}
                />
              </div>
            </FieldRow>
            <CustomField
              label="Inclusion ref"
              value={ticket.product_inclusion_reference}
              onSave={(v) => onPatch({ product_inclusion_reference: v })}
              canEdit={!ticket.archived && currentUser?.role !== 'client'}
              placeholder="e.g. PR #42, commit, v1.0"
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

      <ActivityHistorySection
        activity={detail?.activity || []}
        collapsed={!historyOpen}
        onToggle={() => setHistoryOpen((v) => !v)}
      />

      <div className="tm-side-foot">
        <p>Created {formatISTDateTime(ticket.created_at)}</p>
        <p>Updated {formatISTDateTime(ticket.updated_at)}</p>
        <button type="button" className="tm-inline-link" onClick={onToggleConfigure}>
          {configureOpen ? 'Done' : 'Configure fields'}
        </button>
      </div>
    </aside>
  );
}

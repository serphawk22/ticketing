'use client';

import { useEffect, useState } from 'react';
import {
  AssigneeField,
  CategoryField,
  IssueTypeField,
  PriorityField,
  ProjectField,
} from './TicketFields';

export default function CreateTicketModal({
  employees = [],
  projects = [],
  defaultProjectId = '',
  // Set when the modal was opened from a specific person's row, so the ticket
  // is assigned to them without a second click.
  defaultEmployeeId = null,
  parent = null,
  defaultDueDate = null,
  defaultStartDate = null,
  onClose,
  onCreate,
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('medium');
  const [type, setType] = useState('task');
  const [category, setCategory] = useState('');
  const [employeeId, setEmployeeId] = useState(
    defaultEmployeeId != null ? String(defaultEmployeeId) : ''
  );
  const [projectId, setProjectId] = useState(
    defaultProjectId ? String(defaultProjectId) : ''
  );
  const [dueDate, setDueDate] = useState(defaultDueDate || '');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  // Same rule as the ticket detail sidebar: clients request work, they do not
  // receive it.
  const assignable = employees.filter((e) => e.active && e.role !== 'client');
  const assigneeEmail = assignable.find((emp) => String(emp.id) === employeeId)?.email;

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function validate() {
    const errs = {};
    if (!title.trim()) errs.summary = 'Summary is required.';
    if (!description.trim()) errs.description = 'Description is required.';
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting) return;
    setError('');

    if (!validate()) return;

    setSubmitting(true);

    try {
      const res = await fetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          description,
          priority,
          type,
          category,
          employee_id: employeeId ? Number(employeeId) : null,
          project_id: projectId ? Number(projectId) : null,
          // Set when the modal was opened from a row's quick-add, so the new
          // ticket lands in the tree instead of at the top level.
          parent_id: parent ? parent.id : null,
          // Set when the modal was opened from a calendar cell or a timeline
          // drag, so the ticket lands on the day or range that was drawn.
          start_date: defaultStartDate || null,
          due_date: dueDate || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create ticket.');
      onCreate(data.ticket);
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-overlay create-ticket-overlay" onMouseDown={onClose}>
      <div
        className="modal create-ticket-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Create ticket"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header>
          <h3>
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="3" width="18" height="18" rx="3" />
              <path d="M12 8v8M8 12h8" />
            </svg>
            {parent ? 'New child work item' : 'New ticket'}
          </h3>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <form onSubmit={handleSubmit} noValidate>
          <div className="create-ticket-body">
            {parent && (
              <p className="form-parent">
                Child of <strong>{parent.project_key ? `${parent.project_key}-${parent.id}` : `#${parent.id}`}</strong>
                {parent.title ? ` — ${parent.title}` : ''}
              </p>
            )}
            {(defaultStartDate || dueDate) && (
              <p className="form-parent">
                {defaultStartDate && dueDate ? (
                  <>
                    Scheduled <strong>{defaultStartDate}</strong>
                    {' – '}
                    <strong>{dueDate}</strong>
                  </>
                ) : dueDate ? (
                  <>
                    Due <strong>{dueDate}</strong>
                  </>
                ) : (
                  <>
                    Starts <strong>{defaultStartDate}</strong>
                  </>
                )}
              </p>
            )}

            <div className="form-group">
              <label htmlFor="summary">Summary</label>
              <input
                id="summary"
                type="text"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  if (fieldErrors.summary) {
                    setFieldErrors((prev) => ({ ...prev, summary: '' }));
                  }
                }}
                placeholder="What needs to be done?"
                className={fieldErrors.summary ? 'is-invalid' : ''}
                aria-invalid={fieldErrors.summary ? 'true' : undefined}
                autoFocus
              />
              {fieldErrors.summary && (
                <span className="field-error">{fieldErrors.summary}</span>
              )}
            </div>

            <div className="form-group">
              <label htmlFor="ticket-description">Description</label>
              <textarea
                id="ticket-description"
                rows={4}
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
                  if (fieldErrors.description) {
                    setFieldErrors((prev) => ({ ...prev, description: '' }));
                  }
                }}
                placeholder="Add a description…"
                className={fieldErrors.description ? 'is-invalid' : ''}
                aria-invalid={fieldErrors.description ? 'true' : undefined}
              />
              {fieldErrors.description && (
                <span className="field-error">{fieldErrors.description}</span>
              )}
            </div>

            <div className="create-ticket-grid">
              <div className="form-group">
                <label>Priority</label>
                <PriorityField value={priority} onSelect={setPriority} variant="form" searchable />
              </div>

              <div className="form-group">
                <label>Issue type</label>
                <IssueTypeField value={type} onSelect={setType} variant="form" />
              </div>

              <div className="form-group">
                <label>Category</label>
                <CategoryField value={category} onSelect={setCategory} variant="form" />
              </div>

              <div className="form-group">
                <label>Assign to</label>
                <AssigneeField
                  value={employeeId}
                  employees={assignable}
                  onSelect={(v) => setEmployeeId(v == null ? '' : String(v))}
                  variant="form"
                />
                {assigneeEmail && (
                  <span className="field-hint">
                    {assigneeEmail} will be emailed when this ticket is assigned.
                  </span>
                )}
              </div>

              <div className="form-group">
                <label>Project</label>
                <ProjectField
                  value={projectId}
                  projects={projects}
                  onSelect={(v) => setProjectId(v == null ? '' : String(v))}
                  variant="form"
                />
              </div>

              <div className="form-group">
                <label htmlFor="ticket-due-date">Due date</label>
                <input
                  id="ticket-due-date"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>
            </div>

            {error && <div className="error-text">{error}</div>}
          </div>

          <div className="modal-actions create-ticket-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? 'Creating…' : 'Create ticket'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { PRIORITY_META, PRIORITY_ORDER, TYPE_META, TYPE_ORDER } from './meta';

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
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const assignable = employees.filter((e) => e.active);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
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
          due_date: defaultDueDate || null,
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
    <div className="modal-overlay" onMouseDown={onClose}>
      <div
        className="modal"
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

        <form onSubmit={handleSubmit}>
          {parent && (
            <p className="form-parent">
              Child of <strong>{parent.project_key ? `${parent.project_key}-${parent.id}` : `#${parent.id}`}</strong>
              {parent.title ? ` — ${parent.title}` : ''}
            </p>
          )}
          {(defaultStartDate || defaultDueDate) && (
            <p className="form-parent">
              {defaultStartDate && defaultDueDate ? (
                <>
                  Scheduled <strong>{defaultStartDate}</strong>
                  {' – '}
                  <strong>{defaultDueDate}</strong>
                </>
              ) : defaultDueDate ? (
                <>
                  Due <strong>{defaultDueDate}</strong>
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
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What needs to be done?"
              required
              autoFocus
            />
          </div>

          <div className="form-group">
            <label htmlFor="ticket-description">Description</label>
            <textarea
              id="ticket-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add a description…"
              required
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="ticket-priority">Priority</label>
              <select
                id="ticket-priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
              >
                {PRIORITY_ORDER.map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_META[p].label}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="ticket-type">Issue type</label>
              <select
                id="ticket-type"
                value={type}
                onChange={(e) => setType(e.target.value)}
              >
                {TYPE_ORDER.map((t) => (
                  <option key={t} value={t}>
                    {TYPE_META[t].label}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="ticket-category">Category</label>
              <input
                id="ticket-category"
                type="text"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="Add category"
              />
            </div>

            <div className="form-group">
              <label htmlFor="assignee">Assign to</label>
              <select
                id="assignee"
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
              >
                <option value="">Unassigned</option>
                {assignable.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.name}
                    {emp.title ? ` — ${emp.title}` : ''}
                  </option>
                ))}
              </select>
              {employeeId && (
                <span className="field-hint">
                  {assignable.find((emp) => String(emp.id) === employeeId)?.email} will
                  be emailed when this ticket is assigned.
                </span>
              )}
            </div>

            <div className="form-group">
              <label htmlFor="project">Project</label>
              <select
                id="project"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
              >
                <option value="">No project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.key})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {error && <div className="error-text">{error}</div>}

          <div className="modal-actions">
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
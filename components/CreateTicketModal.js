'use client';

import { useEffect, useRef, useState } from 'react';
import {
  AssigneeField,
  CategoryField,
  IssueTypeField,
  PriorityField,
  ProjectField,
} from './TicketFields';

/**
 * One labelled control in the modal. The label, the control and the error
 * message travel together, so a field is a single entry in the grid list
 * below rather than three separate pieces of markup that can drift apart.
 */
function FormField({ id, label, error, hint, children }) {
  return (
    <div className="form-group">
      <label htmlFor={id}>{label}</label>
      {children}
      {hint}
      {error && (
        <span className="field-error" id={id ? `${id}-error` : undefined} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

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

  // The two text fields keep a handle on themselves so a rejected submit can
  // put the caret on the field that stopped it: the body scrolls on its own,
  // so the offending field is not always on screen.
  const summaryRef = useRef(null);
  const descriptionRef = useRef(null);

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

  // Editing a field clears the last failure, so a message from the server
  // does not sit under a form the user has already corrected.
  function pick(setter) {
    return (value) => {
      setError('');
      setter(value);
    };
  }

  function onSummaryChange(e) {
    setTitle(e.target.value);
    setError('');
    if (fieldErrors.summary) {
      setFieldErrors((prev) => ({ ...prev, summary: '' }));
    }
  }

  function onDescriptionChange(e) {
    setDescription(e.target.value);
    setError('');
    if (fieldErrors.description) {
      setFieldErrors((prev) => ({ ...prev, description: '' }));
    }
  }

  function validate() {
    const errs = {};
    if (!title.trim()) errs.summary = 'Summary is required.';
    if (!description.trim()) errs.description = 'Description is required.';
    setFieldErrors(errs);
    return errs;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting) return;
    setError('');

    const errs = validate();
    if (Object.keys(errs).length > 0) {
      if (errs.summary) summaryRef.current?.focus();
      else descriptionRef.current?.focus();
      return;
    }

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

  // The grid reads as three rows of two: priority and issue type, category
  // and assignee, project and due date. Keeping it as one list means a new
  // field is one entry here instead of another block of markup to copy.
  const gridFields = [
    {
      key: 'priority',
      label: 'Priority',
      control: (
        <PriorityField value={priority} onSelect={pick(setPriority)} variant="form" searchable />
      ),
    },
    {
      key: 'type',
      label: 'Issue type',
      control: <IssueTypeField value={type} onSelect={pick(setType)} variant="form" />,
    },
    {
      key: 'category',
      label: 'Category',
      control: <CategoryField value={category} onSelect={pick(setCategory)} variant="form" />,
    },
    {
      key: 'assignee',
      label: 'Assign to',
      control: (
        <AssigneeField
          value={employeeId}
          employees={assignable}
          onSelect={pick((v) => setEmployeeId(v == null ? '' : String(v)))}
          variant="form"
        />
      ),
      hint: assigneeEmail ? (
        <span className="field-hint">
          {assigneeEmail} will be emailed when this ticket is assigned.
        </span>
      ) : null,
    },
    {
      key: 'project',
      label: 'Project',
      control: (
        <ProjectField
          value={projectId}
          projects={projects}
          onSelect={pick((v) => setProjectId(v == null ? '' : String(v)))}
          variant="form"
        />
      ),
    },
    {
      key: 'due-date',
      label: 'Due date',
      id: 'ticket-due-date',
      control: (
        <input
          id="ticket-due-date"
          type="date"
          value={dueDate}
          // A ticket drawn on the timeline already has a start, and the create
          // route refuses a due date before it, so the picker stops the
          // contradiction instead of letting the server reject it.
          min={defaultStartDate || undefined}
          onChange={(e) => {
            setDueDate(e.target.value);
            setError('');
          }}
        />
      ),
    },
  ];

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

            <FormField id="summary" label="Summary" error={fieldErrors.summary}>
              <input
                id="summary"
                ref={summaryRef}
                type="text"
                value={title}
                onChange={onSummaryChange}
                placeholder="What needs to be done?"
                className={fieldErrors.summary ? 'is-invalid' : ''}
                aria-invalid={fieldErrors.summary ? 'true' : undefined}
                aria-describedby={fieldErrors.summary ? 'summary-error' : undefined}
                autoFocus
              />
            </FormField>

            <FormField
              id="ticket-description"
              label="Description"
              error={fieldErrors.description}
            >
              <textarea
                id="ticket-description"
                ref={descriptionRef}
                rows={4}
                value={description}
                onChange={onDescriptionChange}
                placeholder="Add a description…"
                className={fieldErrors.description ? 'is-invalid' : ''}
                aria-invalid={fieldErrors.description ? 'true' : undefined}
                aria-describedby={
                  fieldErrors.description ? 'ticket-description-error' : undefined
                }
              />
            </FormField>

            <div className="create-ticket-grid">
              {gridFields.map((field) => (
                <FormField
                  key={field.key}
                  id={field.id}
                  label={field.label}
                  hint={field.hint}
                >
                  {field.control}
                </FormField>
              ))}
            </div>

            {error && (
              <div className="error-text" role="alert">
                {error}
              </div>
            )}
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

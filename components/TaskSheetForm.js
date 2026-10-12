'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import ChipSelect from '@/components/ChipSelect';
import InlineDropdownField from '@/components/InlineDropdownField';
import { CheckIcon } from '@/components/ticket/icons';
import { STATUS_META } from '@/components/meta';

/** The hours the sheet offers, plus Other for the half-days and the long ones. */
const HOUR_OPTIONS = ['1', '2', '3', '4', '5', '6', '7', '8'].map((v) => ({
  value: v,
  label: v,
}));

const STATE_OPTIONS = [
  {
    value: 'completed',
    title: 'Completed',
    blurb: 'The work is done and ready to hand over.',
  },
  {
    value: 'not_completed',
    title: 'Not Completed',
    blurb: 'Started but still open at the end of the day.',
  },
];

// Field 4 is either a work item number or a short summary, and only the number
// form can be checked against what is already on the board.
const TICKET_KEY = /^[A-Za-z]+-\d+$/;

/**
 * One day of the timesheet.
 *
 * The six answers the external Microsoft Forms link asked for, in the same
 * order, as one card rather than a modal: the whole sheet is short enough to
 * see at once, and a form that fits on screen does not need to be assembled one
 * dialog at a time.
 *
 * Validation runs across every field at once, not as the user leaves them.
 * Stopping someone after the second answer to ask for the fifth would mean the
 * answers they already gave are held hostage behind an error they cannot see
 * yet, so the submit collects everything wrong and takes them to it.
 */
export default function TaskSheetForm({
  people,
  projects,
  defaults = {},
  onSubmitted,
}) {
  const [name, setName] = useState(defaults.name || '');
  const [project, setProject] = useState(defaults.project || '');
  const [hours, setHours] = useState('');
  const [customHours, setCustomHours] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDescription, setTaskDescription] = useState('');
  const [taskState, setTaskState] = useState('');
  // Only asked for when the state is Not Completed: a completed task has
  // nothing holding it up, so the field appears the moment it is relevant.
  const [blocker, setBlocker] = useState('');

  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [linking, setLinking] = useState(false);
  const [linked, setLinked] = useState(null);
  const [confirmation, setConfirmation] = useState(null);

  const [projectTasks, setProjectTasks] = useState([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [tasksError, setTasksError] = useState('');
  const [syncTicketStatus, setSyncTicketStatus] = useState(true);

  const titleTimer = useRef(null);
  const titleRef = useRef(null);

  // The value is the person's name, not their id: the sheet stores what the
  // external form's dropdown spelled, and a timesheet row should read "Vijay"
  // even if the roster later grows and renumbers.
  const nameOptions = useMemo(
    () => (people || []).map((p) => ({ value: p.name, label: p.name })),
    [people]
  );

  const normalizedProjects = useMemo(() => {
    return (projects || []).map((p) => {
      if (typeof p === 'string') return { id: null, name: p, key: '' };
      return { id: p.id, name: p.name, key: p.key || '' };
    });
  }, [projects]);

  const projectOptions = useMemo(
    () => normalizedProjects.map((p) => ({ value: p.name, label: p.name })),
    [normalizedProjects]
  );

  const activeProject = useMemo(
    () => normalizedProjects.find((p) => p.name === project),
    [normalizedProjects, project]
  );

  // Fetch active tasks for the selected project
  useEffect(() => {
    if (!activeProject?.id) {
      setProjectTasks([]);
      return undefined;
    }

    let active = true;
    setLoadingTasks(true);
    setTasksError('');

    fetch(`/api/tickets?projectId=${activeProject.id}`)
      .then((res) => {
        if (!res.ok) throw new Error('Could not load project tasks');
        return res.json();
      })
      .then((data) => {
        if (active) {
          setProjectTasks(data.tickets || []);
        }
      })
      .catch((err) => {
        if (active) {
          setTasksError(err.message);
          setProjectTasks([]);
        }
      })
      .finally(() => {
        if (active) setLoadingTasks(false);
      });

    return () => {
      active = false;
    };
  }, [activeProject?.id]);

  function handleSelectTask(taskId) {
    if (!taskId) {
      setLinked(null);
      return;
    }
    const task = projectTasks.find((t) => String(t.id) === String(taskId));
    if (!task) return;

    const key = `${(task.project_key || activeProject?.key || 'TM').toUpperCase()}-${task.id}`;
    setLinked({
      id: task.id,
      key,
      title: task.title,
      status: task.status,
      assignee: task.employee_name || 'Unassigned',
      project_id: task.project_id || activeProject?.id,
      project_name: task.project_name || activeProject?.name || '',
    });
    setTaskTitle(task.title);
    if (!taskDescription.trim() && task.description) {
      setTaskDescription(task.description);
    }
    setErrors((prev) => {
      const next = { ...prev };
      delete next.taskTitle;
      return next;
    });
  }

  function handleClearLinked() {
    setLinked(null);
  }

  // A typed number is only worth resolving while it is still a number. The
  // lookup is debounced so a person typing a summary does not fire a request
  // per keystroke.
  useEffect(() => {
    const trimmed = taskTitle.trim();
    if (!TICKET_KEY.test(trimmed)) {
      if (linked && !projectTasks.some((t) => t.id === linked.id && t.title === taskTitle)) {
        setLinked(null);
      }
      setLinking(false);
      return undefined;
    }

    setLinking(true);
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/tickets/search?q=${encodeURIComponent(trimmed)}&limit=10`,
          { signal: controller.signal }
        );
        if (!res.ok) throw new Error('lookup failed');
        const data = await res.json();
        const wanted = trimmed.toUpperCase();
        const match = (data.tickets || []).find(
          (t) => `${t.project_key}-${t.id}`.toUpperCase() === wanted
        );
        if (match) {
          setLinked({
            id: match.id,
            key: `${(match.project_key || 'TM').toUpperCase()}-${match.id}`,
            title: match.title,
            status: match.status,
            assignee: match.employee_name || '',
            project_id: match.project_id,
            project_name: match.project_name || '',
          });
          if (match.project_name && !project) {
            setProject(match.project_name);
          }
        } else {
          setLinked(null);
        }
      } catch {
        setLinked(null);
      } finally {
        setLinking(false);
      }
    }, 300);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [taskTitle, project, projectTasks, linked]);

  function resolvedHours() {
    if (hours === 'other') {
      const n = Number(customHours);
      return Number.isFinite(n) && n > 0 ? n : null;
    }
    if (!hours) return null;
    const n = Number(hours);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  function validate() {
    const next = {};
    if (!name) next.name = 'Please select your name.';
    if (!project) next.project = 'Please select a project.';
    if (resolvedHours() == null) {
      next.hours = hours === 'other'
        ? 'Enter the hours worked.'
        : 'Please select the hours worked.';
    }
    if (!taskTitle.trim()) next.taskTitle = 'Please enter a task title or number.';
    if (!taskDescription.trim()) next.taskDescription = 'Please describe the task.';
    if (!taskState) next.taskState = 'Please choose a task state.';
    if (taskState === 'not_completed' && !blocker.trim()) {
      next.blocker = 'Please describe what is blocking this task.';
    }
    return next;
  }

  async function submit(e) {
    e.preventDefault();
    if (busy) return;

    const found = validate();
    setErrors(found);

    // Take them to the first thing that is wrong rather than leaving it above
    // the fold: after a failed submit the error is the only thing worth seeing.
    const first = Object.keys(found)[0];
    if (first) {
      document
        .getElementById(`ts-${first}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      document
        .querySelector(`#ts-${first} .idf-trigger, #ts-${first} input, #ts-${first} textarea`)
        ?.focus({ preventScroll: true });
      return;
    }

    setBusy(true);
    try {
      const res = await fetch('/api/task-sheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name,
          project,
          hoursWorked: resolvedHours(),
          taskTitle: taskTitle.trim(),
          taskDescription: taskDescription.trim(),
          taskState,
          blocker: taskState === 'not_completed' ? blocker.trim() : null,
          linkedTicketId: linked ? linked.id : null,
          syncTicketStatus,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save the task sheet.');

      setConfirmation({
        submission: data.submission,
        name,
        project,
        hoursWorked: resolvedHours(),
        taskTitle: taskTitle.trim(),
        taskState,
        blocker: taskState === 'not_completed' ? blocker.trim() : null,
        linked,
      });
      onSubmitted?.(name);
    } catch (err) {
      setErrors({ ...found, _form: err.message });
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setName(defaults.name || '');
    setProject(defaults.project || '');
    setHours('');
    setCustomHours('');
    setTaskTitle('');
    setTaskDescription('');
    setTaskState('');
    setBlocker('');
    setErrors({});
    setLinked(null);
    setConfirmation(null);
    titleRef.current?.focus();
  }

  if (confirmation) {
    return <TaskSheetConfirmation summary={confirmation} onReset={reset} />;
  }

  const errorList = Object.entries(errors).filter(([k]) => k !== '_form');

  return (
    <form className="ts-form" onSubmit={submit} noValidate>
      {errors._form && (
        <div className="ts-banner" role="alert">
          <strong>Task sheet not saved.</strong> {errors._form}
        </div>
      )}

      {errorList.length > 0 && (
        <div className="ts-error-summary" role="alert">
          <strong>
            {errorList.length === 1
              ? 'One answer still needs attention.'
              : `${errorList.length} answers still need attention.`}
          </strong>
          <span>{errorList.map(([, m]) => m).join(' ')}</span>
        </div>
      )}

      <div className="ts-grid">
        <div className={`form-group ts-field${errors.name ? ' has-error' : ''}`}
          id="ts-name"
          role="group"
          aria-label="Name">
          <span className="ts-legend">Name</span>
          <InlineDropdownField
            value={name}
            options={nameOptions}
            onSelect={setName}
            label="Name"
            emptyText="Select your name"
            variant="button"
            className="ts-select"
          />
          {errors.name ? <span className="error-text">{errors.name}</span> : null}
        </div>

        <div
          className={`form-group ts-field${errors.project ? ' has-error' : ''}`}
          id="ts-project"
          role="group"
          aria-label="Project"
        >
          <span className="ts-legend">Project</span>
          <InlineDropdownField
            value={project}
            options={projectOptions}
            onSelect={setProject}
            label="Project"
            emptyText="Select a project"
            searchable={false}
            variant="button"
            className="ts-select"
          />
          {errors.project ? <span className="error-text">{errors.project}</span> : null}
        </div>

        <div
          className={`form-group ts-field${errors.hours ? ' has-error' : ''}`}
          id="ts-hours"
          role="group"
          aria-label="Approximate hours worked"
        >
          <span className="ts-legend">Approximate hours worked</span>
          <ChipSelect
            label="Approximate hours worked"
            name="ts-hours"
            value={hours}
            options={[...HOUR_OPTIONS, { value: 'other', label: 'Other' }]}
            onChange={(v) => {
              setHours(v);
              if (v !== 'other') setCustomHours('');
            }}
          />
          {hours === 'other' && (
            <input
              type="number"
              min="0.5"
              step="0.5"
              className="ts-hours-input"
              placeholder="Hours"
              aria-label="Approximate hours worked"
              value={customHours}
              onChange={(e) => setCustomHours(e.target.value)}
            />
          )}
          {errors.hours ? <span className="error-text">{errors.hours}</span> : null}
        </div>

        <div
          className={`form-group ts-field ts-field-wide${errors.taskTitle ? ' has-error' : ''}`}
          id="ts-taskTitle"
        >
          <label htmlFor="ts-title">Task title or ticket number</label>

          {project && projectTasks.length > 0 && !linked && (
            <div className="ts-task-picker" style={{ marginBottom: 6 }}>
              <select
                id="ts-task-dropdown"
                className="ts-task-select"
                value=""
                onChange={(e) => handleSelectTask(e.target.value)}
                aria-label={`Select an existing task from ${project}`}
              >
                <option value="">— Choose an existing task from {project} (optional) —</option>
                {projectTasks.map((t) => (
                  <option key={t.id} value={t.id}>
                    [{(t.project_key || activeProject?.key || 'TM').toUpperCase()}-{t.id}] {t.title} ({STATUS_META[t.status]?.label || t.status}{t.employee_name ? ` · ${t.employee_name}` : ''})
                  </option>
                ))}
              </select>
            </div>
          )}

          <input
            id="ts-title"
            ref={titleRef}
            type="text"
            value={taskTitle}
            placeholder="TM-594, or a short summary of the work"
            onChange={(e) => setTaskTitle(e.target.value)}
            aria-invalid={errors.taskTitle ? 'true' : undefined}
          />

          {linked && (
            <div className="ts-linked-task-card" role="region" aria-label="Connected project task">
              <div className="ts-linked-task-header">
                <span className="ts-linked-task-key">#{linked.key}</span>
                {linked.status && (
                  <span
                    className="ts-status-badge"
                    style={{
                      backgroundColor: STATUS_META[linked.status]?.bg || '#deebff',
                      color: STATUS_META[linked.status]?.text || '#0747a6',
                    }}
                  >
                    <span
                      className="ts-status-dot"
                      style={{ backgroundColor: STATUS_META[linked.status]?.color || '#579dff' }}
                    />
                    {STATUS_META[linked.status]?.label || linked.status}
                  </span>
                )}
                {linked.assignee && (
                  <span className="ts-linked-task-assignee">
                    Assignee: <strong>{linked.assignee}</strong>
                  </span>
                )}
                {linked.project_id && (
                  <a
                    href={`/projects/${linked.project_id}/list?issue=${linked.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="ts-linked-open-link"
                    title="Open task in project board"
                  >
                    View on board ↗
                  </a>
                )}
                <button
                  type="button"
                  className="ts-linked-clear-btn"
                  onClick={handleClearLinked}
                  title="Disconnect task"
                >
                  ✕ Disconnect
                </button>
              </div>
            </div>
          )}

          {linking && !linked && (
            <span className="ts-link-chip is-resolving">
              <CheckIcon size={12} aria-hidden="true" />
              Looking up work item…
            </span>
          )}
          {errors.taskTitle ? <span className="error-text">{errors.taskTitle}</span> : null}
        </div>

        <div
          className={`form-group ts-field ts-field-wide${
            errors.taskDescription ? ' has-error' : ''
          }`}
          id="ts-taskDescription"
        >
          <label htmlFor="ts-description">Task description</label>
          <textarea
            id="ts-description"
            rows={4}
            value={taskDescription}
            placeholder="What was worked on, and how far it got"
            onChange={(e) => setTaskDescription(e.target.value)}
            aria-invalid={errors.taskDescription ? 'true' : undefined}
          />
          {errors.taskDescription ? (
            <span className="error-text">{errors.taskDescription}</span>
          ) : null}
        </div>

        <div className={`form-group ts-field${errors.taskState ? ' has-error' : ''}`} id="ts-taskState">
          <span className="ts-legend">Task state</span>
          <div className="ts-states" role="radiogroup" aria-label="Task state">
            {STATE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={taskState === option.value}
                className={`ts-state${taskState === option.value ? ' is-selected' : ''}`}
                onClick={() => setTaskState(option.value)}
              >
                <span className="ts-state-dot" aria-hidden="true" />
                <span className="ts-state-text">
                  <strong>{option.title}</strong>
                  <span>{option.blurb}</span>
                </span>
              </button>
            ))}
          </div>
          {linked && taskState === 'completed' && (
            <label className="ts-sync-option">
              <input
                type="checkbox"
                checked={syncTicketStatus}
                onChange={(e) => setSyncTicketStatus(e.target.checked)}
              />
              <span>Mark connected task <strong>#{linked.key}</strong> as Resolved upon submission</span>
            </label>
          )}
          {errors.taskState ? <span className="error-text">{errors.taskState}</span> : null}
        </div>

        {taskState === 'not_completed' && (
          <div
            className={`form-group ts-field ts-field-wide${
              errors.blocker ? ' has-error' : ''
            }`}
            id="ts-blocker"
          >
            <label htmlFor="ts-blocker-input">What is blocking this task?</label>
            <textarea
              id="ts-blocker-input"
              rows={3}
              value={blocker}
              placeholder="Waiting on a dependency, a review, access, a decision…"
              onChange={(e) => setBlocker(e.target.value)}
              aria-invalid={errors.blocker ? 'true' : undefined}
            />
            {errors.blocker ? <span className="error-text">{errors.blocker}</span> : null}
          </div>
        )}
      </div>

      <div className="ts-actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Submitting…' : 'Submit task sheet'}
        </button>
        <p className="field-hint">One row per day. Your name is taken from your sign-in.</p>
      </div>
    </form>
  );
}


/**
 * SQLite stores UTC as "YYYY-MM-DD HH:MM:SS" while Postgres returns an ISO
 * string with its own offset. Appending 'Z' to the first is correct and to the
 * second is an invalid date, so the shape of the string decides which it is.
 */
function formatSubmitted(at) {
  const text = String(at ?? '');
  const iso = !text.includes('T') && text.includes(' ')
    ? `${text.replace(' ', 'T')}Z`
    : text;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? text : d.toLocaleString();
}

/**
 * The form is replaced rather than emptied, so the confirmation reads as a
 * receipt for what was just filed instead of a blank page next to a toast that
 * may already be gone.
 */
function TaskSheetConfirmation({ summary, onReset }) {
  const done = summary.taskState === 'completed';

  return (
    <div className="ts-confirmation" role="status">
      <div className={`ts-confirmation-mark${done ? ' is-done' : ''}`} aria-hidden="true">
        {done ? '✓' : '•'}
      </div>
      <div>
        <h2>Task sheet submitted</h2>
        <p className="ts-confirmation-line">
          <strong>{summary.name}</strong> · {summary.project} · {summary.hoursWorked}h ·{' '}
          {done ? 'Completed' : 'Not Completed'}
        </p>
        <p className="ts-confirmation-line ts-confirmation-task">
          {summary.linked ? (
            <>
              <strong>#{summary.linked.key}</strong>
              {summary.linked.status ? ` (${summary.linked.status})` : ''} —{' '}
            </>
          ) : ''}
          {summary.taskTitle}
          {summary.linked?.project_id && (
            <>
              {' '}
              ·{' '}
              <a
                href={`/projects/${summary.linked.project_id}/list?issue=${summary.linked.id}`}
                target="_blank"
                rel="noreferrer"
                className="ts-linked-open-link"
                style={{ fontSize: 13 }}
              >
                View on board ↗
              </a>
            </>
          )}
        </p>
        {summary.blocker && (
          <p className="ts-confirmation-line ts-confirmation-blocker">
            <strong>Blocked by:</strong> {summary.blocker}
          </p>
        )}
        <p className="field-hint">
          Saved as row #{summary.submission.id} at{' '}
          {formatSubmitted(summary.submission.created_at)}.
        </p>
      </div>
      <button type="button" className="btn btn-secondary" onClick={onReset}>
        Submit another
      </button>
    </div>
  );
}

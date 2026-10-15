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
  const [selectedTickets, setSelectedTickets] = useState([]);
  const linked = selectedTickets[0] || null;
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

  // Fetch active tasks for the selected project and user, and revalidate tickets
  useEffect(() => {
    // Clear tickets that do not belong to the selected project and user or are closed
    setSelectedTickets((prev) =>
      prev.filter((t) =>
        Boolean(
          activeProject?.id &&
          t.project_id === activeProject.id &&
          name &&
          (t.assignee === name || t.employee_name === name || t.assigned_to_name === name) &&
          t.status !== 'closed'
        )
      )
    );

    if (!activeProject?.id || !name) {
      setProjectTasks([]);
      return undefined;
    }

    let active = true;
    setLoadingTasks(true);
    setTasksError('');

    fetch(`/api/tickets?projectId=${activeProject.id}&userName=${encodeURIComponent(name)}&excludeClosed=true`)
      .then((res) => {
        if (!res.ok) throw new Error('Could not load project tasks');
        return res.json();
      })
      .then((data) => {
        if (active) {
          const matching = (data.tickets || []).filter(
            (t) =>
              (t.employee_name === name || t.assigned_to_name === name) &&
              t.status !== 'closed'
          );
          setProjectTasks(matching);
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
  }, [activeProject?.id, name]);

  function handleSelectTask(taskId) {
    if (!taskId) return;
    const task = projectTasks.find((t) => String(t.id) === String(taskId));
    if (!task) return;

    // Prevent duplicate selection of the same ticket
    if (selectedTickets.some((t) => t.id === task.id)) return;

    const key = `${(task.project_key || activeProject?.key || 'TM').toUpperCase()}-${task.id}`;
    let defaultStatus = 'In Progress';
    if (task.status === 'open') defaultStatus = 'To Do';

    const initialWorkState = task.status === 'resolved' ? 'completed' : 'not_completed';
    const initialStatus = initialWorkState === 'completed' ? 'QA Testing' : defaultStatus;

    const newTicket = {
      id: task.id,
      key,
      title: task.title,
      status: task.status,
      assignee: task.employee_name || task.assigned_to_name || 'Unassigned',
      employee_name: task.employee_name,
      assigned_to_name: task.assigned_to_name,
      project_id: task.project_id || activeProject?.id,
      project_name: task.project_name || activeProject?.name || '',
      workState: initialWorkState,
      taskStatus: initialStatus,
      blocker: '',
    };
    setSelectedTickets((prev) => [...prev, newTicket]);
    if (!taskTitle.trim()) {
      setTaskTitle(task.title);
    }
    if (!taskDescription.trim() && task.description) {
      setTaskDescription(task.description);
    }
    setErrors((prev) => {
      const next = { ...prev };
      delete next.taskTitle;
      return next;
    });
  }

  function handleUpdateTicket(ticketId, updates) {
    setSelectedTickets((prev) =>
      prev.map((t) => {
        if (t.id !== ticketId) return t;
        return { ...t, ...updates };
      })
    );
    if (updates.blocker && updates.blocker.trim()) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[`ticket_blocker_${ticketId}`];
        return next;
      });
    }
  }

  function handleRemoveTask(taskId) {
    setSelectedTickets((prev) => prev.filter((t) => t.id !== taskId));
    setErrors((prev) => {
      const next = { ...prev };
      delete next[`ticket_blocker_${taskId}`];
      return next;
    });
  }

  function handleClearLinked() {
    setSelectedTickets([]);
  }

  // A typed number is only worth resolving while it is still a number. The
  // lookup is debounced so a person typing a summary does not fire a request
  // per keystroke.
  useEffect(() => {
    const trimmed = taskTitle.trim();
    if (!TICKET_KEY.test(trimmed)) {
      setLinking(false);
      return undefined;
    }

    if (!activeProject?.id || !name) {
      setLinking(false);
      return undefined;
    }

    setLinking(true);
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const queryParams = new URLSearchParams({
          q: trimmed,
          limit: '10',
          excludeClosed: 'true',
          projectId: String(activeProject.id),
          userName: name,
        });
        const res = await fetch(
          `/api/tickets/search?${queryParams.toString()}`,
          { signal: controller.signal }
        );
        if (!res.ok) throw new Error('lookup failed');
        const data = await res.json();
        const wanted = trimmed.toUpperCase();
        const match = (data.tickets || []).find(
          (t) => `${t.project_key}-${t.id}`.toUpperCase() === wanted
        );
        if (match) {
          const matchAssignee = match.employee_name || match.assigned_to_name;
          if (matchAssignee !== name) return;
          if (match.project_id !== activeProject.id) return;
          if (match.status === 'closed') return;

          const matchKey = `${(match.project_key || activeProject?.key || 'TM').toUpperCase()}-${match.id}`;
          let defaultStatus = 'In Progress';
          if (match.status === 'open') defaultStatus = 'To Do';
          const initialWorkState = match.status === 'resolved' ? 'completed' : 'not_completed';
          const initialStatus = initialWorkState === 'completed' ? 'QA Testing' : defaultStatus;

          setSelectedTickets((prev) => {
            if (prev.some((t) => t.id === match.id)) return prev;
            return [
              ...prev,
              {
                id: match.id,
                key: matchKey,
                title: match.title,
                status: match.status,
                assignee: match.employee_name || match.assigned_to_name || 'Unassigned',
                employee_name: match.employee_name,
                assigned_to_name: match.assigned_to_name,
                project_id: match.project_id || activeProject.id,
                project_name: match.project_name || activeProject.name || '',
                workState: initialWorkState,
                taskStatus: initialStatus,
                blocker: '',
              },
            ];
          });
        }
      } catch {
        // preserve previous state
      } finally {
        setLinking(false);
      }
    }, 300);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [taskTitle, activeProject?.id, activeProject?.key, activeProject?.name, name]);

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

    if (selectedTickets.length > 0) {
      for (const t of selectedTickets) {
        if (t.workState === 'not_completed' && !t.blocker?.trim()) {
          next[`ticket_blocker_${t.id}`] = `Please describe what is blocking #${t.key}.`;
        }
      }
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
      if (first.startsWith('ticket_blocker_')) {
        const id = first.replace('ticket_blocker_', '');
        const el = document.getElementById(`ticket-blocker-${id}`);
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el?.focus({ preventScroll: true });
      } else {
        document
          .getElementById(`ts-${first}`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        document
          .querySelector(`#ts-${first} .idf-trigger, #ts-${first} input, #ts-${first} textarea`)
          ?.focus({ preventScroll: true });
      }
      return;
    }

    setBusy(true);
    const effectiveTaskState = selectedTickets.length > 0
      ? (selectedTickets.every((t) => t.workState === 'completed') ? 'completed' : 'not_completed')
      : taskState;

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
          taskState: effectiveTaskState,
          blocker: effectiveTaskState === 'not_completed' ? (selectedTickets.length === 0 ? blocker.trim() : null) : null,
          linkedTicketId: linked ? linked.id : null,
          selectedTickets,
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
        taskState: effectiveTaskState,
        blocker: effectiveTaskState === 'not_completed' ? blocker.trim() : null,
        selectedTickets,
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
    setSelectedTickets([]);
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

      <div className="ts-upper-section">
        <div className="ts-upper-header">
          <span className="ts-upper-title">Daily Work Information</span>
          <span className="ts-upper-badge">Step 1 of 2</span>
        </div>

        <div className={`form-group ts-field${errors.name ? ' has-error' : ''}`}
          id="ts-name"
          role="group"
          aria-label="Name">
          <span className="ts-legend">Name <span className="ts-required-star">*</span></span>
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
          <span className="ts-legend">Project <span className="ts-required-star">*</span></span>
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
          className={`form-group ts-field ts-field-wide${errors.hours ? ' has-error' : ''}`}
          id="ts-hours"
          role="group"
          aria-label="Approximate hours worked"
        >
          <span className="ts-legend">Approximate hours worked <span className="ts-required-star">*</span></span>
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
          <label htmlFor="ts-title">Task title or ticket number <span className="ts-required-star">*</span></label>

          {project && (
            <div className="ts-task-picker" style={{ marginBottom: 6 }}>
              <select
                id="ts-task-dropdown"
                className="ts-task-select"
                value=""
                disabled={!name || loadingTasks || projectTasks.length === 0 || projectTasks.filter((t) => !selectedTickets.some((st) => st.id === t.id)).length === 0}
                onChange={(e) => {
                  handleSelectTask(e.target.value);
                  e.target.value = '';
                }}
                aria-label={`Select an existing task from ${project}`}
              >
                <option value="">
                  {!name
                    ? '— Select your name above to view assigned tasks —'
                    : loadingTasks
                    ? `Loading tasks for ${name}...`
                    : projectTasks.length === 0
                    ? `No open tasks assigned to ${name} in ${project}`
                    : selectedTickets.length > 0
                    ? `+ Add another task from ${project} (optional)`
                    : `— Choose an existing task from ${project} (optional) —`}
                </option>
                {projectTasks
                  .filter((t) => !selectedTickets.some((st) => st.id === t.id))
                  .map((t) => (
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

          {selectedTickets.length > 0 && (
            <div className="ts-selected-tickets-list" style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
              {selectedTickets.map((t) => (
                <div key={t.id} className="ts-linked-task-card" role="region" aria-label={`Connected project task ${t.key}`}>
                  <div className="ts-linked-task-header">
                    <span className="ts-linked-task-key">#{t.key}</span>
                    <span className="ts-linked-task-title" style={{ fontWeight: 500, color: 'var(--text, #172b4d)' }}>{t.title}</span>
                    {t.status && (
                      <span
                        className="ts-status-badge"
                        style={{
                          backgroundColor: STATUS_META[t.status]?.bg || '#deebff',
                          color: STATUS_META[t.status]?.text || '#0747a6',
                        }}
                      >
                        <span
                          className="ts-status-dot"
                          style={{ backgroundColor: STATUS_META[t.status]?.color || '#579dff' }}
                        />
                        {STATUS_META[t.status]?.label || t.status}
                      </span>
                    )}
                    {t.assignee && (
                      <span className="ts-linked-task-assignee">
                        Assignee: <strong>{t.assignee}</strong>
                      </span>
                    )}
                    {t.key && (
                      <a
                        href={
                          t.project_id
                            ? `/projects/${t.project_id}/list?selectedIssue=${encodeURIComponent(t.key)}`
                            : `/work-items?selectedIssue=${encodeURIComponent(t.key)}`
                        }
                        target="_blank"
                        rel="noreferrer"
                        className="ts-linked-open-link"
                        title={`Open ${t.key} in project board`}
                      >
                        View on board ↗
                      </a>
                    )}
                    <button
                      type="button"
                      className="ts-linked-clear-btn"
                      onClick={() => handleRemoveTask(t.id)}
                      title={`Remove ${t.key}`}
                    >
                      ✕ Remove
                    </button>
                  </div>

                    <div className="ts-ticket-controls" style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border, #dfe1e6)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-subtle, #626f86)' }}>Work State:</span>
                      
                      {/* Completed option with dynamic status dropdown */}
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 13, cursor: 'pointer', fontWeight: t.workState === 'completed' ? 600 : 400 }}>
                          <input
                            type="radio"
                            name={`ticket-state-${t.id}`}
                            checked={t.workState === 'completed'}
                            onChange={() => handleUpdateTicket(t.id, {
                              workState: 'completed',
                              taskStatus: (t.taskStatus === 'QA Testing' || t.taskStatus === 'Closed') ? t.taskStatus : 'QA Testing',
                            })}
                          />
                          Completed
                        </label>
                        {t.workState === 'completed' && (
                          <select
                            id={`ticket-status-completed-${t.id}`}
                            className="ts-task-select"
                            value={t.taskStatus === 'Closed' ? 'Closed' : 'QA Testing'}
                            onChange={(e) => handleUpdateTicket(t.id, { taskStatus: e.target.value })}
                            style={{ width: 'auto', minWidth: 125, padding: '4px 10px', fontSize: 13 }}
                            aria-label={`Status for completed ticket #${t.key}`}
                          >
                            <option value="QA Testing">QA Testing</option>
                            <option value="Closed">Closed</option>
                          </select>
                        )}
                      </div>

                      {/* Not Completed option with dynamic status dropdown */}
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 13, cursor: 'pointer', fontWeight: t.workState === 'not_completed' ? 600 : 400 }}>
                          <input
                            type="radio"
                            name={`ticket-state-${t.id}`}
                            checked={t.workState === 'not_completed'}
                            onChange={() => handleUpdateTicket(t.id, {
                              workState: 'not_completed',
                              taskStatus: (t.taskStatus === 'To Do' || t.taskStatus === 'In Progress') ? t.taskStatus : 'In Progress',
                            })}
                          />
                          Not Completed
                        </label>
                        {t.workState === 'not_completed' && (
                          <select
                            id={`ticket-status-not-completed-${t.id}`}
                            className="ts-task-select"
                            value={t.taskStatus === 'To Do' ? 'To Do' : 'In Progress'}
                            onChange={(e) => handleUpdateTicket(t.id, { taskStatus: e.target.value })}
                            style={{ width: 'auto', minWidth: 125, padding: '4px 10px', fontSize: 13 }}
                            aria-label={`Status for incomplete ticket #${t.key}`}
                          >
                            <option value="To Do">To Do</option>
                            <option value="In Progress">In Progress</option>
                          </select>
                        )}
                      </div>
                    </div>

                    {/* Blocker description: required when Not Completed */}
                    {t.workState === 'not_completed' && (
                      <div className="ts-ticket-incomplete-fields" style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 12px', background: 'rgba(9, 30, 66, 0.03)', borderRadius: 6, border: '1px solid #dfe1e6' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }} id={`ts-ticket_blocker_${t.id}`}>
                          <label htmlFor={`ticket-blocker-${t.id}`} style={{ fontSize: 13, fontWeight: 600, color: 'var(--text, #172b4d)' }}>
                            What is blocking this task? <span style={{ color: 'var(--danger, #ae2a19)' }}>*</span>
                          </label>
                          <textarea
                            id={`ticket-blocker-${t.id}`}
                            rows={2}
                            value={t.blocker || ''}
                            placeholder="Waiting on a dependency, a review, access, a decision…"
                            onChange={(e) => handleUpdateTicket(t.id, { blocker: e.target.value })}
                            style={{
                              fontSize: 14,
                              padding: '8px 10px',
                              borderRadius: 4,
                              border: errors[`ticket_blocker_${t.id}`] ? '1px solid #ae2a19' : '1px solid #dfe1e6',
                            }}
                            aria-invalid={errors[`ticket_blocker_${t.id}`] ? 'true' : undefined}
                          />
                          {errors[`ticket_blocker_${t.id}`] && (
                            <span className="error-text" style={{ fontSize: 12, color: '#ae2a19', marginTop: 2 }}>
                              {errors[`ticket_blocker_${t.id}`]}
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {linking && selectedTickets.length === 0 && (
            <span className="ts-link-chip is-resolving">
              <CheckIcon size={12} aria-hidden="true" />
              Looking up work item…
            </span>
          )}
          {errors.taskTitle ? <span className="error-text">{errors.taskTitle}</span> : null}
        </div>
      </div>

      <div className="ts-grid">
        <div
          className={`form-group ts-field ts-field-wide${
            errors.taskDescription ? ' has-error' : ''
          }`}
          id="ts-taskDescription"
        >
          <label htmlFor="ts-description">Task description <span className="ts-required-star">*</span></label>
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
  const tickets = summary.selectedTickets?.length
    ? summary.selectedTickets
    : summary.linked
    ? [summary.linked]
    : [];

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
        {tickets.length > 0 ? (
          <div className="ts-confirmation-tickets" style={{ marginTop: 8, marginBottom: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {tickets.map((t) => {
              const isNotDone = t.workState === 'not_completed';
              return (
                <div key={t.id} className="ts-confirmation-line ts-confirmation-task" style={{ margin: '2px 0' }}>
                  <strong>#{t.key}:</strong>{' '}
                  <span>{isNotDone ? 'Not Completed' : 'Completed'}</span>
                  {isNotDone && t.taskStatus && (
                    <span>, {t.taskStatus}</span>
                  )}
                  {isNotDone && t.blocker ? (
                    <span>, blocker: {t.blocker}</span>
                  ) : (
                    !isNotDone ? <span>, no blocker required</span> : null
                  )}
                  {t.key && (
                    <>
                      {' · '}
                      <a
                        href={
                          t.project_id
                            ? `/projects/${t.project_id}/list?selectedIssue=${encodeURIComponent(t.key)}`
                            : `/work-items?selectedIssue=${encodeURIComponent(t.key)}`
                        }
                        target="_blank"
                        rel="noreferrer"
                        className="ts-linked-open-link"
                        style={{ fontSize: 13 }}
                      >
                        View on board ↗
                      </a>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="ts-confirmation-line ts-confirmation-task">
            {summary.taskTitle}
          </p>
        )}
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

'use client';

import { useState, useEffect } from 'react';
import Avatar from './Avatar';

const STATUS_TABS = [
  { value: 'all', label: 'All Workflows' },
  { value: 'pre_boarding', label: 'Pre-boarding' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed', label: 'Completed' },
];

function formatDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

export default function OnboardingView({ currentUser, employees = [] }) {
  const [workflows, setWorkflows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  // Modal: Start Onboarding
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedEmpId, setSelectedEmpId] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [buddyId, setBuddyId] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  // Drawer / Modal: Active Checklist Details
  const [activeWorkflow, setActiveWorkflow] = useState(null);
  const [loadingDetails, setLoadingDetails] = useState(false);

  // Add custom task state
  const [showAddTask, setShowAddTask] = useState(false);
  const [newTaskName, setNewTaskName] = useState('');
  const [newTaskCategory, setNewTaskCategory] = useState('General');
  const [addingTask, setAddingTask] = useState(false);

  async function fetchWorkflows() {
    setLoading(true);
    setError('');
    try {
      const url = statusFilter === 'all' ? '/api/onboarding' : `/api/onboarding?status=${statusFilter}`;
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load onboarding workflows');
      setWorkflows(data.workflows || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchWorkflows();
  }, [statusFilter]);

  async function openWorkflowDetails(wfId) {
    setLoadingDetails(true);
    try {
      const res = await fetch(`/api/onboarding/${wfId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load details');
      setActiveWorkflow(data.workflow);
    } catch (err) {
      alert(err.message);
    } finally {
      setLoadingDetails(false);
    }
  }

  async function handleCreateWorkflow(e) {
    e.preventDefault();
    if (!selectedEmpId) {
      setCreateError('Please select an employee.');
      return;
    }

    setCreating(true);
    setCreateError('');

    try {
      const res = await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employee_id: selectedEmpId,
          target_joining_date: targetDate || null,
          buddy_employee_id: buddyId || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to initiate onboarding');

      setShowCreateModal(false);
      setSelectedEmpId('');
      setTargetDate('');
      setBuddyId('');
      await fetchWorkflows();
      if (data.workflow?.id) {
        openWorkflowDetails(data.workflow.id);
      }
    } catch (err) {
      setCreateError(err.message);
    } finally {
      setCreating(false);
    }
  }

  async function handleToggleItem(itemId, currentStatus) {
    if (!activeWorkflow) return;
    const newStatus = currentStatus === 'completed' ? 'pending' : 'completed';

    try {
      const res = await fetch(`/api/onboarding/${activeWorkflow.id}/items/${itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update item');
      setActiveWorkflow(data.workflow);
      await fetchWorkflows();
    } catch (err) {
      alert(err.message);
    }
  }

  async function handleAddTask(e) {
    e.preventDefault();
    if (!activeWorkflow || !newTaskName.trim()) return;

    setAddingTask(true);
    try {
      const res = await fetch(`/api/onboarding/${activeWorkflow.id}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task_name: newTaskName.trim(),
          category: newTaskCategory,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to add task');

      setNewTaskName('');
      setShowAddTask(false);
      openWorkflowDetails(activeWorkflow.id);
      await fetchWorkflows();
    } catch (err) {
      alert(err.message);
    } finally {
      setAddingTask(false);
    }
  }

  async function handleCompleteWorkflow(wfId) {
    if (!confirm('Mark this employee onboarding workflow as complete?')) return;
    try {
      const res = await fetch(`/api/onboarding/${wfId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to complete workflow');
      if (activeWorkflow?.id === wfId) setActiveWorkflow(data.workflow);
      await fetchWorkflows();
    } catch (err) {
      alert(err.message);
    }
  }

  async function handleDeleteWorkflow(wfId) {
    if (!confirm('Are you sure you want to delete this onboarding workflow?')) return;
    try {
      const res = await fetch(`/api/onboarding/${wfId}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete workflow');
      if (activeWorkflow?.id === wfId) setActiveWorkflow(null);
      await fetchWorkflows();
    } catch (err) {
      alert(err.message);
    }
  }

  // Summary counts
  const totalCount = workflows.length;
  const inProgressCount = workflows.filter((w) => w.status === 'in_progress').length;
  const preBoardingCount = workflows.filter((w) => w.status === 'pre_boarding').length;
  const completedCount = workflows.filter((w) => w.status === 'completed').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Top Header & Metrics */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Onboarding Management</h2>
          <p style={{ fontSize: 13, color: 'var(--text-subtle)', margin: '4px 0 0 0' }}>
            Coordinate new hire documentation, IT setup, orientation, and asset allocation
          </p>
        </div>
        {currentUser?.role === 'admin' && (
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              setShowCreateModal(true);
              setCreateError('');
            }}
          >
            + Start Onboarding
          </button>
        )}
      </div>

      {/* Metric Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <div style={{ padding: '12px 16px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
          <div style={{ fontSize: 12, color: 'var(--text-subtle)', fontWeight: 500 }}>Active Pipelines</div>
          <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>{inProgressCount + preBoardingCount}</div>
        </div>
        <div style={{ padding: '12px 16px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
          <div style={{ fontSize: 12, color: 'var(--text-subtle)', fontWeight: 500 }}>Pre-boarding</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#2563eb', marginTop: 4 }}>{preBoardingCount}</div>
        </div>
        <div style={{ padding: '12px 16px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
          <div style={{ fontSize: 12, color: 'var(--text-subtle)', fontWeight: 500 }}>In Progress</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#d97706', marginTop: 4 }}>{inProgressCount}</div>
        </div>
        <div style={{ padding: '12px 16px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
          <div style={{ fontSize: 12, color: 'var(--text-subtle)', fontWeight: 500 }}>Completed</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#16a34a', marginTop: 4 }}>{completedCount}</div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div style={{ display: 'flex', gap: 8, borderBottom: '1px solid var(--border)', paddingBottom: 6 }}>
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            className={`tab-button${statusFilter === tab.value ? ' active' : ''}`}
            onClick={() => setStatusFilter(tab.value)}
            style={{
              padding: '6px 14px',
              fontSize: 13,
              fontWeight: 500,
              background: statusFilter === tab.value ? 'var(--bg-hover)' : 'transparent',
              border: 'none',
              borderRadius: 'var(--radius)',
              cursor: 'pointer',
              color: statusFilter === tab.value ? 'var(--primary)' : 'var(--text-subtle)',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Workflows List */}
      {loading ? (
        <div style={{ padding: 36, textAlign: 'center', color: 'var(--text-subtle)' }}>Loading onboarding workflows…</div>
      ) : error ? (
        <div style={{ padding: 14, background: 'rgba(239, 68, 68, 0.1)', color: 'var(--danger)', borderRadius: 6 }}>{error}</div>
      ) : workflows.length === 0 ? (
        <div style={{ padding: 48, textAlign: 'center', border: '1px dashed var(--border)', borderRadius: 8, color: 'var(--text-subtle)' }}>
          No onboarding workflows found. Click "+ Start Onboarding" to create one.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {workflows.map((wf) => {
            const isCompleted = wf.status === 'completed';
            const isInProgress = wf.status === 'in_progress';

            const statusBg = isCompleted
              ? 'rgba(34, 197, 94, 0.15)'
              : isInProgress
              ? 'rgba(234, 179, 8, 0.15)'
              : 'rgba(59, 130, 246, 0.15)';
            const statusColor = isCompleted ? '#15803d' : isInProgress ? '#b45309' : '#1d4ed8';

            return (
              <div
                key={wf.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '14px 18px',
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  gap: 16,
                  flexWrap: 'wrap',
                }}
              >
                {/* Employee Info */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 220 }}>
                  <Avatar name={wf.employee_name} assigned size={40} />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{wf.employee_name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>
                      {wf.designation_title || 'New Hire'} {wf.department_name ? `· ${wf.department_name}` : ''}
                    </div>
                  </div>
                </div>

                {/* Dates & Buddy */}
                <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>
                  <div>Joining: <strong>{formatDate(wf.target_joining_date)}</strong></div>
                  <div>Buddy: <strong>{wf.buddy_name || 'None'}</strong></div>
                </div>

                {/* Progress Bar */}
                <div style={{ minWidth: 160, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 500 }}>
                    <span>Progress</span>
                    <span>{wf.completed_tasks}/{wf.total_tasks} ({wf.progress_percent}%)</span>
                  </div>
                  <div style={{ height: 6, background: 'var(--bg-hover)', borderRadius: 3, overflow: 'hidden' }}>
                    <div
                      style={{
                        height: '100%',
                        width: `${wf.progress_percent}%`,
                        background: isCompleted ? '#22c55e' : 'var(--primary, #3b82f6)',
                        transition: 'width 0.3s ease',
                      }}
                    />
                  </div>
                </div>

                {/* Status Pill */}
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    padding: '3px 10px',
                    borderRadius: 999,
                    background: statusBg,
                    color: statusColor,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                  }}
                >
                  {wf.status.replace('_', ' ')}
                </span>

                {/* Actions */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => openWorkflowDetails(wf.id)}
                    style={{ fontSize: 12, padding: '5px 12px' }}
                  >
                    View Checklist
                  </button>
                  {currentUser?.role === 'admin' && (
                    <button
                      type="button"
                      onClick={() => handleDeleteWorkflow(wf.id)}
                      style={{ background: 'transparent', border: 'none', color: 'var(--text-subtle)', cursor: 'pointer', fontSize: 16 }}
                      title="Delete workflow"
                    >
                      ×
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Start Onboarding Modal */}
      {showCreateModal && (
        <div className="modal-overlay" onMouseDown={() => setShowCreateModal(false)}>
          <div
            className="modal"
            style={{ maxWidth: 500 }}
            role="dialog"
            aria-modal="true"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <header>
              <h3>Start Employee Onboarding</h3>
              <button type="button" className="modal-close" onClick={() => setShowCreateModal(false)}>×</button>
            </header>

            <form onSubmit={handleCreateWorkflow} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {createError && (
                <div style={{ padding: 10, background: 'rgba(239, 68, 68, 0.1)', color: 'var(--danger)', borderRadius: 6, fontSize: 13 }}>
                  {createError}
                </div>
              )}

              <div className="form-group">
                <label>Select Employee *</label>
                <select
                  value={selectedEmpId}
                  onChange={(e) => setSelectedEmpId(e.target.value)}
                  required
                >
                  <option value="">-- Choose Employee --</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.name} ({emp.email || 'No email'}) - {emp.title || 'Developer'}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Target Joining Date</label>
                <input
                  type="date"
                  value={targetDate}
                  onChange={(e) => setTargetDate(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label>Assign Onboarding Buddy (Optional)</label>
                <select
                  value={buddyId}
                  onChange={(e) => setBuddyId(e.target.value)}
                >
                  <option value="">-- No Buddy Assigned --</option>
                  {employees
                    .filter((emp) => String(emp.id) !== String(selectedEmpId))
                    .map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.name} ({emp.department || 'General'})
                      </option>
                    ))}
                </select>
              </div>

              <div className="modal-actions" style={{ marginTop: 16 }}>
                <button type="button" className="btn-secondary" onClick={() => setShowCreateModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={creating}>
                  {creating ? 'Starting…' : 'Start Onboarding'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Active Checklist Details Modal */}
      {activeWorkflow && (
        <div className="modal-overlay" onMouseDown={() => setActiveWorkflow(null)}>
          <div
            className="modal"
            style={{ maxWidth: 680, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
            role="dialog"
            aria-modal="true"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <header>
              <div>
                <h3 style={{ margin: 0 }}>Onboarding Checklist: {activeWorkflow.employee_name}</h3>
                <span style={{ fontSize: 12, color: 'var(--text-subtle)' }}>
                  Target Joining: {formatDate(activeWorkflow.target_joining_date)} · Status: {activeWorkflow.status.replace('_', ' ')}
                </span>
              </div>
              <button type="button" className="modal-close" onClick={() => setActiveWorkflow(null)}>×</button>
            </header>

            {/* Checklist items list */}
            <div style={{ flex: 1, overflowY: 'auto', paddingRight: 4, display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Progress Summary */}
              <div style={{ padding: '10px 14px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
                  <span>Tasks Completed: {activeWorkflow.completed_tasks} of {activeWorkflow.total_tasks}</span>
                  <strong>{activeWorkflow.progress_percent}%</strong>
                </div>
                <div style={{ height: 8, background: 'var(--bg-hover)', borderRadius: 4, overflow: 'hidden' }}>
                  <div
                    style={{
                      height: '100%',
                      width: `${activeWorkflow.progress_percent}%`,
                      background: activeWorkflow.status === 'completed' ? '#22c55e' : 'var(--primary, #3b82f6)',
                    }}
                  />
                </div>
              </div>

              {/* Tasks list */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {activeWorkflow.items?.map((item) => {
                  const isDone = item.status === 'completed';
                  return (
                    <div
                      key={item.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '8px 12px',
                        background: isDone ? 'rgba(34, 197, 94, 0.05)' : 'var(--bg-surface)',
                        border: '1px solid var(--border)',
                        borderRadius: 6,
                        gap: 12,
                      }}
                    >
                      <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', flex: 1, minWidth: 0, margin: 0 }}>
                        <input
                          type="checkbox"
                          checked={isDone}
                          onChange={() => handleToggleItem(item.id, item.status)}
                          style={{ width: 16, height: 16, cursor: 'pointer' }}
                        />
                        <div>
                          <div style={{ fontSize: 13, textDecoration: isDone ? 'line-through' : 'none', color: isDone ? 'var(--text-subtle)' : 'inherit' }}>
                            {item.task_name}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>
                            Category: {item.category} {item.completed_at ? `· Completed on ${formatDate(item.completed_at)}` : ''}
                          </div>
                        </div>
                      </label>
                    </div>
                  );
                })}
              </div>

              {/* Add custom task button / form */}
              {showAddTask ? (
                <form
                  onSubmit={handleAddTask}
                  style={{
                    padding: 12,
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: 12 }}>Add Custom Task</div>
                  <input
                    type="text"
                    value={newTaskName}
                    onChange={(e) => setNewTaskName(e.target.value)}
                    placeholder="e.g. Schedule team lunch or security clearance"
                    style={{ fontSize: 13 }}
                    required
                  />
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                    <button type="button" className="btn-secondary" onClick={() => setShowAddTask(false)}>
                      Cancel
                    </button>
                    <button type="submit" className="btn-primary" disabled={addingTask}>
                      {addingTask ? 'Adding…' : 'Add Task'}
                    </button>
                  </div>
                </form>
              ) : (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowAddTask(true)}
                  style={{ fontSize: 12, alignSelf: 'flex-start' }}
                >
                  + Add Custom Checklist Task
                </button>
              )}
            </div>

            {/* Footer */}
            <div className="modal-actions" style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
              {activeWorkflow.status !== 'completed' && currentUser?.role === 'admin' && (
                <button
                  type="button"
                  onClick={() => handleCompleteWorkflow(activeWorkflow.id)}
                  style={{
                    background: 'rgba(34, 197, 94, 0.15)',
                    color: '#15803d',
                    border: '1px solid rgba(34, 197, 94, 0.3)',
                    borderRadius: 4,
                    padding: '6px 14px',
                    fontSize: 13,
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                >
                  Complete Onboarding
                </button>
              )}
              <button type="button" className="btn-secondary" onClick={() => setActiveWorkflow(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


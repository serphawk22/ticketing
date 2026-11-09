'use client';

import { useState, useEffect } from 'react';
import Avatar from './Avatar';

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

export default function ExitManagementView({ currentUser, employees = [] }) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  // Initiate Exit Modal
  const [showInitiateModal, setShowInitiateModal] = useState(false);
  const [selectedEmpId, setSelectedEmpId] = useState('');
  const [resignationDate, setResignationDate] = useState(new Date().toISOString().slice(0, 10));
  const [noticeDays, setNoticeDays] = useState(30);
  const [lastWorkingDay, setLastWorkingDay] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [initiateError, setInitiateError] = useState('');

  // Active Clearance Review Drawer/Modal
  const [activeRequest, setActiveRequest] = useState(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [reassignTargetId, setReassignTargetId] = useState('');
  const [reassigning, setReassigning] = useState(false);
  const [interviewNotes, setInterviewNotes] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);

  const isAdmin = currentUser?.role === 'admin';

  async function fetchRequests() {
    setLoading(true);
    setError('');
    try {
      const url = statusFilter === 'all' ? '/api/exit' : `/api/exit?status=${statusFilter}`;
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load exit requests');
      setRequests(data.requests || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchRequests();
  }, [statusFilter]);

  // Auto-calculate LWD when resignation date or notice days change
  useEffect(() => {
    if (resignationDate && noticeDays) {
      const d = new Date(resignationDate);
      d.setDate(d.getDate() + Number(noticeDays));
      setLastWorkingDay(d.toISOString().slice(0, 10));
    }
  }, [resignationDate, noticeDays]);

  async function openReview(reqId) {
    setLoadingDetails(true);
    try {
      const res = await fetch(`/api/exit/${reqId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load exit details');
      setActiveRequest(data.request);
      setInterviewNotes(data.request.exit_interview_notes || '');
    } catch (err) {
      alert(err.message);
    } finally {
      setLoadingDetails(false);
    }
  }

  async function handleInitiateExit(e) {
    e.preventDefault();
    if (!selectedEmpId) {
      setInitiateError('Please select an employee.');
      return;
    }

    setSubmitting(true);
    setInitiateError('');

    try {
      const res = await fetch('/api/exit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employee_id: selectedEmpId,
          resignation_date: resignationDate,
          last_working_day: lastWorkingDay,
          notice_period_days: noticeDays,
          reason,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to initiate exit');

      setShowInitiateModal(false);
      setSelectedEmpId('');
      setReason('');
      await fetchRequests();
      if (data.request?.id) openReview(data.request.id);
    } catch (err) {
      setInitiateError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggleClearance(dept, currentlyCleared) {
    if (!activeRequest) return;
    try {
      const res = await fetch(`/api/exit/${activeRequest.id}/clearance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          department: dept,
          cleared: !currentlyCleared,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update clearance');
      setActiveRequest(data.request);
      await fetchRequests();
    } catch (err) {
      alert(err.message);
    }
  }

  async function handleToggleItem(itemId, currentStatus) {
    if (!activeRequest) return;
    const newStatus = currentStatus === 'completed' ? 'pending' : 'completed';
    try {
      const res = await fetch(`/api/exit/${activeRequest.id}/items/${itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update task');
      setActiveRequest(data.request);
      await fetchRequests();
    } catch (err) {
      alert(err.message);
    }
  }

  async function handleReassignTickets(e) {
    e.preventDefault();
    if (!activeRequest || !reassignTargetId) return;

    setReassigning(true);
    try {
      const res = await fetch(`/api/exit/${activeRequest.id}/reassign-tickets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_employee_id: reassignTargetId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to reassign tickets');

      alert(`Successfully reassigned ${data.reassigned_count} tickets to ${data.target_employee_name}.`);
      setActiveRequest(data.request);
      setReassignTargetId('');
      await fetchRequests();
    } catch (err) {
      alert(err.message);
    } finally {
      setReassigning(false);
    }
  }

  async function handleSaveInterviewNotes() {
    if (!activeRequest) return;
    setSavingNotes(true);
    try {
      const res = await fetch(`/api/exit/${activeRequest.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exit_interview_notes: interviewNotes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save notes');
      setActiveRequest(data.request);
      alert('Exit interview notes saved.');
    } catch (err) {
      alert(err.message);
    } finally {
      setSavingNotes(false);
    }
  }

  async function handleDelete(reqId) {
    if (!confirm('Are you sure you want to cancel and remove this exit request?')) return;
    try {
      const res = await fetch(`/api/exit/${reqId}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete exit request');
      if (activeRequest?.id === reqId) setActiveRequest(null);
      await fetchRequests();
    } catch (err) {
      alert(err.message);
    }
  }

  // Summary counts
  const totalCount = requests.length;
  const inClearanceCount = requests.filter((r) => ['submitted', 'under_review', 'in_progress'].includes(r.status)).length;
  const completedCount = requests.filter((r) => r.status === 'completed').length;
  const pendingAssetsTotal = requests.reduce((acc, r) => acc + Number(r.allocated_assets_count || 0), 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Exit & Separation Management</h2>
          <p style={{ fontSize: 13, color: 'var(--text-subtle)', margin: '4px 0 0 0' }}>
            Coordinate resignations, LWD, IT/Asset/Finance clearances, ticket handover, and NOC issuance
          </p>
        </div>
        {isAdmin && (
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              setShowInitiateModal(true);
              setInitiateError('');
            }}
          >
            + Initiate Exit / Resignation
          </button>
        )}
      </div>

      {/* Metric Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <div style={{ padding: '12px 16px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
          <div style={{ fontSize: 12, color: 'var(--text-subtle)', fontWeight: 500 }}>Total Separations</div>
          <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>{totalCount}</div>
        </div>
        <div style={{ padding: '12px 16px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
          <div style={{ fontSize: 12, color: 'var(--text-subtle)', fontWeight: 500 }}>Active in Notice / Clearance</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#d97706', marginTop: 4 }}>{inClearanceCount}</div>
        </div>
        <div style={{ padding: '12px 16px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
          <div style={{ fontSize: 12, color: 'var(--text-subtle)', fontWeight: 500 }}>Completed & NOC Issued</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#16a34a', marginTop: 4 }}>{completedCount}</div>
        </div>
        <div style={{ padding: '12px 16px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
          <div style={{ fontSize: 12, color: 'var(--text-subtle)', fontWeight: 500 }}>Unrecovered Assets in Exit</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: pendingAssetsTotal > 0 ? '#ef4444' : 'inherit', marginTop: 4 }}>
            {pendingAssetsTotal}
          </div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div style={{ display: 'flex', gap: 8, borderBottom: '1px solid var(--border)', paddingBottom: 6 }}>
        <button
          type="button"
          className={`tab-button${statusFilter === 'all' ? ' active' : ''}`}
          onClick={() => setStatusFilter('all')}
          style={{
            padding: '6px 14px',
            fontSize: 13,
            fontWeight: 500,
            background: statusFilter === 'all' ? 'var(--bg-hover)' : 'transparent',
            border: 'none',
            borderRadius: 'var(--radius)',
            cursor: 'pointer',
            color: statusFilter === 'all' ? 'var(--primary)' : 'var(--text-subtle)',
          }}
        >
          All Requests
        </button>
        <button
          type="button"
          className={`tab-button${statusFilter === 'in_progress' ? ' active' : ''}`}
          onClick={() => setStatusFilter('in_progress')}
          style={{
            padding: '6px 14px',
            fontSize: 13,
            fontWeight: 500,
            background: statusFilter === 'in_progress' ? 'var(--bg-hover)' : 'transparent',
            border: 'none',
            borderRadius: 'var(--radius)',
            cursor: 'pointer',
            color: statusFilter === 'in_progress' ? 'var(--primary)' : 'var(--text-subtle)',
          }}
        >
          In Clearance
        </button>
        <button
          type="button"
          className={`tab-button${statusFilter === 'completed' ? ' active' : ''}`}
          onClick={() => setStatusFilter('completed')}
          style={{
            padding: '6px 14px',
            fontSize: 13,
            fontWeight: 500,
            background: statusFilter === 'completed' ? 'var(--bg-hover)' : 'transparent',
            border: 'none',
            borderRadius: 'var(--radius)',
            cursor: 'pointer',
            color: statusFilter === 'completed' ? 'var(--primary)' : 'var(--text-subtle)',
          }}
        >
          Completed
        </button>
      </div>

      {/* Requests Table */}
      {loading ? (
        <div style={{ padding: 36, textAlign: 'center', color: 'var(--text-subtle)' }}>Loading exit requests…</div>
      ) : error ? (
        <div style={{ padding: 14, background: 'rgba(239, 68, 68, 0.1)', color: 'var(--danger)', borderRadius: 6 }}>{error}</div>
      ) : requests.length === 0 ? (
        <div style={{ padding: 48, textAlign: 'center', border: '1px dashed var(--border)', borderRadius: 8, color: 'var(--text-subtle)' }}>
          No exit requests found.
        </div>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Resignation Date</th>
                <th>Last Working Day</th>
                <th>Department Clearances</th>
                <th>Liabilities</th>
                <th>Status</th>
                <th>NOC</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => {
                const isCompleted = r.status === 'completed';
                const hasAssets = Number(r.allocated_assets_count || 0) > 0;
                const hasTickets = Number(r.open_tickets_count || 0) > 0;

                return (
                  <tr key={r.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <Avatar name={r.employee_name} size={32} assigned />
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{r.employee_name}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{r.department_name || 'General'}</div>
                        </div>
                      </div>
                    </td>
                    <td>{formatDate(r.resignation_date)}</td>
                    <td>
                      <strong>{formatDate(r.last_working_day)}</strong>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: r.hr_clearance ? '#dcfce7' : '#f3f4f6', color: r.hr_clearance ? '#15803d' : '#6b7280', fontWeight: 600 }}>
                          HR {r.hr_clearance ? '✓' : '—'}
                        </span>
                        <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: r.it_clearance ? '#dcfce7' : '#f3f4f6', color: r.it_clearance ? '#15803d' : '#6b7280', fontWeight: 600 }}>
                          IT {r.it_clearance ? '✓' : '—'}
                        </span>
                        <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: r.finance_clearance ? '#dcfce7' : '#f3f4f6', color: r.finance_clearance ? '#15803d' : '#6b7280', fontWeight: 600 }}>
                          FIN {r.finance_clearance ? '✓' : '—'}
                        </span>
                      </div>
                    </td>
                    <td>
                      <div style={{ fontSize: 11 }}>
                        <span style={{ color: hasTickets ? '#b45309' : 'var(--text-subtle)', fontWeight: hasTickets ? 600 : 400 }}>
                          {r.open_tickets_count || 0} Tickets
                        </span>
                        {' · '}
                        <span style={{ color: hasAssets ? '#dc2626' : 'var(--text-subtle)', fontWeight: hasAssets ? 600 : 400 }}>
                          {r.allocated_assets_count || 0} Assets
                        </span>
                      </div>
                    </td>
                    <td>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          padding: '2px 8px',
                          borderRadius: 999,
                          background: isCompleted ? 'rgba(34, 197, 94, 0.12)' : 'rgba(234, 179, 8, 0.12)',
                          color: isCompleted ? '#15803d' : '#b45309',
                          textTransform: 'uppercase',
                        }}
                      >
                        {r.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          color: r.noc_status === 'approved' || r.noc_status === 'issued' ? '#16a34a' : 'var(--text-subtle)',
                        }}
                      >
                        {r.noc_status === 'approved' || r.noc_status === 'issued' ? 'Issued ✓' : 'Pending'}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => openReview(r.id)}
                          style={{ fontSize: 11, padding: '3px 8px' }}
                        >
                          Clearance Review
                        </button>
                        {isAdmin && !isCompleted && (
                          <button
                            type="button"
                            onClick={() => handleDelete(r.id)}
                            style={{ background: 'transparent', border: 'none', color: 'var(--text-subtle)', cursor: 'pointer', fontSize: 14 }}
                            title="Cancel exit request"
                          >
                            ×
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Initiate Exit Modal */}
      {showInitiateModal && (
        <div className="modal-overlay" onMouseDown={() => setShowInitiateModal(false)}>
          <div
            className="modal"
            style={{ maxWidth: 500 }}
            role="dialog"
            aria-modal="true"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <header>
              <h3>Initiate Employee Exit / Resignation</h3>
              <button type="button" className="modal-close" onClick={() => setShowInitiateModal(false)}>×</button>
            </header>

            <form onSubmit={handleInitiateExit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {initiateError && (
                <div style={{ padding: 10, background: 'rgba(239, 68, 68, 0.1)', color: 'var(--danger)', borderRadius: 6, fontSize: 13 }}>
                  {initiateError}
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
                  {employees
                    .filter((e) => e.active)
                    .map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.name} ({emp.title || 'Developer'})
                      </option>
                    ))}
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label>Resignation Date *</label>
                  <input
                    type="date"
                    value={resignationDate}
                    onChange={(e) => setResignationDate(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group">
                  <label>Notice Period (Days)</label>
                  <input
                    type="number"
                    min="0"
                    max="180"
                    value={noticeDays}
                    onChange={(e) => setNoticeDays(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Calculated Last Working Day (LWD)</label>
                <input
                  type="date"
                  value={lastWorkingDay}
                  onChange={(e) => setLastWorkingDay(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label>Reason for Leaving</label>
                <textarea
                  rows="2"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Higher education, relocation, personal reasons, career progression"
                />
              </div>

              <div className="modal-actions" style={{ marginTop: 14 }}>
                <button type="button" className="btn-secondary" onClick={() => setShowInitiateModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={submitting}>
                  {submitting ? 'Initiating…' : 'Initiate Exit'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Clearance Review Drawer / Modal */}
      {activeRequest && (
        <div className="modal-overlay" onMouseDown={() => setActiveRequest(null)}>
          <div
            className="modal"
            style={{ maxWidth: 720, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
            role="dialog"
            aria-modal="true"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <header>
              <div>
                <h3 style={{ margin: 0 }}>Exit Clearance Review: {activeRequest.employee_name}</h3>
                <span style={{ fontSize: 12, color: 'var(--text-subtle)' }}>
                  LWD: <strong>{formatDate(activeRequest.last_working_day)}</strong> · Status: {activeRequest.status.replace('_', ' ')}
                </span>
              </div>
              <button type="button" className="modal-close" onClick={() => setActiveRequest(null)}>×</button>
            </header>

            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Clearance Switches */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                {/* HR */}
                <div style={{ padding: 12, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 6, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>HR Clearance</div>
                  <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>Interview & relieving docs</div>
                  <button
                    type="button"
                    onClick={() => handleToggleClearance('hr', activeRequest.hr_clearance)}
                    style={{
                      background: activeRequest.hr_clearance ? '#dcfce7' : 'var(--bg-hover)',
                      color: activeRequest.hr_clearance ? '#15803d' : 'inherit',
                      border: 'none',
                      borderRadius: 4,
                      padding: '5px 10px',
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    {activeRequest.hr_clearance ? 'Cleared ✓' : 'Mark Cleared'}
                  </button>
                </div>

                {/* IT */}
                <div style={{ padding: 12, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 6, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>IT Clearance</div>
                  <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>Access & credentials revoked</div>
                  <button
                    type="button"
                    onClick={() => handleToggleClearance('it', activeRequest.it_clearance)}
                    style={{
                      background: activeRequest.it_clearance ? '#dcfce7' : 'var(--bg-hover)',
                      color: activeRequest.it_clearance ? '#15803d' : 'inherit',
                      border: 'none',
                      borderRadius: 4,
                      padding: '5px 10px',
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    {activeRequest.it_clearance ? 'Cleared ✓' : 'Mark Cleared'}
                  </button>
                </div>

                {/* Finance */}
                <div style={{ padding: 12, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 6, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>Finance Clearance</div>
                  <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>Claims & final settlement</div>
                  <button
                    type="button"
                    onClick={() => handleToggleClearance('finance', activeRequest.finance_clearance)}
                    style={{
                      background: activeRequest.finance_clearance ? '#dcfce7' : 'var(--bg-hover)',
                      color: activeRequest.finance_clearance ? '#15803d' : 'inherit',
                      border: 'none',
                      borderRadius: 4,
                      padding: '5px 10px',
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    {activeRequest.finance_clearance ? 'Cleared ✓' : 'Mark Cleared'}
                  </button>
                </div>
              </div>

              {/* NOC Banner if completed */}
              {(activeRequest.noc_status === 'approved' || activeRequest.noc_status === 'issued') && (
                <div style={{ padding: '12px 16px', background: 'rgba(34, 197, 94, 0.15)', border: '1px solid #16a34a', borderRadius: 6, color: '#15803d', fontWeight: 600, fontSize: 13 }}>
                  No Objection Certificate (NOC) Approved · Employee separation completed and record deactivated.
                </div>
              )}

              {/* Unreturned Company Assets Warning */}
              {activeRequest.assets?.length > 0 && (
                <div style={{ padding: 12, background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: 6 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: '#b91c1c' }}>
                    Active Company Assets in Custody ({activeRequest.assets.length})
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginBottom: 8 }}>
                    All hardware and equipment must be returned before issuing final NOC.
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {activeRequest.assets.map((ast) => (
                      <div key={ast.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, background: 'var(--bg-surface)', padding: '6px 10px', borderRadius: 4 }}>
                        <span><strong>{ast.asset_tag}</strong> - {ast.name} ({ast.category})</span>
                        <span style={{ color: 'var(--text-subtle)' }}>Serial: {ast.serial_number || 'N/A'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Open Tickets Reassignment */}
              {activeRequest.open_tickets?.length > 0 && (
                <div style={{ padding: 12, background: 'rgba(234, 179, 8, 0.08)', border: '1px solid rgba(234, 179, 8, 0.3)', borderRadius: 6 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: '#b45309' }}>
                    Open Tickets Assigned to Exiting Employee ({activeRequest.open_tickets.length})
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginBottom: 10 }}>
                    Reassign ongoing tasks to prevent blocked deliverables.
                  </div>
                  <form onSubmit={handleReassignTickets} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <select
                      value={reassignTargetId}
                      onChange={(e) => setReassignTargetId(e.target.value)}
                      style={{ flex: 1, fontSize: 13, height: 34 }}
                      required
                    >
                      <option value="">-- Reassign all open tickets to… --</option>
                      {employees
                        .filter((e) => e.active && e.id !== activeRequest.employee_id)
                        .map((emp) => (
                          <option key={emp.id} value={emp.id}>
                            {emp.name} ({emp.title || 'Developer'})
                          </option>
                        ))}
                    </select>
                    <button type="submit" className="btn-secondary" disabled={reassigning} style={{ fontSize: 12, height: 34 }}>
                      {reassigning ? 'Reassigning…' : 'Bulk Reassign'}
                    </button>
                  </form>
                </div>
              )}

              {/* Checklist Tasks */}
              <div>
                <h4 style={{ margin: '0 0 8px 0', fontSize: 13 }}>Exit Procedure Checklist</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {activeRequest.items?.map((item) => {
                    const isDone = item.status === 'completed';
                    return (
                      <label
                        key={item.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          padding: '8px 12px',
                          background: isDone ? 'rgba(34, 197, 94, 0.05)' : 'var(--bg-surface)',
                          border: '1px solid var(--border)',
                          borderRadius: 6,
                          cursor: 'pointer',
                          margin: 0,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isDone}
                          onChange={() => handleToggleItem(item.id, item.status)}
                          style={{ width: 16, height: 16, cursor: 'pointer' }}
                        />
                        <div style={{ flex: 1 }}>
                          <span style={{ fontSize: 13, textDecoration: isDone ? 'line-through' : 'none', color: isDone ? 'var(--text-subtle)' : 'inherit' }}>
                            {item.task_name}
                          </span>
                          <span style={{ fontSize: 11, color: 'var(--text-subtle)', marginLeft: 8 }}>
                            [{item.category}]
                          </span>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Exit Interview Notes */}
              <div className="form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <label style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>Exit Interview Notes & Handover Summary</label>
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={handleSaveInterviewNotes}
                    disabled={savingNotes}
                    style={{ fontSize: 11, padding: '2px 8px' }}
                  >
                    {savingNotes ? 'Saving…' : 'Save Notes'}
                  </button>
                </div>
                <textarea
                  rows="3"
                  value={interviewNotes}
                  onChange={(e) => setInterviewNotes(e.target.value)}
                  placeholder="Record employee feedback, reasons for separation, knowledge transfer notes..."
                />
              </div>
            </div>

            <div className="modal-actions" style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
              <button type="button" className="btn-secondary" onClick={() => setActiveRequest(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

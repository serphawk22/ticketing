'use client';

import { useState, useEffect } from 'react';
import { getLeaveTypeLabel, getLeaveDayTypeLabel } from '@/lib/attendanceMeta';

export default function AdminLeaveRequestsView({ onRosterRefresh }) {
  const [requests, setRequests] = useState([]);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Conflict modal state
  const [conflictModalOpen, setConflictModalOpen] = useState(false);
  const [activeRequest, setActiveRequest] = useState(null);
  const [conflicts, setConflicts] = useState([]);
  const [conflictResolutions, setConflictResolutions] = useState({});
  const [reviewerNotes, setReviewerNotes] = useState('');
  const [processing, setProcessing] = useState(false);

  // Reject modal state
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [rejectNotes, setRejectNotes] = useState('');

  async function fetchRequests() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/attendance/leave/admin?status=${statusFilter}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch leave requests.');
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

  async function handleInitiateApprove(req) {
    setActiveRequest(req);
    setError(null);
    setProcessing(true);

    try {
      // Pre-scan for conflicts
      const res = await fetch('/api/attendance/leave/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: req.id, checkConflictsOnly: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to inspect attendance conflicts.');

      const detected = data.conflicts || [];
      if (detected.length > 0) {
        setConflicts(detected);
        const initialResolutions = {};
        for (const c of detected) {
          initialResolutions[c.date] = 'keep_attendance';
        }
        setConflictResolutions(initialResolutions);
        setReviewerNotes('');
        setConflictModalOpen(true);
      } else {
        // Direct clean approval
        await executeProcess(req.id, 'approve', {}, 'Approved by Admin');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setProcessing(false);
    }
  }

  async function executeProcess(requestId, action, resolutions = {}, notes = '') {
    setProcessing(true);
    setError(null);

    try {
      const res = await fetch('/api/attendance/leave/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId,
          action,
          conflictResolutions: resolutions,
          reviewerNotes: notes,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Failed to ${action} leave request.`);

      setConflictModalOpen(false);
      setRejectModalOpen(false);
      setActiveRequest(null);
      fetchRequests();
      if (onRosterRefresh) onRosterRefresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setProcessing(false);
    }
  }

  async function handleAdminCancelApproved(requestId) {
    const reason = prompt('Please enter a cancellation reason (this will reverse pure leave records and safeguard punches):', 'Cancelled by Admin');
    if (!reason) return;

    setProcessing(true);
    setError(null);
    try {
      const res = await fetch('/api/attendance/leave/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, reason }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to cancel approved leave.');

      fetchRequests();
      if (onRosterRefresh) onRosterRefresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setProcessing(false);
    }
  }

  const getStatusBadge = (status) => {
    switch (status) {
      case 'approved':
        return <span style={{ padding: '3px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600, background: '#e3fcef', color: '#006644' }}>Approved</span>;
      case 'rejected':
        return <span style={{ padding: '3px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600, background: '#ffebe6', color: '#bf2600' }}>Rejected</span>;
      case 'cancelled':
        return <span style={{ padding: '3px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600, background: 'var(--surface-muted)', color: 'var(--neutral-text)' }}>Cancelled</span>;
      default:
        return <span style={{ padding: '3px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600, background: 'var(--warning-banner-bg)', color: 'var(--text)' }}>Pending Review</span>;
    }
  };

  return (
    <div>
      {/* Filter Bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: 'var(--bg-elevated)',
        padding: '14px 20px',
        borderRadius: '8px',
        border: '1px solid var(--border-subtle)',
        marginBottom: '16px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--neutral-text)' }}>Status Filter:</span>
          {['pending', 'approved', 'rejected', 'cancelled', 'all'].map((st) => (
            <button
              key={st}
              onClick={() => setStatusFilter(st)}
              style={{
                padding: '6px 12px',
                borderRadius: '6px',
                border: statusFilter === st ? '1px solid var(--primary)' : '1px solid var(--border)',
                background: statusFilter === st ? 'var(--bg-selected)' : 'var(--bg-elevated)',
                color: statusFilter === st ? 'var(--text-link)' : 'var(--neutral-text)',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                textTransform: 'capitalize'
              }}
            >
              {st === 'pending' ? 'Pending Review' : st}
            </button>
          ))}
        </div>

        <button
          onClick={fetchRequests}
          disabled={loading}
          style={{
            padding: '6px 12px',
            borderRadius: '6px',
            border: '1px solid var(--border)',
            background: 'var(--bg-elevated)',
            fontSize: '12px',
            fontWeight: 600,
            color: 'var(--neutral-text)',
            cursor: 'pointer'
          }}
        >
          {loading ? 'Refreshing...' : '🔄 Refresh'}
        </button>
      </div>

      {error && (
        <div style={{
          background: '#ffebe6',
          color: '#bf2600',
          padding: '12px 16px',
          borderRadius: '6px',
          marginBottom: '16px',
          fontSize: '13px',
          border: '1px solid #ffbdad'
        }}>
          {error}
        </div>
      )}

      {/* Requests Table */}
      <div style={{ background: 'var(--bg-elevated)', borderRadius: '8px', border: '1px solid var(--border-subtle)', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
          <thead>
            <tr style={{ background: 'var(--surface-muted)', borderBottom: '1px solid var(--border-subtle)', color: 'var(--neutral-text)' }}>
              <th style={{ padding: '12px 16px', fontWeight: 600 }}>Employee</th>
              <th style={{ padding: '12px 16px', fontWeight: 600 }}>Leave Type</th>
              <th style={{ padding: '12px 16px', fontWeight: 600 }}>Shift / Day Type</th>
              <th style={{ padding: '12px 16px', fontWeight: 600 }}>Dates</th>
              <th style={{ padding: '12px 16px', fontWeight: 600 }}>Duration</th>
              <th style={{ padding: '12px 16px', fontWeight: 600 }}>Reason</th>
              <th style={{ padding: '12px 16px', fontWeight: 600 }}>Status</th>
              <th style={{ padding: '12px 16px', fontWeight: 600 }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {requests.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ padding: '36px 16px', textAlign: 'center', color: 'var(--muted)' }}>
                  No leave requests found for this filter.
                </td>
              </tr>
            ) : (
              requests.map((r) => (
                <tr key={r.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <td style={{ padding: '12px 16px' }}>
                    <div style={{ fontWeight: 600, color: 'var(--text)' }}>{r.employee_name}</div>
                    <div style={{ fontSize: '11px', color: 'var(--muted)' }}>{r.department || 'General'}</div>
                  </td>
                  <td style={{ padding: '12px 16px', fontWeight: 500, color: 'var(--text)' }}>
                    {getLeaveTypeLabel(r.leave_type)}
                  </td>
                  <td style={{ padding: '12px 16px', color: 'var(--neutral-text)' }}>
                    {getLeaveDayTypeLabel(r.day_type)}
                  </td>
                  <td style={{ padding: '12px 16px', color: 'var(--text)' }}>
                    {r.start_date === r.end_date ? r.start_date : `${r.start_date} → ${r.end_date}`}
                  </td>
                  <td style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--text-link)' }}>
                    {r.total_working_days}d
                  </td>
                  <td style={{ padding: '12px 16px', color: 'var(--neutral-text)', maxWidth: '200px' }}>
                    <div>{r.reason}</div>
                    {r.reviewer_notes && (
                      <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '2px' }}>
                        <em>Note:</em> {r.reviewer_notes}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    {getStatusBadge(r.status)}
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    {r.status === 'pending' ? (
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button
                          onClick={() => handleInitiateApprove(r)}
                          disabled={processing}
                          style={{
                            padding: '4px 10px',
                            borderRadius: '4px',
                            border: 'none',
background: 'var(--primary)',
                    color: 'var(--primary-text)',
                            fontSize: '12px',
                            fontWeight: 600,
                            cursor: 'pointer'
                          }}
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => {
                            setActiveRequest(r);
                            setRejectNotes('');
                            setRejectModalOpen(true);
                          }}
                          disabled={processing}
                          style={{
                            padding: '4px 10px',
                            borderRadius: '4px',
                            border: '1px solid var(--border)',
                            background: 'var(--bg-elevated)',
                            color: 'var(--danger)',
                            fontSize: '12px',
                            fontWeight: 600,
                            cursor: 'pointer'
                          }}
                        >
                          Reject
                        </button>
                      </div>
                    ) : r.status === 'approved' ? (
                      <button
                        onClick={() => handleAdminCancelApproved(r.id)}
                        disabled={processing}
                        style={{
                          padding: '4px 8px',
                          borderRadius: '4px',
                          border: '1px solid var(--border)',
                          background: 'var(--bg-elevated)',
                          color: 'var(--neutral-text)',
                          fontSize: '11px',
                          fontWeight: 500,
                          cursor: 'pointer'
                        }}
                      >
                        Cancel Leave
                      </button>
                    ) : (
                      <span style={{ fontSize: '12px', color: 'var(--text-disabled)' }}>—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Conflict Resolution Dialog */}
      {conflictModalOpen && activeRequest && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(9, 30, 66, 0.54)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '16px'
        }}>
          <div style={{
            background: 'var(--bg-elevated)',
            borderRadius: '8px',
            maxWidth: '600px',
            width: '100%',
            boxShadow: '0 8px 30px rgba(0, 0, 0, 0.2)',
            overflow: 'hidden'
          }}>
            <div style={{
              padding: '16px 20px',
              borderBottom: '1px solid var(--border-subtle)',
              background: 'var(--warning-banner-bg)',
              display: 'flex',
              alignItems: 'center',
              gap: '10px'
            }}>
              <span style={{ fontSize: '20px' }}>⚠️</span>
              <div>
                <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: 'var(--text)' }}>
                  Attendance Conflict Detected
                </h3>
                <div style={{ fontSize: '12px', color: 'var(--neutral-text)' }}>
                  Employee has genuine recorded punches on dates within this leave request.
                </div>
              </div>
            </div>

            <div style={{ padding: '20px', maxHeight: '70vh', overflowY: 'auto' }}>
              <div style={{ marginBottom: '16px', fontSize: '13px', color: 'var(--text)' }}>
                Please choose how you wish to resolve each conflicting date:
              </div>

              {conflicts.map((c) => (
                <div key={c.date} style={{
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '6px',
                  padding: '12px 16px',
                  marginBottom: '12px',
                  background: 'var(--bg-surface)'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <strong style={{ color: 'var(--text)' }}>Date: {c.date}</strong>
                    <span style={{ fontSize: '12px', color: 'var(--text-link)', fontWeight: 600 }}>
                      Current Status: {c.status}
                    </span>
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-subtle)', marginBottom: '8px' }}>
                    Check-In: <strong>{c.checkInTime}</strong> {c.checkOutTime && ` · Check-Out: ${c.checkOutTime}`}
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
                      <input
                        type="radio"
                        name={`conflict_${c.date}`}
                        value="keep_attendance"
                        checked={conflictResolutions[c.date] === 'keep_attendance'}
                        onChange={() => setConflictResolutions({ ...conflictResolutions, [c.date]: 'keep_attendance' })}
                      />
                      <span><strong>Option 1: Keep Attendance & Exclude Date</strong> (Preserve genuine punches, deduct day from leave)</span>
                    </label>

                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
                      <input
                        type="radio"
                        name={`conflict_${c.date}`}
                        value="convert_half_day"
                        checked={conflictResolutions[c.date] === 'convert_half_day'}
                        onChange={() => setConflictResolutions({ ...conflictResolutions, [c.date]: 'convert_half_day' })}
                      />
                      <span><strong>Option 2: Convert to Half-Day Leave</strong> (Keep punches for worked half, convert remaining to leave)</span>
                    </label>

                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
                      <input
                        type="radio"
                        name={`conflict_${c.date}`}
                        value="override"
                        checked={conflictResolutions[c.date] === 'override'}
                        onChange={() => setConflictResolutions({ ...conflictResolutions, [c.date]: 'override' })}
                      />
                      <span><strong>Option 3: Admin Override to On Leave</strong> (Archive punches to audit log, mark on leave)</span>
                    </label>
                  </div>
                </div>
              ))}

              <div style={{ marginTop: '16px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--neutral-text)', marginBottom: '6px' }}>
                  Resolution / Reviewer Notes (Mandatory for Override):
                </label>
                <textarea
                  rows={2}
                  value={reviewerNotes}
                  onChange={(e) => setReviewerNotes(e.target.value)}
                  placeholder="Explain why this resolution was chosen..."
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', background: 'var(--bg-elevated)', color: 'var(--text)', border: '1px solid var(--border)', fontSize: '13px' }}
                />
              </div>
            </div>

            <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'flex-end', gap: '10px', background: 'var(--surface-muted)' }}>
              <button
                type="button"
                onClick={() => setConflictModalOpen(false)}
                disabled={processing}
                style={{ padding: '8px 16px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg-elevated)', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => executeProcess(activeRequest.id, 'approve', conflictResolutions, reviewerNotes)}
                disabled={processing}
                style={{ padding: '8px 18px', borderRadius: '6px', border: 'none', background: 'var(--primary)', color: 'var(--primary-text)', fontSize: '13px', fontWeight: 600, cursor: processing ? 'not-allowed' : 'pointer' }}
              >
                {processing ? 'Applying...' : 'Confirm Resolution & Approve'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reject Modal */}
      {rejectModalOpen && activeRequest && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(9, 30, 66, 0.54)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '16px'
        }}>
          <div style={{
            background: 'var(--bg-elevated)',
            borderRadius: '8px',
            maxWidth: '460px',
            width: '100%',
            boxShadow: '0 8px 30px rgba(0, 0, 0, 0.2)',
            overflow: 'hidden'
          }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--surface-muted)' }}>
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: 'var(--text)' }}>
                Reject Leave Request
              </h3>
            </div>
            <div style={{ padding: '20px' }}>
              <p style={{ margin: '0 0 14px', fontSize: '13px', color: 'var(--neutral-text)' }}>
                Please provide rejection remarks for <strong>{activeRequest.employee_name}</strong>:
              </p>
              <textarea
                rows={3}
                value={rejectNotes}
                onChange={(e) => setRejectNotes(e.target.value)}
                placeholder="e.g. Critical project deadline, please reschedule..."
                style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', background: 'var(--bg-elevated)', color: 'var(--text)', border: '1px solid var(--border)', fontSize: '13px' }}
              />
            </div>
            <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                type="button"
                onClick={() => setRejectModalOpen(false)}
                disabled={processing}
                style={{ padding: '8px 14px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg-elevated)', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => executeProcess(activeRequest.id, 'reject', {}, rejectNotes)}
                disabled={processing}
                style={{ padding: '8px 16px', borderRadius: '6px', border: 'none', background: '#bf2600', color: '#fff', fontSize: '13px', fontWeight: 600, cursor: processing ? 'not-allowed' : 'pointer' }}
              >
                {processing ? 'Rejecting...' : 'Confirm Rejection'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


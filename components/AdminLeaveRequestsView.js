'use client';

import { useState, useEffect } from 'react';
import { getLeaveTypeLabel, getLeaveDayTypeLabel } from '@/lib/attendanceMeta';

export default function AdminLeaveRequestsView({ onRosterRefresh }) {
  const [requests, setRequests] = useState([]);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Conflict & LOP modal state
  const [conflictModalOpen, setConflictModalOpen] = useState(false);
  const [activeRequest, setActiveRequest] = useState(null);
  const [activeBalances, setActiveBalances] = useState(null);
  const [authPaidDays, setAuthPaidDays] = useState(0);
  const [authLopDays, setAuthLopDays] = useState(0);
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
      // Pre-scan for conflicts and live balance
      const res = await fetch('/api/attendance/leave/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: req.id, checkConflictsOnly: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to inspect attendance conflicts.');

      const balances = data.balances || null;
      setActiveBalances(balances);

      const cat = balances?.categories?.[req.leave_type];
      const avail = cat?.remainingBalance ?? 0;
      const isOver = req.total_working_days > avail;
      const initialPaid = Math.min(req.total_working_days, Math.max(0, avail));
      const initialLop = Math.max(0, req.total_working_days - initialPaid);

      setAuthPaidDays(initialPaid);
      setAuthLopDays(initialLop);

      const detected = data.conflicts || [];
      if (detected.length > 0 || isOver) {
        setConflicts(detected);
        const initialResolutions = {};
        for (const c of detected) {
          initialResolutions[c.date] = 'keep_attendance';
        }
        setConflictResolutions(initialResolutions);
        setReviewerNotes(isOver ? `Approved with LOP breakdown (${initialPaid}d Paid + ${initialLop}d LOP)` : '');
        setConflictModalOpen(true);
      } else {
        // Direct clean approval within entitlement
        await executeProcess(req.id, 'approve', {}, 'Approved by Admin', req.total_working_days, 0);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setProcessing(false);
    }
  }

  async function executeProcess(requestId, action, resolutions = {}, notes = '', paidDays = null, lopDays = null) {
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
          authorizedPaidDays: paidDays !== null ? paidDays : authPaidDays,
          authorizedLopDays: lopDays !== null ? lopDays : authLopDays,
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
        return <span style={{ padding: '3px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600, background: '#f4f5f7', color: '#44546f' }}>Cancelled</span>;
      default:
        return <span style={{ padding: '3px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600, background: '#fff0b3', color: '#172b4d' }}>Pending Review</span>;
    }
  };

  return (
    <div>
      {/* Filter Bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: '#ffffff',
        padding: '14px 20px',
        borderRadius: '8px',
        border: '1px solid #ebecf0',
        marginBottom: '16px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '13px', fontWeight: 600, color: '#44546f' }}>Status Filter:</span>
          {['pending', 'approved', 'rejected', 'cancelled', 'all'].map((st) => (
            <button
              key={st}
              onClick={() => setStatusFilter(st)}
              style={{
                padding: '6px 12px',
                borderRadius: '6px',
                border: statusFilter === st ? '1px solid #0c66e4' : '1px solid #dfe1e6',
                background: statusFilter === st ? '#e9f2ff' : '#ffffff',
                color: statusFilter === st ? '#0c66e4' : '#44546f',
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
            border: '1px solid #dfe1e6',
            background: '#ffffff',
            fontSize: '12px',
            fontWeight: 600,
            color: '#44546f',
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
      <div style={{ background: '#ffffff', borderRadius: '8px', border: '1px solid #ebecf0', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
          <thead>
            <tr style={{ background: '#f4f5f7', borderBottom: '1px solid #ebecf0', color: '#44546f' }}>
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
                <td colSpan={8} style={{ padding: '36px 16px', textAlign: 'center', color: '#6b778c' }}>
                  No leave requests found for this filter.
                </td>
              </tr>
            ) : (
              requests.map((r) => (
                <tr key={r.id} style={{ borderBottom: '1px solid #ebecf0' }}>
                  <td style={{ padding: '12px 16px' }}>
                    <div style={{ fontWeight: 600, color: '#172b4d' }}>{r.employee_name}</div>
                    <div style={{ fontSize: '11px', color: '#6b778c' }}>{r.department || 'General'}</div>
                  </td>
                  <td style={{ padding: '12px 16px', fontWeight: 500, color: '#172b4d' }}>
                    {getLeaveTypeLabel(r.leave_type)}
                  </td>
                  <td style={{ padding: '12px 16px', color: '#44546f' }}>
                    {getLeaveDayTypeLabel(r.day_type)}
                  </td>
                  <td style={{ padding: '12px 16px', color: '#172b4d' }}>
                    {r.start_date === r.end_date ? r.start_date : `${r.start_date} → ${r.end_date}`}
                  </td>
                  <td style={{ padding: '12px 16px', fontWeight: 600, color: '#0c66e4' }}>
                    <div>{r.total_working_days}d</div>
                    {r.status === 'approved' && r.lop_days > 0 && (
                      <div style={{ fontSize: '11px', color: '#bf2600', fontWeight: 700 }}>
                        {r.paid_days || 0}d Paid + {r.lop_days}d LOP
                      </div>
                    )}
                  </td>
                  <td style={{ padding: '12px 16px', color: '#44546f', maxWidth: '200px' }}>
                    <div>{r.reason}</div>
                    {r.reviewer_notes && (
                      <div style={{ fontSize: '11px', color: '#6b778c', marginTop: '2px' }}>
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
                            background: '#0c66e4',
                            color: '#fff',
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
                            border: '1px solid #dfe1e6',
                            background: '#fff',
                            color: '#bf2600',
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
                          border: '1px solid #dfe1e6',
                          background: '#fff',
                          color: '#44546f',
                          fontSize: '11px',
                          fontWeight: 500,
                          cursor: 'pointer'
                        }}
                      >
                        Cancel Leave
                      </button>
                    ) : (
                      <span style={{ fontSize: '12px', color: '#8993a4' }}>—</span>
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
            background: '#ffffff',
            borderRadius: '8px',
            maxWidth: '600px',
            width: '100%',
            boxShadow: '0 8px 30px rgba(0, 0, 0, 0.2)',
            overflow: 'hidden'
          }}>
            <div style={{
              padding: '16px 20px',
              borderBottom: '1px solid #ebecf0',
              background: '#fff0b3',
              display: 'flex',
              alignItems: 'center',
              gap: '10px'
            }}>
              <span style={{ fontSize: '20px' }}>⚠️</span>
              <div>
                <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#172b4d' }}>
                  {conflicts.length > 0 && authLopDays > 0
                    ? 'Attendance Conflict & Loss of Pay (LOP) Authorization'
                    : conflicts.length > 0
                    ? 'Attendance Conflict Detected'
                    : 'Loss of Pay (LOP) Authorization Required'}
                </h3>
                <div style={{ fontSize: '12px', color: '#44546f' }}>
                  {activeRequest.employee_name} · Requested {activeRequest.total_working_days}d ({activeRequest.leave_type})
                </div>
              </div>
            </div>

            <div style={{ padding: '20px', maxHeight: '70vh', overflowY: 'auto' }}>
              {/* LOP Authorization Card if over-balance */}
              {(authLopDays > 0 || (activeBalances?.categories?.[activeRequest.leave_type]?.remainingBalance ?? 0) < activeRequest.total_working_days) && (
                <div style={{
                  background: '#fffae6',
                  border: '1px solid #ffe380',
                  borderRadius: '6px',
                  padding: '14px 16px',
                  marginBottom: '16px',
                }}>
                  <div style={{ fontWeight: 700, color: '#172b4d', fontSize: '13px', marginBottom: '4px' }}>
                    Loss of Pay (LOP) Review & Authorization
                  </div>
                  <div style={{ fontSize: '12px', color: '#44546f', marginBottom: '12px' }}>
                    Available balance: <strong>{(activeBalances?.categories?.[activeRequest.leave_type]?.remainingBalance ?? 0).toFixed(1)}d</strong>.
                    Requested: <strong>{activeRequest.total_working_days}d</strong>.
                    Explicit authorization is required before approving unpaid/LOP days:
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#006644', marginBottom: '4px' }}>
                        Authorized Paid Days:
                      </label>
                      <input
                        type="number"
                        step="0.5"
                        min="0"
                        max={activeRequest.total_working_days}
                        value={authPaidDays}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value) || 0;
                          setAuthPaidDays(val);
                          setAuthLopDays(Math.max(0, activeRequest.total_working_days - val));
                        }}
                        style={{ width: '100%', padding: '6px 10px', borderRadius: '4px', border: '1px solid #dfe1e6', fontSize: '13px', fontWeight: 600 }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#bf2600', marginBottom: '4px' }}>
                        Authorized Loss of Pay (LOP) Days:
                      </label>
                      <input
                        type="number"
                        step="0.5"
                        min="0"
                        max={activeRequest.total_working_days}
                        value={authLopDays}
                        onChange={(e) => setAuthLopDays(parseFloat(e.target.value) || 0)}
                        style={{ width: '100%', padding: '6px 10px', borderRadius: '4px', border: '1px solid #dfe1e6', fontSize: '13px', fontWeight: 600 }}
                      />
                    </div>
                  </div>
                </div>
              )}

              {conflicts.length > 0 && (
                <div style={{ marginBottom: '16px', fontSize: '13px', color: '#172b4d' }}>
                  Please choose how you wish to resolve each conflicting date:
                </div>
              )}

              {conflicts.map((c) => (
                <div key={c.date} style={{
                  border: '1px solid #ebecf0',
                  borderRadius: '6px',
                  padding: '12px 16px',
                  marginBottom: '12px',
                  background: '#f7f8f9'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <strong style={{ color: '#172b4d' }}>Date: {c.date}</strong>
                    <span style={{ fontSize: '12px', color: '#0c66e4', fontWeight: 600 }}>
                      Current Status: {c.status}
                    </span>
                  </div>
                  <div style={{ fontSize: '12px', color: '#626f86', marginBottom: '8px' }}>
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
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#44546f', marginBottom: '6px' }}>
                  Resolution / Reviewer Notes (Mandatory for Override):
                </label>
                <textarea
                  rows={2}
                  value={reviewerNotes}
                  onChange={(e) => setReviewerNotes(e.target.value)}
                  placeholder="Explain why this resolution was chosen..."
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #dfe1e6', fontSize: '13px' }}
                />
              </div>
            </div>

            <div style={{ padding: '14px 20px', borderTop: '1px solid #ebecf0', display: 'flex', justifyContent: 'flex-end', gap: '10px', background: '#f4f5f7' }}>
              <button
                type="button"
                onClick={() => setConflictModalOpen(false)}
                disabled={processing}
                style={{ padding: '8px 16px', borderRadius: '6px', border: '1px solid #dfe1e6', background: '#fff', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => executeProcess(activeRequest.id, 'approve', conflictResolutions, reviewerNotes)}
                disabled={processing}
                style={{ padding: '8px 18px', borderRadius: '6px', border: 'none', background: '#0c66e4', color: '#fff', fontSize: '13px', fontWeight: 600, cursor: processing ? 'not-allowed' : 'pointer' }}
              >
                {processing ? 'Applying...' : 'Authorize & Approve Leave'}
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
            background: '#ffffff',
            borderRadius: '8px',
            maxWidth: '460px',
            width: '100%',
            boxShadow: '0 8px 30px rgba(0, 0, 0, 0.2)',
            overflow: 'hidden'
          }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #ebecf0', background: '#f4f5f7' }}>
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: '#172b4d' }}>
                Reject Leave Request
              </h3>
            </div>
            <div style={{ padding: '20px' }}>
              <p style={{ margin: '0 0 14px', fontSize: '13px', color: '#44546f' }}>
                Please provide rejection remarks for <strong>{activeRequest.employee_name}</strong>:
              </p>
              <textarea
                rows={3}
                value={rejectNotes}
                onChange={(e) => setRejectNotes(e.target.value)}
                placeholder="e.g. Critical project deadline, please reschedule..."
                style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #dfe1e6', fontSize: '13px' }}
              />
            </div>
            <div style={{ padding: '14px 20px', borderTop: '1px solid #ebecf0', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                type="button"
                onClick={() => setRejectModalOpen(false)}
                disabled={processing}
                style={{ padding: '8px 14px', borderRadius: '6px', border: '1px solid #dfe1e6', background: '#fff', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
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


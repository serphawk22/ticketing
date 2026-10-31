'use client';

import { useState } from 'react';
import { getLeaveTypeLabel, getLeaveDayTypeLabel } from '@/lib/attendanceMeta';

export default function MyLeaveRequestsView({ requests = [], onRefresh }) {
  const [cancellingId, setCancellingId] = useState(null);
  const [error, setError] = useState(null);

  async function handleCancel(id) {
    if (!confirm('Are you sure you want to cancel this pending leave request?')) return;
    setCancellingId(id);
    setError(null);

    try {
      const res = await fetch('/api/attendance/leave/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: id, reason: 'Cancelled by employee' }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to cancel leave request.');
      }

      if (onRefresh) onRefresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setCancellingId(null);
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

  if (!requests || requests.length === 0) {
    return (
      <div style={{
        background: 'var(--bg-elevated)',
        borderRadius: '8px',
        border: '1px solid var(--border-subtle)',
        padding: '36px 20px',
        textAlign: 'center',
        color: 'var(--muted)'
      }}>
        <div style={{ fontSize: '24px', marginBottom: '8px' }}>🏖️</div>
        <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text)' }}>No Leave Requests Found</div>
        <div style={{ fontSize: '12px', marginTop: '4px' }}>You have not submitted any leave requests yet.</div>
      </div>
    );
  }

  return (
    <div style={{ background: 'var(--bg-elevated)', borderRadius: '8px', border: '1px solid var(--border-subtle)', overflow: 'hidden' }}>
      {error && (
        <div style={{ background: '#ffebe6', color: '#bf2600', padding: '10px 16px', fontSize: '13px', borderBottom: '1px solid #ffbdad' }}>
          {error}
        </div>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
        <thead>
          <tr style={{ background: 'var(--surface-muted)', borderBottom: '1px solid var(--border-subtle)', color: 'var(--neutral-text)' }}>
            <th style={{ padding: '10px 16px', fontWeight: 600 }}>Leave Type</th>
            <th style={{ padding: '10px 16px', fontWeight: 600 }}>Duration / Shift</th>
            <th style={{ padding: '10px 16px', fontWeight: 600 }}>Dates</th>
            <th style={{ padding: '10px 16px', fontWeight: 600 }}>Working Days</th>
            <th style={{ padding: '10px 16px', fontWeight: 600 }}>Reason</th>
            <th style={{ padding: '10px 16px', fontWeight: 600 }}>Status</th>
            <th style={{ padding: '10px 16px', fontWeight: 600 }}>Action</th>
          </tr>
        </thead>
        <tbody>
          {requests.map((r) => (
            <tr key={r.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <td style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--text)' }}>
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
              <td style={{ padding: '12px 16px', color: 'var(--neutral-text)', maxWidth: '240px' }}>
                <div>{r.reason}</div>
                {r.reviewer_notes && (
                  <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '4px' }}>
                    <strong>Admin Note:</strong> {r.reviewer_notes}
                  </div>
                )}
              </td>
              <td style={{ padding: '12px 16px' }}>
                {getStatusBadge(r.status)}
              </td>
              <td style={{ padding: '12px 16px' }}>
                {r.status === 'pending' ? (
                  <button
                    onClick={() => handleCancel(r.id)}
                    disabled={cancellingId === r.id}
                    style={{
                      padding: '4px 10px',
                      borderRadius: '4px',
                      border: '1px solid var(--border)',
                      background: 'var(--bg-elevated)',
                      fontSize: '12px',
                      color: 'var(--danger)',
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                  >
                    {cancellingId === r.id ? 'Cancelling...' : 'Cancel'}
                  </button>
                ) : (
                  <span style={{ fontSize: '12px', color: 'var(--text-disabled)' }}>—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}


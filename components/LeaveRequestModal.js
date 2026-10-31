'use client';

import { useState } from 'react';
import { LEAVE_TYPES } from '@/lib/attendanceMeta';

export default function LeaveRequestModal({ isOpen, onClose, onSubmitted }) {
  const [leaveType, setLeaveType] = useState('casual');
  const [dayType, setDayType] = useState('full_day');
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  if (!isOpen) return null;

  const isHalfDay = dayType === 'first_half' || dayType === 'second_half';

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    if (!reason || reason.trim().length < 5) {
      setError('Please provide a reason of at least 5 characters.');
      return;
    }

    const actualEnd = isHalfDay ? startDate : endDate;
    if (startDate > actualEnd) {
      setError('Start date cannot be after end date.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/attendance/leave/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leaveType,
          dayType,
          startDate,
          endDate: actualEnd,
          reason: reason.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to submit leave request.');
      }

      if (onSubmitted) onSubmitted(data.leaveRequest);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
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
        maxWidth: '520px',
        width: '100%',
        boxShadow: '0 8px 30px rgba(0, 0, 0, 0.2)',
        overflow: 'hidden',
      }}>
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'var(--surface-muted)'
        }}>
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: 'var(--text)' }}>
            Apply for Leave
          </h3>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '18px',
              cursor: 'pointer',
              color: 'var(--muted)'
            }}
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ padding: '20px' }}>
          {error && (
            <div style={{
              background: '#ffebe6',
              border: '1px solid #ffbdad',
              borderRadius: '4px',
              padding: '10px 14px',
              marginBottom: '16px',
              color: '#bf2600',
              fontSize: '13px'
            }}>
              {error}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--neutral-text)', marginBottom: '6px' }}>
                Leave Type *
              </label>
              <select
                value={leaveType}
                onChange={(e) => setLeaveType(e.target.value)}
                style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border)', fontSize: '13px', color: 'var(--text)', background: 'var(--bg-elevated)' }}
              >
                {LEAVE_TYPES.map((t) => (
                  <option key={t.key} value={t.key}>{t.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--neutral-text)', marginBottom: '6px' }}>
                Duration Type *
              </label>
              <select
                value={dayType}
                onChange={(e) => {
                  setDayType(e.target.value);
                  if (e.target.value !== 'full_day') {
                    setEndDate(startDate);
                  }
                }}
                style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border)', fontSize: '13px', color: 'var(--text)', background: 'var(--bg-elevated)' }}
              >
                <option value="full_day">Full Day</option>
                <option value="first_half">First Half (09:00 AM – 01:00 PM)</option>
                <option value="second_half">Second Half (01:00 PM – 05:00 PM)</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: isHalfDay ? '1fr' : '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--neutral-text)', marginBottom: '6px' }}>
                {isHalfDay ? 'Leave Date *' : 'Start Date *'}
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  if (isHalfDay) setEndDate(e.target.value);
                }}
                required
                style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', fontSize: '13px', color: 'var(--text)' }}
              />
            </div>

            {!isHalfDay && (
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--neutral-text)', marginBottom: '6px' }}>
                  End Date *
                </label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  min={startDate}
                  required
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', fontSize: '13px', color: 'var(--text)' }}
                />
              </div>
            )}
          </div>

          <div style={{
            background: 'var(--surface-muted)',
            borderRadius: '6px',
            padding: '10px 14px',
            marginBottom: '16px',
            fontSize: '12px',
            color: 'var(--neutral-text)'
          }}>
            ℹ️ <strong>Working-Day Accounting:</strong> Sundays and official company holidays within your selected dates are automatically excluded from leave consumption.
          </div>

          <div style={{ marginBottom: '18px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--neutral-text)', marginBottom: '6px' }}>
              Reason for Leave * (Minimum 5 characters)
            </label>
            <textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g., Medical appointment, family event, personal travel..."
              required
              style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', fontSize: '13px', color: 'var(--text)' }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              style={{
                padding: '8px 16px',
                borderRadius: '6px',
                border: '1px solid var(--border)',
                background: 'var(--bg-elevated)',
                fontSize: '13px',
                fontWeight: 600,
                color: 'var(--neutral-text)',
                cursor: 'pointer'
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              style={{
                padding: '8px 18px',
                borderRadius: '6px',
                border: 'none',
                background: 'var(--primary)',
                fontSize: '13px',
                fontWeight: 600,
                color: 'var(--primary-text)',
                cursor: loading ? 'not-allowed' : 'pointer'
              }}
            >
              {loading ? 'Submitting...' : 'Submit Leave Request'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}


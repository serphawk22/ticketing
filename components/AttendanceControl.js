'use client';

import { useState } from 'react';
import { formatKolkataTime, formatMinutes, getLeaveTypeLabel } from '@/lib/attendanceMeta';

export default function AttendanceControl({ initialData = null }) {
  const [data, setData] = useState(initialData);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const attendance = data?.attendance || null;
  const isCheckedIn = Boolean(attendance?.check_in_time);
  const isCheckedOut = Boolean(attendance?.check_out_time);
  const isOnLeave = attendance?.status === 'on_leave';
  const isFirstHalfLeave = attendance?.leave_day_type === 'first_half';
  const isSecondHalfLeave = attendance?.leave_day_type === 'second_half';

  async function refreshToday() {
    try {
      const res = await fetch('/api/attendance/today');
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch {
      // Ignore background refresh failure
    }
  }

  async function handleCheckIn() {
    if (loading || (isCheckedIn && !isFirstHalfLeave)) return;
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const res = await fetch('/api/attendance/check-in', {
        method: 'POST',
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Check-in failed');
      }

      setSuccess(`Checked in successfully at ${formatKolkataTime(json.attendance?.check_in_time)}.`);
      await refreshToday();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleCheckOut() {
    if (loading || !isCheckedIn || isCheckedOut) return;
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const res = await fetch('/api/attendance/check-out', {
        method: 'POST',
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Check-out failed');
      }

      setSuccess(`Checked out successfully at ${formatKolkataTime(json.attendance?.check_out_time)}.`);
      await refreshToday();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const status = attendance?.status || (isCheckedIn ? 'present' : 'not_checked_in');

  function getStatusBadge() {
    if (isOnLeave) {
      return (
        <span style={{
          background: '#f3e8ff',
          color: '#581c87',
          padding: '4px 10px',
          borderRadius: '12px',
          fontSize: '12px',
          fontWeight: 600,
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px'
        }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#9333ea' }} />
          🏖️ On Leave ({attendance.leave_type ? getLeaveTypeLabel(attendance.leave_type) : 'Approved Leave'})
        </span>
      );
    }
    if (!isCheckedIn) {
      if (isFirstHalfLeave) {
        return (
          <span style={{
            background: '#f3e8ff',
            color: '#6b21a8',
            padding: '4px 10px',
            borderRadius: '12px',
            fontSize: '12px',
            fontWeight: 600,
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px'
          }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#9333ea' }} />
            🏖️ 1st Half Leave · Shift Starts 1:00 PM
          </span>
        );
      }
      return (
        <span style={{
          background: '#f1f2f4',
          color: '#44546f',
          padding: '4px 10px',
          borderRadius: '12px',
          fontSize: '12px',
          fontWeight: 600,
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px'
        }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#8590a2' }} />
          Not Checked In
        </span>
      );
    }
    if (isCheckedOut) {
      return (
        <span style={{
          background: '#e9f2ff',
          color: '#0c66e4',
          padding: '4px 10px',
          borderRadius: '12px',
          fontSize: '12px',
          fontWeight: 600,
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px'
        }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#0c66e4' }} />
          Day Completed · {formatMinutes(attendance.net_duration_minutes)}
        </span>
      );
    }
    if (status === 'half_day') {
      return (
        <span style={{
          background: '#f3e8ff',
          color: '#6b21a8',
          padding: '4px 10px',
          borderRadius: '12px',
          fontSize: '12px',
          fontWeight: 600,
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px'
        }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#9333ea' }} />
          {isFirstHalfLeave ? '1st Half Leave + Worked' : isSecondHalfLeave ? 'Worked + 2nd Half Leave' : 'Half Day'}
        </span>
      );
    }
    if (status === 'late') {
      return (
        <span style={{
          background: '#fff7d6',
          color: '#974f00',
          padding: '4px 10px',
          borderRadius: '12px',
          fontSize: '12px',
          fontWeight: 600,
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px'
        }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#e27b00' }} />
          Late Arrival (After 11:30 AM)
        </span>
      );
    }
    return (
      <span style={{
        background: '#dcfce7',
        color: '#166534',
        padding: '4px 10px',
        borderRadius: '12px',
        fontSize: '12px',
        fontWeight: 600,
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px'
      }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e' }} />
        Present / Full Day
      </span>
    );
  }

  return (
    <div className="list-frame ts-frame" style={{ marginBottom: '16px' }}>
      <div className="ts-card" style={{ padding: '20px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 600, color: '#172b4d' }}>
                Employee Attendance
              </h2>
              {getStatusBadge()}
            </div>
            <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#626f86' }}>
              Official Hours: <strong>9:00 AM – 5:00 PM</strong> · Lunch: <strong>12:30 PM – 1:00 PM</strong> (Asia/Kolkata)
            </p>
          </div>

          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              type="button"
              onClick={handleCheckIn}
              disabled={loading || (isCheckedIn && !isFirstHalfLeave) || isOnLeave}
              style={{
                padding: '8px 18px',
                borderRadius: '6px',
                border: 'none',
                background: (isCheckedIn && !isFirstHalfLeave) || isOnLeave ? '#f1f2f4' : '#0c66e4',
                color: (isCheckedIn && !isFirstHalfLeave) || isOnLeave ? '#8590a2' : '#ffffff',
                fontSize: '13px',
                fontWeight: 600,
                cursor: (isCheckedIn && !isFirstHalfLeave) || isOnLeave ? 'not-allowed' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                boxShadow: (isCheckedIn && !isFirstHalfLeave) || isOnLeave ? 'none' : '0 1px 2px rgba(0,0,0,0.1)'
              }}
            >
              ✓ Check In {isFirstHalfLeave && !isCheckedIn ? '(2nd Half)' : ''}
            </button>

            <button
              type="button"
              onClick={handleCheckOut}
              disabled={loading || !isCheckedIn || isCheckedOut || isOnLeave}
              style={{
                padding: '8px 18px',
                borderRadius: '6px',
                border: '1px solid #dfe1e6',
                background: !isCheckedIn || isCheckedOut || isOnLeave ? '#f1f2f4' : '#ffffff',
                color: !isCheckedIn || isCheckedOut || isOnLeave ? '#8590a2' : '#ae2e24',
                fontSize: '13px',
                fontWeight: 600,
                cursor: !isCheckedIn || isCheckedOut || isOnLeave ? 'not-allowed' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              ⎋ Check Out
            </button>
          </div>
        </div>

        {/* Informative Leave Banner */}
        {isOnLeave && (
          <div style={{
            background: '#f3e8ff',
            border: '1px solid #d8b4fe',
            borderRadius: '6px',
            padding: '12px 16px',
            marginBottom: '14px',
            color: '#581c87',
            fontSize: '13px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <span>🏖️</span>
            <div>
              <strong>You are on approved leave today.</strong> ({attendance.leave_reason || 'Approved by Admin'}). You do not need to check in.
            </div>
          </div>
        )}

        {isFirstHalfLeave && !isCheckedIn && (
          <div style={{
            background: '#f3e8ff',
            border: '1px solid #d8b4fe',
            borderRadius: '6px',
            padding: '12px 16px',
            marginBottom: '14px',
            color: '#581c87',
            fontSize: '13px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <span>🏖️</span>
            <div>
              <strong>Approved First-Half Leave Today.</strong> Expected second-half start is <strong>01:00 PM</strong> (arrival window: 12:45 PM – 01:15 PM). Click <em>Check In</em> when reporting for work.
            </div>
          </div>
        )}

        {error && (
          <div style={{
            background: '#ffebe6',
            border: '1px solid #ffbdad',
            color: '#ae2e24',
            padding: '10px 14px',
            borderRadius: '6px',
            fontSize: '13px',
            marginBottom: '14px'
          }}>
            {error}
          </div>
        )}

        {success && (
          <div style={{
            background: '#e3fcef',
            border: '1px solid #abf5d1',
            color: '#216e4e',
            padding: '10px 14px',
            borderRadius: '6px',
            fontSize: '13px',
            marginBottom: '14px'
          }}>
            {success}
          </div>
        )}

        {/* Timings Details Row */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '12px',
          background: '#f7f8f9',
          padding: '12px 16px',
          borderRadius: '6px',
          fontSize: '13px',
          color: '#44546f'
        }}>
          <div>
            <span style={{ fontSize: '11px', textTransform: 'uppercase', color: '#626f86', display: 'block' }}>Check-In Time</span>
            <strong style={{ color: '#172b4d', fontSize: '14px' }}>
              {formatKolkataTime(attendance?.check_in_time)}
            </strong>
          </div>

          <div>
            <span style={{ fontSize: '11px', textTransform: 'uppercase', color: '#626f86', display: 'block' }}>Check-Out Time</span>
            <strong style={{ color: '#172b4d', fontSize: '14px' }}>
              {formatKolkataTime(attendance?.check_out_time)}
            </strong>
          </div>

          <div>
            <span style={{ fontSize: '11px', textTransform: 'uppercase', color: '#626f86', display: 'block' }}>Lunch Deduction</span>
            <strong style={{ color: '#172b4d', fontSize: '14px' }}>
              {formatMinutes(attendance?.break_duration_minutes || 0)}
            </strong>
          </div>

          <div>
            <span style={{ fontSize: '11px', textTransform: 'uppercase', color: '#626f86', display: 'block' }}>Net Duration</span>
            <strong style={{ color: isCheckedOut ? '#0c66e4' : '#172b4d', fontSize: '14px' }}>
              {formatMinutes(attendance?.net_duration_minutes || 0)}
            </strong>
          </div>
        </div>
      </div>
    </div>
  );
}

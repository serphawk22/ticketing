'use client';

import { useState, useEffect } from 'react';
import { formatKolkataTime } from '@/lib/attendanceMeta';

export default function AdminAttendanceModal({
  isOpen,
  onClose,
  employee,
  workDate,
  attendance,
  onSaved,
}) {
  const [status, setStatus] = useState('present');
  const [checkInTime, setCheckInTime] = useState('');
  const [checkOutTime, setCheckOutTime] = useState('');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [auditLogs, setAuditLogs] = useState([]);

  useEffect(() => {
    if (isOpen) {
      setError('');
      setReason('');
      if (attendance) {
        setStatus(attendance.status || 'present');
        // Convert ISO timestamps to datetime-local input format (YYYY-MM-DDTHH:mm)
        setCheckInTime(attendance.check_in_time ? attendance.check_in_time.slice(0, 16) : '');
        setCheckOutTime(attendance.check_out_time ? attendance.check_out_time.slice(0, 16) : '');
      } else {
        setStatus('present');
        setCheckInTime(`${workDate}T09:00`);
        setCheckOutTime(`${workDate}T17:00`);
      }
    }
  }, [isOpen, attendance, workDate]);

  if (!isOpen) return null;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!reason || reason.trim().length < 5) {
      setError('A mandatory reason of at least 5 characters is required.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/attendance/admin/adjust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          attendanceId: attendance?.id || null,
          employeeId: employee.id,
          workDate,
          status,
          checkInTime: checkInTime ? new Date(checkInTime).toISOString() : null,
          checkOutTime: checkOutTime ? new Date(checkOutTime).toISOString() : null,
          reason: reason.trim(),
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Failed to update attendance.');
      }

      onSaved(json.attendance);
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
        background: '#ffffff',
        borderRadius: '8px',
        maxWidth: '560px',
        width: '100%',
        boxShadow: '0 8px 30px rgba(0, 0, 0, 0.2)',
        overflow: 'hidden',
        maxHeight: '90vh',
        display: 'flex',
        flexDirection: 'column'
      }}>
        <div style={{ padding: '18px 24px', borderBottom: '1px solid #ebecf0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 600, color: '#172b4d' }}>
              {attendance ? 'Correct Attendance Record' : 'Regularize Attendance'}
            </h3>
            <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#626f86' }}>
              Employee: <strong>{employee?.name}</strong> · Date: <strong>{workDate}</strong>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: '#626f86' }}
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ padding: '20px 24px', overflowY: 'auto' }}>
          {error && (
            <div style={{ background: '#ffebe6', color: '#ae2e24', padding: '10px 14px', borderRadius: '6px', fontSize: '13px', marginBottom: '16px' }}>
              {error}
            </div>
          )}

          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#44546f', marginBottom: '6px' }}>
              Attendance Status *
            </label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #dfe1e6', fontSize: '14px', color: '#172b4d', background: '#fff' }}
            >
              <option value="present">Present / Full Day</option>
              <option value="late">Late Arrival</option>
              <option value="half_day">Half Day</option>
              <option value="on_leave">On Leave (Approved)</option>
              <option value="absent">Absent</option>
            </select>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '16px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#44546f', marginBottom: '6px' }}>
                Check-In Timestamp
              </label>
              <input
                type="datetime-local"
                value={checkInTime}
                onChange={(e) => setCheckInTime(e.target.value)}
                disabled={status === 'absent' || status === 'on_leave'}
                style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #dfe1e6', fontSize: '13px', color: '#172b4d' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#44546f', marginBottom: '6px' }}>
                Check-Out Timestamp
              </label>
              <input
                type="datetime-local"
                value={checkOutTime}
                onChange={(e) => setCheckOutTime(e.target.value)}
                disabled={status === 'absent' || status === 'on_leave'}
                style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #dfe1e6', fontSize: '13px', color: '#172b4d' }}
              />
            </div>
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#44546f', marginBottom: '6px' }}>
              Reason for Adjustment / Regularization * (Mandatory)
            </label>
            <textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Provide a clear justification (e.g., 'Employee present on site but missed mobile punch', 'Approved medical leave', etc.)"
              required
              style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #dfe1e6', fontSize: '13px', color: '#172b4d', resize: 'vertical' }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              style={{ padding: '8px 16px', borderRadius: '6px', border: '1px solid #dfe1e6', background: '#fff', color: '#44546f', fontSize: '13px', fontWeight: 500, cursor: 'pointer' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              style={{ padding: '8px 18px', borderRadius: '6px', border: 'none', background: '#0c66e4', color: '#fff', fontSize: '13px', fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer' }}
            >
              {loading ? 'Saving...' : 'Save & Record Audit'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}


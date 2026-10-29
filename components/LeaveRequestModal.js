'use client';

import { useState } from 'react';
import { LEAVE_TYPES } from '@/lib/attendanceMeta';

export default function LeaveRequestModal({ isOpen, onClose, onSubmitted, balanceData = null }) {
  const [leaveType, setLeaveType] = useState('casual');
  const [dayType, setDayType] = useState('full_day');
  const todayStr = new Date().toISOString().slice(0, 10);
  const [startDate, setStartDate] = useState(todayStr);
  const [endDate, setEndDate] = useState(todayStr);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  if (!isOpen) return null;

  const isHalfDay = dayType === 'first_half' || dayType === 'second_half';

  // Calculate days difference from today for notice check
  const startMs = new Date(`${startDate}T00:00:00Z`).getTime();
  const todayMs = new Date(`${todayStr}T00:00:00Z`).getTime();
  const daysNotice = Math.round((startMs - todayMs) / 86400000);

  // Available balance for selected leave type
  const data = balanceData?.balances || balanceData;
  const categoriesMap = data?.categories || {};

  // Build available types dynamically from policy categories
  let availableTypes = [];
  const catEntries = Object.entries(categoriesMap).filter(([code]) => code !== 'holidays');
  if (catEntries.length > 0) {
    availableTypes = catEntries
      .filter(([, cat]) => cat.is_active !== false && cat.isEligible !== false && cat.isConfigured !== false)
      .map(([code, cat]) => ({
        key: code,
        label: cat.name || code,
        remaining: cat.remainingBalance ?? 0,
        allowPastDates: cat.allowPastDates,
      }));
  }

  // Fallback if categories not yet loaded
  if (availableTypes.length === 0) {
    const isClEligible = categoriesMap?.casual?.isEligible !== false;
    const isOptionalConfigured = categoriesMap?.optional?.isConfigured ?? false;
    availableTypes = LEAVE_TYPES.filter((t) => {
      if (t.key === 'casual' && !isClEligible) return false;
      if (t.key === 'optional' && !isOptionalConfigured) return false;
      return true;
    }).map((t) => ({
      key: t.key,
      label: t.label,
      remaining: categoriesMap?.[t.key]?.remainingBalance ?? 0,
    }));
  }

  // Ensure current leaveType is valid
  const currentKeyValid = availableTypes.some((t) => t.key === leaveType);
  const activeTypeKey = currentKeyValid ? leaveType : (availableTypes[0]?.key || 'casual');

  const activeCategory = categoriesMap?.[activeTypeKey];
  const remainingBalance = activeCategory ? activeCategory.remainingBalance : null;
  const allowPastDates = activeCategory?.allowPastDates || activeTypeKey === 'sick';

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
        background: '#ffffff',
        borderRadius: '8px',
        maxWidth: '520px',
        width: '100%',
        boxShadow: '0 8px 30px rgba(0, 0, 0, 0.2)',
        overflow: 'hidden',
      }}>
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid #ebecf0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: '#f4f5f7'
        }}>
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#172b4d' }}>
            Apply for Leave
          </h3>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '18px',
              cursor: 'pointer',
              color: '#6b778c'
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
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#44546f', marginBottom: '6px' }}>
                Leave Type *
              </label>
              <select
                value={activeTypeKey}
                onChange={(e) => setLeaveType(e.target.value)}
                style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #dfe1e6', fontSize: '13px', color: '#172b4d', background: '#fff' }}
              >
                {availableTypes.map((t) => {
                  const bal = categoriesMap[t.key]?.remainingBalance ?? t.remaining;
                  const balStr = bal !== undefined && bal !== null ? ` — (${bal.toFixed(1)} days available)` : '';
                  return (
                    <option key={t.key} value={t.key}>
                      {t.label}{balStr}
                    </option>
                  );
                })}
              </select>
              {remainingBalance !== null && (
                <div style={{ marginTop: '4px', fontSize: '11px', color: remainingBalance > 0 ? '#006644' : '#bf2600', fontWeight: 600 }}>
                  {remainingBalance > 0
                    ? `✓ Available: ${remainingBalance.toFixed(1)} days remaining`
                    : `⚠️ 0.0 days remaining (Loss of Pay applies)`}
                </div>
              )}
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#44546f', marginBottom: '6px' }}>
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
                style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #dfe1e6', fontSize: '13px', color: '#172b4d', background: '#fff' }}
              >
                <option value="full_day">Full Day</option>
                <option value="first_half">First Half (09:00 AM – 01:00 PM)</option>
                <option value="second_half">Second Half (01:00 PM – 05:00 PM)</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: isHalfDay ? '1fr' : '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#44546f', marginBottom: '6px' }}>
                {isHalfDay ? 'Leave Date *' : 'Start Date *'}
              </label>
              <input
                type="date"
                value={startDate}
                min={allowPastDates ? undefined : todayStr}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  if (isHalfDay) setEndDate(e.target.value);
                }}
                required
                style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #dfe1e6', fontSize: '13px', color: '#172b4d' }}
              />
            </div>

            {!isHalfDay && (
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#44546f', marginBottom: '6px' }}>
                  End Date *
                </label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  min={startDate}
                  required
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #dfe1e6', fontSize: '13px', color: '#172b4d' }}
                />
              </div>
            )}
          </div>

          {/* 7-Day Advance Notice Advisory for Planned Casual Leave */}
          {leaveType === 'casual' && daysNotice >= 0 && daysNotice < 7 && (
            <div style={{
              background: '#e9f2ff',
              border: '1px solid #b3d4ff',
              borderRadius: '6px',
              padding: '10px 14px',
              marginBottom: '14px',
              fontSize: '12px',
              color: '#0747a6',
              lineHeight: '1.4'
            }}>
              ℹ️ <strong>Advance Notice Guideline:</strong> As per SERP Hawk Leave Policy 2026, planned Casual Leave requests require <strong>7 working days prior notice</strong>. This submission may be subject to additional management review.
            </div>
          )}

          {/* LOP Advisory if remaining balance is low or 0 */}
          {remainingBalance !== null && remainingBalance <= 0 && (
            <div style={{
              background: '#fffae6',
              border: '1px solid #ffe380',
              borderRadius: '6px',
              padding: '10px 14px',
              marginBottom: '14px',
              fontSize: '12px',
              color: '#7f5f01',
              lineHeight: '1.4'
            }}>
              ⚠️ <strong>Loss of Pay (LOP) Notice:</strong> Your available balance for {leaveType.toUpperCase()} is <strong>0.0 days</strong>. If approved by Admin, this leave request will be recorded as <strong>Loss of Pay (LOP)</strong>.
            </div>
          )}

          <div style={{
            background: '#f4f5f7',
            borderRadius: '6px',
            padding: '10px 14px',
            marginBottom: '16px',
            fontSize: '12px',
            color: '#44546f'
          }}>
            ℹ️ <strong>Working-Day Accounting:</strong> Sundays and official company holidays within your selected dates are automatically excluded from leave consumption.
          </div>

          <div style={{ marginBottom: '18px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#44546f', marginBottom: '6px' }}>
              Reason for Leave * (Minimum 5 characters)
            </label>
            <textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g., Medical appointment, family event, personal travel..."
              required
              style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #dfe1e6', fontSize: '13px', color: '#172b4d' }}
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
                border: '1px solid #dfe1e6',
                background: '#fff',
                fontSize: '13px',
                fontWeight: 600,
                color: '#44546f',
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
                background: '#0c66e4',
                fontSize: '13px',
                fontWeight: 600,
                color: '#fff',
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


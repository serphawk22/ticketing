'use client';

import { useEffect, useState } from 'react';
import { ticketKey } from '../meta';

export default function ChangeDueDateModal({
  ticket,
  defaultNewDate = '',
  onClose,
  onSave,
}) {
  const currentDue = ticket?.due_date || '';
  const [newDueDate, setNewDueDate] = useState(defaultNewDate || ticket?.targetInitialDate || '');
  const [blocker, setBlocker] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    const cleanDate = String(newDueDate || '').trim();
    const cleanBlocker = String(blocker || '').trim();
    const cleanReason = String(reason || '').trim();

    if (!cleanDate) {
      setError('New due date is required.');
      return;
    }

    if (!cleanBlocker) {
      setError('Blocker description is mandatory and cannot be empty.');
      return;
    }

    if (!cleanReason) {
      setError('Reason for delay is mandatory and cannot be empty.');
      return;
    }

    if (currentDue && cleanDate === currentDue) {
      setError('New due date must be different from current due date.');
      return;
    }

    if (ticket?.start_date && cleanDate < ticket.start_date) {
      setError(`New due date cannot be before start date (${ticket.start_date}).`);
      return;
    }

    setSubmitting(true);
    try {
      await onSave({
        due_date: cleanDate,
        blocker: cleanBlocker,
        reason: cleanReason,
        expected_due_date: currentDue,
      });
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to change due date.');
    } finally {
      setSubmitting(false);
    }
  }

  const key = ticket ? ticketKey(ticket) : '';

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div
        className="modal change-due-date-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Change Due Date"
        onMouseDown={(e) => e.stopPropagation()}
        style={{ maxWidth: '520px', width: '100%', borderRadius: '8px' }}
      >
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid var(--border, #dfe1e6)' }}>
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>
            Change Due Date {key ? `· ${key}` : ''}
          </h3>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close"
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '18px', color: 'var(--muted, #666)' }}
          >
            ✕
          </button>
        </header>

        <form onSubmit={handleSubmit} style={{ padding: '20px' }}>
          {error && (
            <div
              className="error-text"
              style={{
                marginBottom: '16px',
                padding: '10px 12px',
                background: '#ffebe6',
                color: '#bf2600',
                borderRadius: '4px',
                fontSize: '13px',
              }}
            >
              {error}
            </div>
          )}

          <div className="form-group" style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--muted, #666)', marginBottom: '4px' }}>
              Current Due Date
            </label>
            <input
              type="text"
              readOnly
              value={currentDue || 'None set'}
              style={{
                width: '100%',
                padding: '8px 12px',
                background: 'var(--subtle, #f4f5f7)',
                border: '1px solid var(--border, #dfe1e6)',
                borderRadius: '4px',
                color: 'var(--text, #172b4d)',
                fontSize: '14px',
              }}
            />
          </div>

          <div className="form-group" style={{ marginBottom: '16px' }}>
            <label htmlFor="new-due-date" style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
              New Due Date <span style={{ color: '#de350b' }}>*</span>
            </label>
            <input
              id="new-due-date"
              type="date"
              required
              value={newDueDate}
              min={ticket?.start_date || undefined}
              onChange={(e) => {
                setNewDueDate(e.target.value);
                setError('');
              }}
              style={{
                width: '100%',
                padding: '8px 12px',
                border: '1px solid var(--border, #dfe1e6)',
                borderRadius: '4px',
                fontSize: '14px',
              }}
            />
          </div>

          <div className="form-group" style={{ marginBottom: '16px' }}>
            <label htmlFor="due-date-blocker" style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
              Blocker <span style={{ color: '#de350b' }}>*</span>
            </label>
            <textarea
              id="due-date-blocker"
              required
              rows={3}
              value={blocker}
              placeholder="e.g. Client has not provided required server access credentials."
              onChange={(e) => {
                setBlocker(e.target.value);
                setError('');
              }}
              style={{
                width: '100%',
                padding: '8px 12px',
                border: '1px solid var(--border, #dfe1e6)',
                borderRadius: '4px',
                fontSize: '14px',
                resize: 'vertical',
              }}
            />
          </div>

          <div className="form-group" style={{ marginBottom: '20px' }}>
            <label htmlFor="due-date-reason" style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
              Reason for Delay <span style={{ color: '#de350b' }}>*</span>
            </label>
            <textarea
              id="due-date-reason"
              required
              rows={3}
              value={reason}
              placeholder="e.g. Without credentials, investigation cannot be completed. Additional time is needed once access is granted."
              onChange={(e) => {
                setReason(e.target.value);
                setError('');
              }}
              style={{
                width: '100%',
                padding: '8px 12px',
                border: '1px solid var(--border, #dfe1e6)',
                borderRadius: '4px',
                fontSize: '14px',
                resize: 'vertical',
              }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={submitting}
              style={{ padding: '8px 16px', borderRadius: '4px', border: '1px solid var(--border, #dfe1e6)', background: '#fff', cursor: 'pointer' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={submitting}
              style={{ padding: '8px 16px', borderRadius: '4px', cursor: 'pointer' }}
            >
              {submitting ? 'Saving changes…' : 'Change Due Date'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

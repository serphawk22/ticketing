'use client';

import { useState, useEffect } from 'react';

function EyeIcon({ off }) {
  if (off) {
    return (
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
        <line x1="1" y1="1" x2="23" y2="23" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export default function ChangePasswordModal({ open, onClose, onSuccess }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (newPassword !== confirmPassword) {
      setError('The two new passwords do not match.');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Could not change your password.');
      }

      onSuccess?.();
      onClose();
    } catch (err) {
      setError(err.message || 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  }

  const hasLength = newPassword.length >= 12;
  const hasLower = /[a-z]/.test(newPassword);
  const hasUpper = /[A-Z]/.test(newPassword);
  const hasNumber = /[0-9]/.test(newPassword);
  const hasSymbol = /[^A-Za-z0-9]/.test(newPassword);

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="change-password-title">
      <div className="modal-panel password-modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2 id="change-password-title" className="modal-title">Change Password</h2>
          <button type="button" className="icon-btn modal-close" onClick={onClose} aria-label="Close dialog">
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="password-modal-form">
          {error && (
            <div className="auth-split-alert" role="alert">
              <span>{error}</span>
            </div>
          )}

          <div className="form-field">
            <label htmlFor="modal-current-password">Current Password</label>
            <div className="input-wrap-with-toggle">
              <input
                id="modal-current-password"
                type={showCurrent ? 'text' : 'password'}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Enter current password"
                required
                autoFocus
              />
              <button
                type="button"
                className="icon-btn pass-toggle-btn"
                onClick={() => setShowCurrent((v) => !v)}
                aria-label={showCurrent ? 'Hide current password' : 'Show current password'}
              >
                <EyeIcon off={showCurrent} />
              </button>
            </div>
          </div>

          <div className="form-field">
            <label htmlFor="modal-new-password">New Password</label>
            <div className="input-wrap-with-toggle">
              <input
                id="modal-new-password"
                type={showNew ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="At least 12 characters"
                required
              />
              <button
                type="button"
                className="icon-btn pass-toggle-btn"
                onClick={() => setShowNew((v) => !v)}
                aria-label={showNew ? 'Hide new password' : 'Show new password'}
              >
                <EyeIcon off={showNew} />
              </button>
            </div>
          </div>

          <div className="form-field">
            <label htmlFor="modal-confirm-password">Confirm New Password</label>
            <input
              id="modal-confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-enter new password"
              required
            />
          </div>

          <div className="password-rules-box">
            <p className="password-rules-title">Password must include:</p>
            <ul className="password-rules-list">
              <li className={hasLength ? 'rule-met' : ''}>12+ characters</li>
              <li className={hasUpper ? 'rule-met' : ''}>Uppercase letter</li>
              <li className={hasLower ? 'rule-met' : ''}>Lowercase letter</li>
              <li className={hasNumber ? 'rule-met' : ''}>Number (0-9)</li>
              <li className={hasSymbol ? 'rule-met' : ''}>Special symbol</li>
            </ul>
          </div>

          <div className="modal-foot">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Updating…' : 'Update Password'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}


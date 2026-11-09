'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { safeRedirectPath } from '@/lib/safeRedirect';

/**
 * The screen an admin-created account lands on instead of the app.
 *
 * It deliberately does not render AppShell: this is the one authenticated page
 * reachable while must_change_password is set, so putting the normal chrome
 * around it would leave the rest of the app one click away.
 */
export default function ChangePasswordView({ currentUser, forced }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const router = useRouter();

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
      if (!res.ok) throw new Error(data.error || 'Could not change your password.');

      // The flag is cleared server-side; refresh re-reads the session so the
      // app stops redirecting back here. A client lands in their portal rather
      // than the team board they are not allowed on. A ticket link that led
      // here carries its destination in ?next and is honoured afterwards.
      const role = data.role || currentUser?.role;
      const next = safeRedirectPath(
        new URLSearchParams(window.location.search).get('next')
      );
      router.refresh();
      if (role === 'client') {
        router.push('/client');
      } else if (next) {
        router.push(next);
      } else if (role === 'admin') {
        router.push('/dashboard');
      } else {
        router.push('/my-dashboard');
      }
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  return (
    <div
      className="auth-wrap"
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <form className="auth-card" onSubmit={handleSubmit}>
        <div className="auth-brand">
          <span className="auth-logo" aria-hidden="true">
            T
          </span>
          <span>Ticket Manager</span>
        </div>

        <h1 className="auth-title">Set a new password</h1>

        {forced ? (
          <p className="auth-hint">
            Hi {currentUser?.name}, an admin created your account and emailed you a
            temporary password. Choose your own before you continue &mdash; the
            temporary one was sent in plain text and should not stay in use.
          </p>
        ) : (
          <p className="auth-hint">Choose a new password for your account.</p>
        )}

        {error && (
          <div className="notice-banner" role="alert">
            {error}
          </div>
        )}

        <label className="field">
          <span>Temporary password</span>
          <div style={{ position: 'relative' }}>
            <input
              id="current-password"
              type={showCurrent ? 'text' : 'password'}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
              required
              style={{ paddingLeft: '40px', width: '100%' }}
            />
            <button
              type="button"
              onClick={() => setShowCurrent((v) => !v)}
              style={{
                position: 'absolute',
                left: '10px',
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                padding: '4px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'inherit',
              }}
              aria-label="Toggle password visibility"
            >
              {showCurrent ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
          </div>
        </label>

        <label className="field">
          <span>New password</span>
          <div style={{ position: 'relative' }}>
            <input
              id="new-password"
              type={showNew ? 'text' : 'password'}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              required
              style={{ paddingLeft: '40px', width: '100%' }}
            />
            <button
              type="button"
              onClick={() => setShowNew((v) => !v)}
              style={{
                position: 'absolute',
                left: '10px',
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                padding: '4px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'inherit',
              }}
              aria-label="Toggle password visibility"
            >
              {showNew ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
          </div>
        </label>

        <p className="auth-hint">
          At least 12 characters, with an uppercase letter, a lowercase letter, a
          number and a symbol.
        </p>

        <label className="field">
          <span>Confirm new password</span>
          <div style={{ position: 'relative' }}>
            <input
              id="confirm-password"
              type={showConfirm ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              required
              style={{ paddingLeft: '40px', width: '100%' }}
            />
            <button
              type="button"
              onClick={() => setShowConfirm((v) => !v)}
              style={{
                position: 'absolute',
                left: '10px',
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                padding: '4px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'inherit',
              }}
              aria-label="Toggle password visibility"
            >
              {showConfirm ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
          </div>
        </label>

        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? 'Saving...' : 'Set password and continue'}
        </button>
      </form>
    </div>
  );
}
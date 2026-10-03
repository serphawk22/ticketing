'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

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
      // than the team board they are not allowed on.
      const role = data.role || currentUser?.role;
      router.refresh();
      router.push(role === 'client' ? '/client' : '/');
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className="auth-wrap">
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
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>

        <label className="field">
          <span>New password</span>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
            required
          />
        </label>

        <p className="auth-hint">
          At least 12 characters, with an uppercase letter, a lowercase letter, a
          number and a symbol.
        </p>

        <label className="field">
          <span>Confirm new password</span>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
            required
          />
        </label>

        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? 'Saving...' : 'Set password and continue'}
        </button>
      </form>
    </div>
  );
}
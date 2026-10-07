'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [resetEmail, setResetEmail] = useState('');
  const [resetSent, setResetSent] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Login failed.');
        return;
      }

      // An admin-created account is still on its temporary password; send it
      // to the reset screen rather than into the app it cannot use yet.
      if (data.user?.mustChangePassword) {
        router.push('/change-password');
      } else if (data.user?.role === 'client') {
        // A client belongs in their own portal, not the team board. Signing in
        // here still works for them, it just lands in the right place.
        router.push('/client');
      } else {
        router.push('/');
      }
      router.refresh();
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleForgot(e) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // The server answers the same way no matter what, so the page never
      // reveals whether an account exists; it just turns the form into the
      // "check your inbox" message.
      await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: resetEmail }),
      });
      setResetSent(true);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="logo-tile" aria-hidden="true">
            T
          </div>
          <h1>Ticket Manager</h1>
        </div>

        {mode === 'forgot' ? (
          <>
            <p className="sub">Reset your password</p>

            {resetSent ? (
              <div className="auth-ok">
                If an account exists for that email, a reset email with a
                temporary password is on its way. Sign in with it and you will
                be asked to set your own password straight away.
              </div>
            ) : (
              <form onSubmit={handleForgot}>
                <div className="form-group">
                  <label htmlFor="reset-email">Email</label>
                  <input
                    id="reset-email"
                    type="email"
                    value={resetEmail}
                    onChange={(e) => setResetEmail(e.target.value)}
                    placeholder="you@example.com"
                    required
                    autoFocus
                  />
                </div>

                <div className="form-group">
                  <button
                    type="submit"
                    className="btn-primary"
                    disabled={loading}
                  >
                    {loading ? 'Sending…' : 'Send reset email'}
                  </button>
                </div>
              </form>
            )}

            <button
              type="button"
              className="link-button auth-back"
              onClick={() => {
                setMode('signin');
                setResetSent(false);
                setResetEmail('');
              }}
            >
              &larr; Back to sign in
            </button>
          </>
        ) : (
          <>
            <p className="sub">Sign in to continue</p>

            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label htmlFor="email">Email</label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  autoFocus
                />
              </div>

              <div className="form-group">
                <label htmlFor="password">Password</label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                />
              </div>

              <div className="auth-forgot">
                <button
                  type="button"
                  className="link-button"
                  onClick={() => {
                    setMode('forgot');
                    setResetEmail(email);
                  }}
                >
                  Forgot your password?
                </button>
              </div>

              <div className="form-group">
                <button type="submit" className="btn-primary" disabled={loading}>
                  {loading ? 'Signing in…' : 'Sign in'}
                </button>
              </div>
            </form>
          </>
        )}

        {error && <div className="error-text">{error}</div>}

        <p className="auth-demo">
          Demo accounts
          <br />
          admin: <code>admin@example.com</code> / <code>admin123</code>
          <br />
          developer: <code>dev@example.com</code> / <code>dev123</code>
        </p>
      </div>
    </div>
  );
}
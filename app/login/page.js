'use client';

import { useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const containerRef = useRef(null);
  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [resetEmail, setResetEmail] = useState('');
  const [resetSent, setResetSent] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleMouseMove = useCallback((e) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.setProperty('--mouse-x', `${e.clientX - rect.left}px`);
    el.style.setProperty('--mouse-y', `${e.clientY - rect.top}px`);
  }, []);

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

      if (data.user?.mustChangePassword) {
        router.push('/change-password');
      } else if (data.user?.role === 'client') {
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
    <main
      ref={containerRef}
      className="auth-split-container"
      onMouseMove={handleMouseMove}
    >
      <div className="auth-split-cursor" aria-hidden="true" />
      <div className="auth-split-visual">
        <div className="auth-split-visual-bg" aria-hidden="true">
          <div className="auth-split-blob auth-split-blob-1" />
          <div className="auth-split-blob auth-split-blob-2" />
          <div className="auth-split-blob auth-split-blob-3" />
          <div className="auth-split-ring auth-split-ring-1" />
          <div className="auth-split-ring auth-split-ring-2" />
          <div className="auth-split-ring auth-split-ring-3" />
          <div className="auth-split-dots" />
        </div>
        <div className="auth-split-visual-content">
          <div className="auth-split-brand">
            <div className="auth-split-logo">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" />
                <path d="M13 5v2" />
                <path d="M13 17v2" />
                <path d="M13 11v2" />
              </svg>
            </div>
            <span className="auth-split-brand-name">Ticket Manager</span>
          </div>
          <h2 className="auth-split-tagline">
            Support, simplified.
          </h2>
          <p className="auth-split-subtagline">
            Track, manage, and resolve every request with clarity and speed.
          </p>
          <div className="auth-split-features">
            <div className="auth-split-feature">
              <div className="auth-split-feature-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
              </div>
              <span>Secure by default</span>
            </div>
            <div className="auth-split-feature">
              <div className="auth-split-feature-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                </svg>
              </div>
              <span>Lightning fast</span>
            </div>
            <div className="auth-split-feature">
              <div className="auth-split-feature-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              </div>
              <span>Built for teams</span>
            </div>
          </div>
        </div>
      </div>

      <div className="auth-split-form">
        <div className="auth-split-form-inner">
          <div className="auth-split-form-brand">
            <div className="auth-split-logo auth-split-logo-sm">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" />
                <path d="M13 5v2" />
                <path d="M13 17v2" />
                <path d="M13 11v2" />
              </svg>
            </div>
            <span className="auth-split-brand-name-sm">Ticket Manager</span>
          </div>

          <div className="auth-split-heading">
            <h1>{mode === 'forgot' ? 'Reset your password' : 'Welcome back'}</h1>
            <p>
              {mode === 'forgot'
                ? 'Enter your email and we will send a reset link.'
                : 'Sign in to continue to your dashboard.'}
            </p>
          </div>

          {error && (
            <div className="auth-split-alert" role="alert">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>{error}</span>
            </div>
          )}

          {mode === 'forgot' ? (
            resetSent ? (
              <div className="auth-split-success">
                <div className="auth-split-success-icon">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                    <polyline points="22 4 12 14.01 9 11.01" />
                  </svg>
                </div>
                <p>If an account exists for that email, a reset email with a temporary password is on its way. Sign in with it and you will be asked to set your own password straight away.</p>
              </div>
            ) : (
              <form onSubmit={handleForgot} className="auth-split-form-element">
                <div className="auth-split-field">
                  <label htmlFor="reset-email">Email address</label>
                  <div className="auth-split-input-wrap">
                    <span className="auth-split-input-icon" aria-hidden="true">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="2.5" y="4.5" width="19" height="15" rx="2.5" />
                        <path d="m3.4 7.4 7.6 5.2a2 2 0 0 0 2 0l7.6-5.2" />
                      </svg>
                    </span>
                    <input
                      id="reset-email"
                      type="email"
                      value={resetEmail}
                      onChange={(e) => setResetEmail(e.target.value)}
                      placeholder="you@example.com"
                      autoComplete="email"
                      required
                      autoFocus
                    />
                  </div>
                </div>
                <button type="submit" className="auth-split-btn" disabled={loading}>
                  {loading ? 'Sending…' : 'Send reset email'}
                </button>
              </form>
            )
          ) : (
            <form onSubmit={handleSubmit} className="auth-split-form-element">
              <div className="auth-split-field">
                <label htmlFor="email">Email address</label>
                <div className="auth-split-input-wrap">
                  <span className="auth-split-input-icon" aria-hidden="true">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2.5" y="4.5" width="19" height="15" rx="2.5" />
                      <path d="m3.4 7.4 7.6 5.2a2 2 0 0 0 2 0l7.6-5.2" />
                    </svg>
                  </span>
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    autoComplete="email"
                    required
                    autoFocus
                  />
                </div>
              </div>

              <div className="auth-split-field">
                <label htmlFor="password">Password</label>
                <div className="auth-split-input-wrap">
                  <span className="auth-split-input-icon" aria-hidden="true">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="4" y="10.5" width="16" height="10" rx="2.5" />
                      <path d="M8 10.5V7.6a4 4 0 0 1 8 0v2.9" />
                    </svg>
                  </span>
                  <input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    required
                  />
                </div>
              </div>

              <div className="auth-split-forgot">
                <button
                  type="button"
                  className="auth-split-link"
                  onClick={() => {
                    setMode('forgot');
                    setResetEmail(email);
                  }}
                >
                  Forgot your password?
                </button>
              </div>

              <button type="submit" className="auth-split-btn" disabled={loading}>
                {loading ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
          )}

          {mode === 'forgot' && (
            <button
              type="button"
              className="auth-split-back"
              onClick={() => {
                setMode('signin');
                setResetSent(false);
                setResetEmail('');
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="19" y1="12" x2="5" y2="12" />
                <polyline points="12 19 5 12 12 5" />
              </svg>
              Back to sign in
            </button>
          )}

          <div className="auth-split-demo">
            <div className="auth-split-demo-divider">
              <span>Demo accounts</span>
            </div>
            <div className="auth-split-demo-list">
              <div className="auth-split-demo-row">
                <span className="auth-split-demo-role">Admin</span>
                <span className="auth-split-demo-creds">
                  <code>admin@example.com</code>
                  <span className="auth-split-demo-sep">/</span>
                  <code>admin123</code>
                </span>
              </div>
              <div className="auth-split-demo-row">
                <span className="auth-split-demo-role">Developer</span>
                <span className="auth-split-demo-creds">
                  <code>dev@example.com</code>
                  <span className="auth-split-demo-sep">/</span>
                  <code>dev123</code>
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

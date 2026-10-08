'use client';

import { useState, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

/**
 * The client door.
 *
 * Same credentials as the team login, but this page only admits client
 * accounts. A developer who wanders in is told where to go rather than being
 * dropped into a portal they cannot use, and an admin or developer who needs
 * the team app gets a link back to it.
 */
export default function ClientLoginPage() {
  const router = useRouter();
  const containerRef = useRef(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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

      if (data.user?.role !== 'client') {
        setError(
          'This account is not a client account. Use the team sign-in instead.'
        );
        return;
      }

      // A new client account still holds a temporary password, so it goes to the
      // reset screen first and the portal afterwards.
      router.push(data.user?.mustChangePassword ? '/change-password' : '/client');
      router.refresh();
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main
      ref={containerRef}
      className="auth-container auth-login"
      onMouseMove={handleMouseMove}
    >
      <div className="auth-backdrop" aria-hidden="true">
        <span className="auth-blob auth-blob-a" />
        <span className="auth-blob auth-blob-b" />
        <span className="auth-blob auth-blob-c" />
      </div>

      <div className="auth-card">
        <div className="auth-brand">
          <div className="logo-tile" aria-hidden="true">
            T
          </div>
          <span className="auth-brand-name">Ticket Manager</span>
        </div>

        <div className="auth-heading">
          <h1>Client portal</h1>
          <p className="sub">Raise a request and follow its progress</p>
        </div>

        {error && (
          <div className="auth-alert" role="alert">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="client-email">Email</label>
            <input
              id="client-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
              autoFocus
            />
          </div>

          <div className="form-group">
            <label htmlFor="client-password">Password</label>
            <input
              id="client-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              required
            />
          </div>

          <div className="form-group">
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </div>
        </form>

        <p className="auth-demo">
          Are you part of the team?
          <br />
          <Link href="/login">Go to the team sign-in</Link>
        </p>
      </div>
    </main>
  );
}

'use client';

import { useState, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

/**
 * The client door.
 *
 * A client signs in with nothing but their passkey -- the one code an admin
 * mints for them and emails to their address. There is no password to forget
 * and no reset screen to change it on, so the form is a single field. A team
 * member who wanders in is pointed at the team sign-in instead.
 */
export default function ClientLoginPage() {
  const router = useRouter();
  const containerRef = useRef(null);
  const [passkey, setPasskey] = useState('');
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
      const res = await fetch('/api/auth/client-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passkey }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not sign you in.');
        return;
      }

      router.push('/client');
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
          <p className="sub">Enter the passkey your team emailed you</p>
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
            <label htmlFor="client-passkey">Passkey</label>
            <input
              id="client-passkey"
              inputMode="text"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              value={passkey}
              onChange={(e) => setPasskey(e.target.value)}
              placeholder="XXXX-XXXX"
              autoComplete="one-time-code"
              autoFocus
              required
            />
            <p className="client-passkey-hint">
              One passkey per client. If yours is lost, ask your team to issue a
              new one.
            </p>
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
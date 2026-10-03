'use client';

import { useState } from 'react';
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
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="logo-tile" aria-hidden="true">
            T
          </div>
          <h1>Client portal</h1>
        </div>
        <p className="sub">Raise a request and follow its progress</p>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="client-email">Email</label>
            <input
              id="client-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
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
              required
            />
          </div>

          <div className="form-group">
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </div>
        </form>

        {error && <div className="error-text">{error}</div>}

        <p className="auth-demo">
          Are you part of the team?
          <br />
          <Link href="/login">Go to the team sign-in</Link>
        </p>
      </div>
    </div>
  );
}
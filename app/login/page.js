'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [resetEmail, setResetEmail] = useState('');
  const [resetSent, setResetSent] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const element = loginRef.current;
    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (!element || !finePointer.matches || reducedMotion.matches) return undefined;

    let frame = null;
    let currentX = 0;
    let currentY = 0;
    let targetX = 0;
    let targetY = 0;

    function paint() {
      element.style.setProperty('--login-glow-x', `${50 + currentX * 22}%`);
      element.style.setProperty('--login-glow-y', `${50 + currentY * 22}%`);
      element.style.setProperty('--login-parallax-x', currentX.toFixed(3));
      element.style.setProperty('--login-parallax-y', currentY.toFixed(3));
    }

    function animate() {
      currentX += (targetX - currentX) * 0.1;
      currentY += (targetY - currentY) * 0.1;
      paint();

      if (Math.abs(targetX - currentX) > 0.001 || Math.abs(targetY - currentY) > 0.001) {
        frame = window.requestAnimationFrame(animate);
      } else {
        currentX = targetX;
        currentY = targetY;
        paint();
        frame = null;
      }
    }

    function requestAnimation() {
      if (!frame) frame = window.requestAnimationFrame(animate);
    }

    function handlePointerMove(event) {
      const bounds = element.getBoundingClientRect();
      element.style.setProperty('--login-cursor-x', `${event.clientX}px`);
      element.style.setProperty('--login-cursor-y', `${event.clientY}px`);
      element.style.setProperty('--login-cursor-opacity', '1');
      targetX = ((event.clientX - bounds.left) / bounds.width - 0.5) * 2;
      targetY = ((event.clientY - bounds.top) / bounds.height - 0.5) * 2;
      requestAnimation();
    }

    function handlePointerLeave() {
      element.style.setProperty('--login-cursor-opacity', '0');
      targetX = 0;
      targetY = 0;
      requestAnimation();
    }

    element.addEventListener('pointermove', handlePointerMove);
    element.addEventListener('pointerleave', handlePointerLeave);

    return () => {
      element.removeEventListener('pointermove', handlePointerMove);
      element.removeEventListener('pointerleave', handlePointerLeave);
      if (frame) window.cancelAnimationFrame(frame);
    };
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

  function backToSignIn() {
    setMode('signin');
    setResetSent(false);
    setResetEmail('');
    setError('');
  }

  return (
    <main ref={loginRef} className="auth-container login-container">
      <div className="login-glow" aria-hidden="true" />
      <div className="login-orb login-orb-one" aria-hidden="true" />
      <div className="login-orb login-orb-two" aria-hidden="true" />
      <div className="login-cursor" aria-hidden="true" />
      <section className="login-shell" aria-label="Ticket Manager sign in">
        <aside className="login-intro">
          <div className="login-intro-brand">
            <div className="logo-tile" aria-hidden="true">
              T
            </div>
            <span>Ticket Manager</span>
          </div>

          <div className="login-intro-copy">
            <p className="login-kicker">Team workspace</p>
            <h1>Keep every piece of work moving forward.</h1>
            <p>
              Bring requests, priorities, and delivery into one shared view for
              your team.
            </p>
          </div>

          <div className="login-intro-stat" aria-hidden="true">
            <span className="login-stat-mark">+</span>
            <span>Clear work. Calm delivery.</span>
          </div>
        </aside>

        <div className="auth-card login-card">
          <div className="auth-brand">
            <div className="logo-tile" aria-hidden="true">
              T
            </div>
            <span>Ticket Manager</span>
          </div>
          <div className="login-card-heading">
            <h2>{mode === 'forgot' ? 'Reset your password' : 'Welcome back'}</h2>
            <p>
              {mode === 'forgot'
                ? 'Enter your work email and we will send a temporary password.'
                : "Sign in to manage your team's work."}
            </p>
          </div>

          {mode === 'forgot' ? (
            resetSent ? (
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

                <div className="form-group login-submit">
                  <button type="submit" className="btn-primary" disabled={loading}>
                    {loading ? 'Sending…' : 'Send reset email'}
                  </button>
                </div>
              </form>
            )
          ) : (
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label htmlFor="email">Work email</label>
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

              <div className="form-group login-submit">
                <button type="submit" className="btn-primary" disabled={loading}>
                  {loading ? 'Signing in…' : 'Sign in to workspace'}
                </button>
              </div>
            </form>
          )}

          {mode === 'forgot' && (
            <button type="button" className="link-button auth-back" onClick={backToSignIn}>
              &larr; Back to sign in
            </button>
          )}

          {error && <div className="error-text login-error">{error}</div>}

          <div className="auth-demo">
            <strong>Demo access</strong>
            <span>Admin: <code>admin@example.com</code> / <code>admin123</code></span>
            <span>Developer: <code>dev@example.com</code> / <code>dev123</code></span>
          </div>
        </div>
      </section>
    </main>
  );
}

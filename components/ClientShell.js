'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * The chrome every client page shares.
 *
 * The portal is split across routes -- one page to read your requests, another
 * to raise one -- so the top bar lives here rather than being repeated and
 * drifting apart. It keeps its own nav instead of the team AppShell's: a client
 * has no projects, directory or board to move between.
 */
const CLIENT_NAV = [
  { href: '/client', label: 'My requests' },
  { href: '/client/new', label: 'Raise a request' },
];

export default function ClientShell({ currentUser, single = false, children }) {
  const pathname = usePathname();

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/client/login';
  }

  return (
    <div className="client-portal">
      <header className="client-topbar">
        <div className="client-brand">
          <span className="logo-tile" aria-hidden="true">
            T
          </span>
          <span className="client-brand-name">Client portal</span>
        </div>

        <nav className="client-nav">
          {CLIENT_NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={
                pathname === item.href
                  ? 'client-nav-link client-nav-link-active'
                  : 'client-nav-link'
              }
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="client-topbar-right">
          <span className="client-who">{currentUser.name}</span>
          <button type="button" className="btn-secondary" onClick={handleLogout}>
            Sign out
          </button>
        </div>
      </header>

      <main className={single ? 'client-main client-main-single' : 'client-main'}>
        {children}
      </main>
    </div>
  );
}

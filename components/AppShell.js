'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Avatar from './Avatar';

function BoardIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}

function PersonIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="17"
      height="17"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="19"
      height="19"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M3 6h18M3 12h18M3 18h18" />
    </svg>
  );
}

export default function AppShell({
  currentUser,
  projects,
  projectCounts,
  myIssuesCount,
  view = 'board',
  filter,
  onFilterChange,
  projectId,
  onProjectChange,
  children,
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const router = useRouter();

  const isAdmin = currentUser.role === 'admin';

  function selectFilter(next) {
    setSidebarOpen(false);
    if (view === 'board') {
      onFilterChange(next);
      return;
    }
    router.push(next === 'mine' ? '/?filter=mine' : '/');
  }

  function selectProject(id) {
    setSidebarOpen(false);
    onProjectChange(id);
  }

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  }

  return (
    <div className="app">
      <header className="topbar">
        <button
          className="icon-btn sidebar-toggle"
          onClick={() => setSidebarOpen(true)}
          aria-label="Open navigation"
        >
          <MenuIcon />
        </button>

        <div className="brand">
          <div className="logo-mark" aria-hidden="true">
            T
          </div>
          <div className="brand-text">
            <span className="brand-name">Ticket Manager</span>
            <span className="brand-crumb">Development / Board</span>
          </div>
        </div>

        <div className="topbar-divider" />

        <div className="topbar-spacer" />

        <div className="topbar-user">
          <div className="user-meta">
            <span className="user-name">{currentUser.name}</span>
            <span className={`role-tag role-${currentUser.role}`}>
              {isAdmin ? 'Admin' : 'Developer'}
            </span>
          </div>
          <Avatar name={currentUser.name} assigned size={32} />
          <button
            className="icon-btn"
            onClick={handleLogout}
            aria-label="Log out"
            title="Log out"
          >
            <LogoutIcon />
          </button>
        </div>
      </header>

      <div className="app-body">
        {sidebarOpen && (
          <button
            className="sidebar-backdrop"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close navigation"
          />
        )}

        <aside className={`sidebar${sidebarOpen ? ' open' : ''}`}>
          <div className="workspace">
            <div className="workspace-icon">TM</div>
            <div className="workspace-text">
              <div className="workspace-name">Ticket Manager</div>
              <div className="workspace-sub">Development workspace</div>
            </div>
          </div>

          <div className="nav-label">Issues</div>
          <nav className="nav">
            <button
              className={`nav-item${view === 'board' && filter === 'all' ? ' active' : ''}`}
              onClick={() => selectFilter('all')}
            >
              <BoardIcon />
              <span>Board</span>
            </button>

            <button
              className={`nav-item${view === 'board' && filter === 'mine' ? ' active' : ''}`}
              onClick={() => selectFilter('mine')}
            >
              <PersonIcon />
              <span>My issues</span>
              <span className="nav-count">{myIssuesCount}</span>
            </button>
          </nav>

          <div className="nav-label">Projects</div>
          <nav className="nav">
            <Link
              href="/projects"
              className={`nav-item${view === 'projects' ? ' active' : ''}`}
              onClick={() => setSidebarOpen(false)}
            >
              <FolderIcon />
              <span>All projects</span>
              <span className="nav-count">{projects.length}</span>
            </Link>

            {projects.map((p) => (
              <button
                key={p.id}
                className={`nav-item nav-item-project${
                  view === 'board' && String(projectId) === String(p.id) ? ' active' : ''
                }`}
                onClick={() => selectProject(p.id)}
                title={p.name}
              >
                <span
                  className="project-dot"
                  style={{ background: p.color }}
                  aria-hidden="true"
                />
                <span className="nav-label-text">{p.name}</span>
                <span className="nav-count">
                  {projectCounts?.[p.id] ?? p.open_count ?? 0}
                </span>
              </button>
            ))}
          </nav>

          <div className="sidebar-footer">
            <span className="status-dot dot-online" />
            All systems operational · v1.0
          </div>
        </aside>

        {children}
      </div>
    </div>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Avatar from './Avatar';

/* ---------------- Icons ---------------- */

function GridIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm10 0h6v6h-6v-6Z" />
    </svg>
  );
}

function ChevronDown() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.35-4.35" />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </svg>
  );
}

function HelpIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.2 2.4c-.7.2-1.2.9-1.2 1.6v.3" />
      <path d="M12 17h.01" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 8.9 19a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 8.9a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M3 6h18M3 12h18M3 18h18" />
    </svg>
  );
}

function SidebarIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
    </svg>
  );
}

function BoardIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}

function PersonIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    </svg>
  );
}

function PeopleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c0-3.3 2.9-5.5 6.5-5.5s6.5 2.2 6.5 5.5" />
      <path d="M16.5 5.2a3.5 3.5 0 0 1 0 6.6" />
      <path d="M18 14.8c2.1.6 3.5 2.3 3.5 4.7" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  );
}

/* ---------------- Shell ---------------- */

const TOP_NAV = [
  { id: 'work', label: 'Your work', href: '/?filter=mine' },
  { id: 'projects', label: 'Projects', href: '/projects' },
  { id: 'filters', label: 'Filters', href: '/?filter=all' },
  { id: 'people', label: 'People', href: '/employees' },
];

export default function AppShell({
  currentUser,
  projects,
  projectCounts,
  employeeCount = null,
  myIssuesCount,
  view = 'board',
  filter,
  onFilterChange,
  projectId,
  onProjectChange,
  onCreate,
  children,
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [navSearch, setNavSearch] = useState('');
  const menuRef = useRef(null);
  const router = useRouter();

  const isAdmin = currentUser.role === 'admin';

  useEffect(() => {
    if (!menuOpen) return;
    function onDocClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    }
    function onKey(e) {
      if (e.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const activeProject =
    view === 'board' && projectId && String(projectId) !== 'all'
      ? projects.find((p) => String(p.id) === String(projectId))
      : null;

  const primaryProject = activeProject || projects[0] || null;

  function isNavActive(item) {
    if (item.id === 'people') return view === 'employees';
    if (item.id === 'projects') return view === 'projects';
    if (item.id === 'work') return view === 'board' && filter === 'mine';
    if (item.id === 'filters') return view === 'board' && filter !== 'mine';
    return false;
  }

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

  function handleNavSearch(e) {
    e.preventDefault();
    const q = navSearch.trim();
    if (q) router.push(`/?q=${encodeURIComponent(q)}`);
  }

  return (
    <div className={`app${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
      {/* ---------------- Top navigation ---------------- */}
      <header className="topnav">
        <button
          className="icon-btn topnav-hamburger"
          onClick={() => setSidebarOpen(true)}
          aria-label="Open navigation"
        >
          <MenuIcon />
        </button>

        <button
          className="icon-btn topnav-grid"
          onClick={() => setSidebarCollapsed((c) => !c)}
          aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <GridIcon />
        </button>

        <Link href="/" className="topnav-brand" aria-label="Ticket Manager home">
          <span className="logo-tile" aria-hidden="true">
            T
          </span>
          <span className="topnav-brand-name">Ticket Manager</span>
        </Link>

        <nav className="topnav-items" aria-label="Primary">
          {TOP_NAV.map((item) => (
            <Link
              key={item.id}
              href={item.href}
              className={`topnav-item${isNavActive(item) ? ' active' : ''}`}
              aria-current={isNavActive(item) ? 'page' : undefined}
            >
              {item.label}
              <ChevronDown />
            </Link>
          ))}
          <div className="topnav-more-wrap">
            <button
              className="topnav-item topnav-more"
              onClick={() => setMoreOpen((o) => !o)}
              aria-expanded={moreOpen}
              aria-haspopup="true"
            >
              More
              <ChevronDown />
            </button>
            {moreOpen && (
              <div className="menu-popup topnav-more-menu">
                {TOP_NAV.map((item) => (
                  <Link
                    key={item.id}
                    href={item.href}
                    className="menu-item"
                    onClick={() => setMoreOpen(false)}
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
        </nav>

        {onCreate && (
          <button className="btn-primary topnav-create" onClick={onCreate}>
            <PlusIcon />
            Create
          </button>
        )}

        <div className="topnav-spacer" />

        <form className="topnav-search" onSubmit={handleNavSearch} role="search">
          <SearchIcon />
          <input
            value={navSearch}
            onChange={(e) => setNavSearch(e.target.value)}
            placeholder="Search"
            aria-label="Search tickets"
          />
        </form>

        <button className="icon-btn" aria-label="Notifications" title="Notifications">
          <BellIcon />
        </button>
        <button className="icon-btn" aria-label="Help" title="Help">
          <HelpIcon />
        </button>
        <button className="icon-btn" aria-label="Settings" title="Settings">
          <SettingsIcon />
        </button>

        <div className="topnav-avatar-wrap" ref={menuRef}>
          <button
            className="topnav-avatar-btn"
            onClick={() => setMenuOpen((o) => !o)}
            aria-haspopup="true"
            aria-expanded={menuOpen}
            aria-label="Account menu"
          >
            <Avatar name={currentUser.name} assigned size={32} />
          </button>
          {menuOpen && (
            <div className="menu-popup account-menu" role="menu">
              <div className="account-head">
                <Avatar name={currentUser.name} assigned size={32} />
                <div className="account-text">
                  <span className="account-name">{currentUser.name}</span>
                  <span className="account-email">{currentUser.email}</span>
                </div>
              </div>
              <div className="menu-sep" />
              <button className="menu-item" role="menuitem" onClick={handleLogout}>
                <LogoutIcon />
                Log out
              </button>
            </div>
          )}
        </div>
      </header>

      {/* ---------------- Body ---------------- */}
      <div className="app-body">
        {sidebarOpen && (
          <button
            className="sidebar-backdrop"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close navigation"
          />
        )}

        <aside className={`sidebar${sidebarOpen ? ' open' : ''}`}>
          {primaryProject && (
            <div className="project-block">
              <span
                className="project-icon"
                style={{ background: primaryProject.color }}
                aria-hidden="true"
              >
                {primaryProject.name.slice(0, 1).toUpperCase()}
              </span>
              <div className="project-block-text">
                <span className="project-block-name">{primaryProject.name}</span>
                <span className="project-block-sub">Software project</span>
              </div>
            </div>
          )}

          <div className="sidebar-scroll">
            <div className="nav-label">Issues</div>
            <nav className="nav">
              <button
                className={`nav-item${view === 'board' && filter === 'all' ? ' active' : ''}`}
                onClick={() => selectFilter('all')}
              >
                <BoardIcon />
                <span className="nav-text">Board</span>
              </button>
              <button
                className={`nav-item${view === 'board' && filter === 'mine' ? ' active' : ''}`}
                onClick={() => selectFilter('mine')}
              >
                <PersonIcon />
                <span className="nav-text">My tickets</span>
                <span className="nav-count">{myIssuesCount}</span>
              </button>
            </nav>

            <div className="nav-label">People</div>
            <nav className="nav">
              <Link
                href="/employees"
                className={`nav-item${view === 'employees' ? ' active' : ''}`}
                onClick={() => setSidebarOpen(false)}
              >
                <PeopleIcon />
                <span className="nav-text">Employees</span>
                {employeeCount != null && (
                  <span className="nav-count">{employeeCount}</span>
                )}
              </Link>
            </nav>

            <div className="nav-label">Projects</div>
            <nav className="nav">
              <Link
                href="/projects"
                className={`nav-item${view === 'projects' ? ' active' : ''}`}
                onClick={() => setSidebarOpen(false)}
              >
                <FolderIcon />
                <span className="nav-text">All projects</span>
                <span className="nav-count">{projects.length}</span>
              </Link>

              {projects.map((p) => (
                <button
                  key={p.id}
                  className={`nav-item${
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
                  <span className="nav-text">{p.name}</span>
                  <span className="nav-count">
                    {projectCounts?.[p.id] ?? p.open_count ?? 0}
                  </span>
                </button>
              ))}
            </nav>
          </div>

          <div className="sidebar-footer">
            <span className="dot-online" aria-hidden="true" />
            <span className="nav-text">All systems operational</span>
          </div>

          <button
            className="sidebar-collapse"
            onClick={() => setSidebarCollapsed(true)}
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
          >
            <SidebarIcon />
          </button>
        </aside>

        {children}
      </div>
    </div>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Avatar from './Avatar';
import WorkspaceModal from './WorkspaceModal';
import ProjectModal from './ProjectModal';

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
  const [workspaces, setWorkspaces] = useState([]);
  // Views that mount AppShell copy the projects prop into their own state, so a
  // router.refresh() after a create would not reach the sidebar. The sidebar
  // therefore keeps its own list and refetches it after a change.
  const [sidebarProjects, setSidebarProjects] = useState(projects);
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  // Holds the workspace a new project is being created in, or null. Projects
  // are created from inside a work space rather than from a section-wide
  // button, so a project always lands in an explicit home.
  const [creatingProjectIn, setCreatingProjectIn] = useState(null);
  const menuRef = useRef(null);
  const router = useRouter();

  const isAdmin = currentUser.role === 'admin';

  // The sidebar is the one place that groups projects by work space, and it
  // renders on every view, so it loads the list itself rather than adding a
  // workspaces prop to every page that mounts AppShell.
  async function loadWorkspaces() {
    try {
      const res = await fetch('/api/workspaces');
      if (!res.ok) return;
      const data = await res.json();
      setWorkspaces(data.workspaces || []);
    } catch {
      // A failed sidebar fetch should not take the page down; projects still
      // render under an empty work space list.
    }
  }

  useEffect(() => {
    loadWorkspaces();
  }, []);

  useEffect(() => {
    setSidebarProjects(projects);
  }, [projects]);

  async function loadSidebarProjects() {
    try {
      const res = await fetch('/api/projects');
      if (!res.ok) return;
      const data = await res.json();
      setSidebarProjects(data.projects || []);
    } catch {
      // Keep the sidebar on its last known list.
    }
  }
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

  function isNavActive(item) {
    if (item.id === 'people') return view === 'employees';
    if (item.id === 'projects') return view === 'projects';
    if (item.id === 'work') return view === 'dashboard' || (view === 'board' && filter === 'mine');
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
    onProjectChange?.(id);
  }

  const groupedIds = new Set(
    workspaces.map((w) => String(w.id))
  );

  // The developer dashboard already carries its own project and priority
  // filters, so the separate Filters link would only point back at the page the
  // reader is already on.
  const topNav = view === 'dashboard'
    ? TOP_NAV.filter((item) => item.id !== 'filters')
    : TOP_NAV;

  // Projects created before work spaces existed have no workspace_id, so they
  // stay listed directly under the section rather than disappearing.
  const ungrouped = sidebarProjects.filter(
    (p) => p.workspace_id == null || !groupedIds.has(String(p.workspace_id))
  );

  function renderProjectItem(p) {
    return (
      <button
        key={p.id}
        className={`nav-item${
          projectId != null && String(projectId) === String(p.id) ? ' active' : ''
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
    );
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
          {topNav.map((item) => (
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
                {topNav.map((item) => (
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
          <div className="sidebar-scroll">
            <div className="nav-label">Issues</div>
            <nav className="nav">
              <button
                className={`nav-item${view === 'dashboard' || (view === 'board' && filter === 'mine') ? ' active' : ''}`}
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

            <div className="nav-label nav-label-row">
              <span>Work spaces</span>
              <span className="nav-label-actions">
                {isAdmin && (
                  <button
                    className="nav-label-add"
                    onClick={() => setCreatingWorkspace(true)}
                    aria-label="Create work space"
                    title="Create work space"
                  >
                    <PlusIcon />
                  </button>
                )}
              </span>
            </div>
            <nav className="nav">
              <Link
                href="/projects"
                className={`nav-item${view === 'projects' ? ' active' : ''}`}
                onClick={() => setSidebarOpen(false)}
              >
                <FolderIcon />
                <span className="nav-text">All projects</span>
                <span className="nav-count">{sidebarProjects.length}</span>
              </Link>

              {workspaces.map((w) => {
                const members = sidebarProjects.filter(
                  (p) => String(p.workspace_id) === String(w.id)
                );
                return (
                  <div className="nav-workspace" key={w.id}>
                    <div className="nav-workspace-head" title={w.name}>
                      <span
                        className="workspace-dot"
                        style={{ background: w.color }}
                        aria-hidden="true"
                      />
                      <span className="nav-text">{w.name}</span>
                      <span className="nav-count">{members.length}</span>
                      {isAdmin && (
                        <button
                          className="nav-workspace-add"
                          onClick={() => setCreatingProjectIn(w.id)}
                          aria-label={`Create project in ${w.name}`}
                          title={`Create project in ${w.name}`}
                        >
                          <PlusIcon />
                        </button>
                      )}
                    </div>
                    {members.map(renderProjectItem)}
                  </div>
                );
              })}

              {ungrouped.map(renderProjectItem)}
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

        {creatingWorkspace && (
          <WorkspaceModal
            onClose={() => setCreatingWorkspace(false)}
            onSave={async () => {
              setCreatingWorkspace(false);
              await loadWorkspaces();
              router.refresh();
            }}
          />
        )}

        {creatingProjectIn != null && (
          <ProjectModal
            workspaces={workspaces}
            initialWorkspaceId={creatingProjectIn}
            onClose={() => setCreatingProjectIn(null)}
            onSave={async () => {
              setCreatingProjectIn(null);
              await loadSidebarProjects();
              await loadWorkspaces();
              router.refresh();
            }}
          />
        )}

        {children}
      </div>
    </div>
  );
}

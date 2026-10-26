'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BarChartIcon, ClipboardIcon } from './AppShellIcons';
import Avatar from './Avatar';
import WorkspaceModal from './WorkspaceModal';
import ProjectModal from './ProjectModal';
import ConfirmModal from './ConfirmModal';
import AnchoredMenu from './AnchoredMenu';
import { useInitialWorkspaces } from './WorkspacesProvider';
import { ticketKey } from './meta';
import ThemeToggle from './ThemeToggle';
import NotificationBell from './NotificationBell';

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

function MoreIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="19" cy="12" r="1.6" />
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

function InboxIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M3 4h18v12h-5l-1.5 2h-5L8 16H3V4Zm2 2v8h4.2l1.3 1.8h3l1.3-1.8H19V6H5Z" />
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
  { id: 'projects', label: 'Work Spaces', href: '/projects' },
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
  const [searchResults, setSearchResults] = useState([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const [searchActive, setSearchActive] = useState(0);
  const seededWorkspaces = useInitialWorkspaces();
  const [workspaces, setWorkspaces] = useState(seededWorkspaces);
  const [workspacesLoaded, setWorkspacesLoaded] = useState(false);
  // Views that mount AppShell copy the projects prop into their own state, so a
  // router.refresh() after a create would not reach the sidebar. The sidebar
  // therefore keeps its own list and refetches it after a change.
  const [sidebarProjects, setSidebarProjects] = useState(projects);
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  // Holds the workspace a new project is being created in, or null. Projects
  // are created from inside a work space rather than from a section-wide
  // button, so a project always lands in an explicit home.
  const [creatingProjectIn, setCreatingProjectIn] = useState(null);
  // The row whose actions menu is open, and the thing its Delete action is
  // asking about. One key for both menus because only one can be open at a
  // time, and it keeps the buttons from fighting over their own dropdowns.
  const [rowMenu, setRowMenu] = useState(null);
  // The open row's "..." button, kept per row so the portaled menu has an
  // element to measure against.
  const rowAnchors = useRef({});
  const [deleting, setDeleting] = useState(null);
  const [editingWorkspace, setEditingWorkspace] = useState(null);
  const [editingProject, setEditingProject] = useState(null);
  const [deleteError, setDeleteError] = useState('');
  const menuRef = useRef(null);
  const searchRef = useRef(null);
  const searchMenuRef = useRef(null);
  const router = useRouter();

  // Client requests waiting to be routed to somebody. Fetched by the sidebar
  // itself for the same reason the work spaces are: every view mounts AppShell
  // with its own copy of the props, so a refresh after an assign would not reach
  // the sidebar from above.
  const [clientRequests, setClientRequests] = useState([]);
  const [assignable, setAssignable] = useState([]);

  // An admin-created account is still on its temporary password. Every
  // authenticated page renders AppShell, so this is the one place that can hold
  // the whole app back until the password has been changed.
  const mustChangePassword = Boolean(currentUser.must_change_password);
  useEffect(() => {
    if (mustChangePassword) router.replace('/change-password');
  }, [mustChangePassword, router]);

  const isAdmin = currentUser.role === 'admin';
  // The sheet history reads everyone's day, so it used to be admin-only. It is
  // now shown to every developer as well; clients never reach this shell
  // because requireTeamUser sends them to their portal.
  const canReadSheets = isAdmin || currentUser.role === 'developer';
  const canAccessAdminDashboard = isAdmin || Boolean(currentUser?.can_access_admin_dashboard);
  const canAccessReports = isAdmin || currentUser.role === 'developer' || Boolean(currentUser?.can_access_reports);

  // The sidebar is the one place that groups projects by work space, and it
  // renders on every view, so it loads the list itself rather than adding a
  // workspaces prop to every page that mounts AppShell.
  async function loadWorkspaces() {
    try {
      const res = await fetch('/api/workspaces');
      if (!res.ok) return;
      const data = await res.json();
      setWorkspaces(data.workspaces || []);
      setWorkspacesLoaded(true);
    } catch {
      // A failed sidebar fetch should not take the page down; projects still
      // render under an empty work space list.
    }
  }

  useEffect(() => {
    if (seededWorkspaces.length > 0) setWorkspacesLoaded(true);
    loadWorkspaces();
    loadClientRequests();
  }, []);

  useEffect(() => {
    setSidebarProjects(projects);
  }, [projects]);

  async function loadClientRequests() {
    if (!isAdmin) return;
    try {
      const res = await fetch('/api/client-requests');
      if (!res.ok) return;
      const data = await res.json();
      setClientRequests(data.requests || []);
      setAssignable(data.assignable || []);
    } catch {
      // A failed queue fetch should not take the sidebar down with it.
    }
  }

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

  useEffect(() => {
    const q = navSearch.trim();
    if (!q) {
      setSearchResults([]);
      setSearchLoading(false);
      setSearchFailed(false);
      setSearchOpen(false);
      setSearchActive(0);
      return;
    }
    setSearchOpen(true);
    setSearchLoading(true);
    setSearchFailed(false);
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/tickets/search?q=${encodeURIComponent(q)}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`search failed: ${res.status}`);
        const data = await res.json();
        setSearchResults(data.tickets || []);
        setSearchActive(0);
        setSearchLoading(false);
      } catch (err) {
        if (err && err.name === 'AbortError') return;
        setSearchResults([]);
        setSearchActive(0);
        setSearchFailed(true);
        setSearchLoading(false);
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [navSearch]);

  useEffect(() => {
    if (!searchOpen) return;
    function onDocClick(e) {
      if (searchRef.current && !searchRef.current.contains(e.target)) setSearchOpen(false);
    }
    function onKey(e) {
      if (e.key === 'Escape') setSearchOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [searchOpen]);

  useEffect(() => {
    if (!searchOpen || !searchMenuRef.current) return;
    const active = searchMenuRef.current.querySelector('[aria-selected="true"]');
    if (active) active.scrollIntoView({ block: 'nearest' });
  }, [searchActive, searchOpen]);
  const topNavItems = useMemo(() => {
    return [
      isAdmin
        ? { id: 'admin-dashboard', label: 'Admin Dashboard', href: '/dashboard' }
        : { id: 'employee-dashboard', label: 'Dashboard', href: '/my-dashboard' },
      { id: 'work', label: 'Your work', href: '/?filter=mine' },
      { id: 'projects', label: 'Projects', href: '/projects' },
      { id: 'reports', label: 'Reports', href: '/reports' },
    ];
  }, [isAdmin]);

  function isNavActive(item) {
    if (item.id === 'admin-dashboard') return view === 'admin-dashboard';
    if (item.id === 'employee-dashboard') return view === 'employee-dashboard';
    if (item.id === 'projects') return view === 'projects';
    if (item.id === 'reports') return view === 'reports-hub' || view === 'section-reports' || view === 'report-detail';
    if (item.id === 'work') return view === 'dashboard' || (view === 'board' && filter === 'mine');
    return false;
  }

  function selectFilter(next) {
    setSidebarOpen(false);
    // "My tickets" is the two-section dashboard (Assigned to me / Assigned by
    // me) that a developer lands on. It is a page of its own, so it always
    // navigates rather than filtering whatever view is on screen.
    if (next === 'mine') {
      router.push('/?filter=mine');
      return;
    }
    onFilterChange?.(next);
  }

  function selectProject(id) {
    setSidebarOpen(false);
    router.push(`/projects/${id}/summary`);
  }

  function toggleRowMenu(key) {
    setRowMenu((current) => (current === key ? null : key));
  }

  /**
   * Deleting a workspace keeps its projects and a deleting project keeps its
   * tickets, so neither needs a second confirmation about what else goes with
   * it. What does have to be repainted is the sidebar: the workspace list comes
   * from the server and the project list is the sidebar's own copy.
   */
  async function handleDelete() {
    const target = deleting;
    setDeleteError('');
    try {
      const res = await fetch(`/api/${target.kind}s/${target.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Delete failed.');
      setDeleting(null);
      await Promise.all([loadWorkspaces(), loadSidebarProjects()]);
      // The view the reader is on may have been the thing that was deleted.
      if (projectId != null && String(projectId) === String(target.id)) {
        router.push('/projects');
      } else {
        router.refresh();
      }
    } catch (e) {
      setDeleting(null);
      setDeleteError(e.message);
    }
  }

  async function handleWorkspaceSave() {
    setEditingWorkspace(null);
    await loadWorkspaces();
    router.refresh();
  }

  async function handleProjectSave() {
    setEditingProject(null);
    await loadSidebarProjects();
    router.refresh();
  }

  const groupedIds = new Set(
    workspaces.map((w) => String(w.id))
  );

  // Projects created before work spaces existed have no workspace_id, so they
  // stay listed directly under the section rather than disappearing.
  const ungrouped = sidebarProjects.filter(
    (p) => p.workspace_id == null || !groupedIds.has(String(p.workspace_id))
  );

  function renderProjectItem(p) {
    const menuKey = `project:${p.id}`;
    const isActive =
      projectId != null && String(projectId) === String(p.id);
    return (
      <div className="nav-item-wrap" key={p.id}>
        <Link
          href={`/projects/${p.id}/summary`}
          className={`nav-item${isActive ? ' active' : ''}`}
          onClick={() => setSidebarOpen(false)}
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
        </Link>
        {isAdmin && (
          <div className="nav-row-actions">
            <button
              ref={(el) => {
                if (el) rowAnchors.current[menuKey] = el;
              }}
              className="nav-row-more"
              onClick={() => toggleRowMenu(menuKey)}
              aria-label={`Actions for ${p.name}`}
              aria-expanded={rowMenu === menuKey}
              title={`Actions for ${p.name}`}
            >
              <MoreIcon />
            </button>
            <AnchoredMenu
            open={rowMenu === menuKey}
            onClose={() => setRowMenu(null)}
            getAnchor={() => rowAnchors.current[menuKey]}
          >
            <button
              className="menu-item"
              role="menuitem"
              onClick={() => {
                setRowMenu(null);
                setEditingProject(p);
              }}
            >
              <span className="menu-item-text">Edit project</span>
            </button>
            <button
              className="menu-item menu-item-danger"
              role="menuitem"
              onClick={() => {
                setRowMenu(null);
                setDeleting({ kind: 'project', ...p });
              }}
            >
              <span className="menu-item-text">Delete project</span>
            </button>
          </AnchoredMenu>
          </div>
        )}
      </div>
    );
  }

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  }

  function openTicketFromSearch(ticket) {
    if (!ticket) return;
    setSearchOpen(false);
    setNavSearch('');
    setSearchResults([]);
    setSearchActive(0);
    const key = ticketKey(ticket);
    const dest = ticket.project_id
      ? `/projects/${ticket.project_id}/list?selectedIssue=${encodeURIComponent(key)}`
      : `/work-items?selectedIssue=${encodeURIComponent(key)}`;
    if (/^\/work-items$|^\/projects\/[^/]+\/list$/.test(window.location.pathname)) {
      window.location.assign(dest);
      return;
    }
    router.push(dest);
  }

  function handleNavSearch(e) {
    e.preventDefault();
    if (!searchOpen || searchLoading) return;
    openTicketFromSearch(searchResults[searchActive]);
  }

  function handleSearchKeyDown(e) {
    if (!searchOpen || searchResults.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSearchActive((i) => Math.min(i + 1, searchResults.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSearchActive((i) => Math.max(i - 1, 0));
    }
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
          {topNavItems.map((item) => (
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
                {topNavItems.map((item) => (
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

        <form className="topnav-search" onSubmit={handleNavSearch} role="search" ref={searchRef}>
          <SearchIcon />
          <input
            value={navSearch}
            onChange={(e) => setNavSearch(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            onFocus={() => {
              if (navSearch.trim()) setSearchOpen(true);
            }}
            placeholder="Search"
            aria-label="Search tickets"
            autoComplete="off"
          />
          {searchOpen && (
            <div
              className="menu-popup topnav-search-menu"
              role="listbox"
              aria-label="Ticket suggestions"
              ref={searchMenuRef}
            >
              {searchLoading && searchResults.length === 0 ? (
                <div className="topnav-search-note">Searching…</div>
              ) : searchFailed ? (
                <div className="topnav-search-note">Search is unavailable right now.</div>
              ) : searchResults.length === 0 ? (
                <div className="topnav-search-note">No matching tickets found</div>
              ) : (
                searchResults.map((ticket, index) => (
                  <button
                    type="button"
                    key={ticket.id}
                    className={`menu-item topnav-search-item${index === searchActive ? ' is-active' : ''}`}
                    role="option"
                    aria-selected={index === searchActive}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setSearchActive(index)}
                    onClick={() => openTicketFromSearch(ticket)}
                    title={`${ticketKey(ticket)} ${ticket.title}`}
                  >
                    <span className="topnav-search-key">{ticketKey(ticket)}</span>
                    <span className="menu-item-text">{ticket.title}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </form>

        <ThemeToggle />

        <NotificationBell currentUser={currentUser} />
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
            <Avatar name={currentUser.name} src={currentUser.avatar_url} assigned size={32} />
          </button>
          {menuOpen && (
            <div className="menu-popup account-menu" role="menu">
              <div className="account-head">
                <Avatar name={currentUser.name} src={currentUser.avatar_url} assigned size={32} />
                <div className="account-text">
                  <span className="account-name">{currentUser.name}</span>
                  <span className="account-email">{currentUser.email}</span>
                </div>
              </div>
              <div className="menu-sep" />
              <Link
                href="/profile"
                className="menu-item"
                role="menuitem"
                onClick={() => setMenuOpen(false)}
              >
                <PersonIcon />
                Profile
              </Link>
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
            <div className="nav-label">Reporting & Analytics</div>
            <nav className="nav">
              {canAccessAdminDashboard ? (
                <Link
                  href="/dashboard"
                  className={`nav-item${view === 'admin-dashboard' ? ' active' : ''}`}
                  onClick={() => setSidebarOpen(false)}
                >
                  <GridIcon />
                  <span className="nav-text">Admin Dashboard</span>
                </Link>
              ) : (
                <Link
                  href="/my-dashboard"
                  className={`nav-item${view === 'employee-dashboard' ? ' active' : ''}`}
                  onClick={() => setSidebarOpen(false)}
                >
                  <PersonIcon />
                  <span className="nav-text">My Dashboard</span>
                </Link>
              )}
              {canAccessReports && (
                <Link
                  href="/reports"
                  className={`nav-item${view === 'reports-hub' || view === 'section-reports' || view === 'report-detail' ? ' active' : ''}`}
                  onClick={() => setSidebarOpen(false)}
                >
                  <BarChartIcon />
                  <span className="nav-text">Reports Hub (76)</span>
                </Link>
              )}
            </nav>

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
              {/* A Link rather than a button that pushes the router: this is a
                  page of its own and belongs in the browser's history like the
                  rest of the sidebar. */}
              <Link
                href="/task-sheet"
                className={`nav-item${view === 'task-sheet' ? ' active' : ''}`}
                onClick={() => setSidebarOpen(false)}
              >
                <ClipboardIcon />
                <span className="nav-text">Task Sheet</span>
              </Link>
              {/* The task + happy sheet history is a page of its own too, open
                  to every developer so the whole team can read the day's work. */}
              {canReadSheets && (
                <Link
                  href="/task-sheet/history"
                  className={`nav-item${view === 'task-sheet-history' ? ' active' : ''}`}
                  onClick={() => setSidebarOpen(false)}
                >
                  <BarChartIcon />
                  <span className="nav-text">Sheet History</span>
                </Link>
              )}
              <Link
                href="/my-attendance"
                className={`nav-item${view === 'my-attendance' ? ' active' : ''}`}
                onClick={() => setSidebarOpen(false)}
              >
                <ClipboardIcon />
                <span className="nav-text">My Attendance</span>
              </Link>
              {isAdmin && (
                <Link
                  href="/attendance"
                  className={`nav-item${view === 'attendance-management' ? ' active' : ''}`}
                  onClick={() => setSidebarOpen(false)}
                >
                  <BarChartIcon />
                  <span className="nav-text">Attendance</span>
                </Link>
              )}
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

            {/* Always shown to an admin, empty or not. Hiding it until a
                request existed made the whole feature undiscoverable: with an
                empty queue there was no sign the page was there at all. */}
            {isAdmin && (
              <>
                <div className="nav-label">Client requests</div>
                <nav className="nav">
                  <Link
                    href="/client-requests"
                    className={`nav-item${view === 'client-requests' ? ' active' : ''}`}
                    onClick={() => setSidebarOpen(false)}
                  >
                    <InboxIcon />
                    <span className="nav-text">All client requests</span>
                    <span className="nav-count">{clientRequests.length}</span>
                  </Link>

                </nav>
              </>
            )}

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
              {workspacesLoaded && workspaces.map((w) => {
                const members = sidebarProjects.filter(
                  (p) => String(p.workspace_id) === String(w.id)
                );
                return (
                  <div className="nav-workspace" key={w.id}>
                    <div
                      className={`nav-workspace-head${isAdmin ? ' has-actions' : ''}`}
                      title={w.name}
                    >
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
                      {isAdmin && (
                        <div className="nav-row-actions">
                          <button
                            ref={(el) => {
                              if (el) rowAnchors.current[`workspace:${w.id}`] = el;
                            }}
                            className="nav-row-more"
                            onClick={() => toggleRowMenu(`workspace:${w.id}`)}
                            aria-label={`Actions for ${w.name}`}
                            aria-expanded={rowMenu === `workspace:${w.id}`}
                            title={`Actions for ${w.name}`}
                          >
                            <MoreIcon />
                          </button>
                          <AnchoredMenu
                            open={rowMenu === `workspace:${w.id}`}
                            onClose={() => setRowMenu(null)}
                            getAnchor={() => rowAnchors.current[`workspace:${w.id}`]}
                          >
                            <button
                              className="menu-item"
                              role="menuitem"
                              onClick={() => {
                                setRowMenu(null);
                                setEditingWorkspace(w);
                              }}
                            >
                              <span className="menu-item-text">Edit workspace</span>
                            </button>
                            <button
                              className="menu-item menu-item-danger"
                              role="menuitem"
                              onClick={() => {
                                setRowMenu(null);
                                setDeleting({ kind: 'workspace', ...w });
                              }}
                            >
                              <span className="menu-item-text">Delete workspace</span>
                            </button>
                          </AnchoredMenu>
                        </div>
                      )}
                    </div>
                    {members.map(renderProjectItem)}
                  </div>
                );
              })}

              {workspacesLoaded && ungrouped.map(renderProjectItem)}
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

        {editingWorkspace && (
          <WorkspaceModal
            workspace={editingWorkspace}
            onClose={() => setEditingWorkspace(null)}
            onSave={handleWorkspaceSave}
          />
        )}

        {editingProject && (
          <ProjectModal
            project={editingProject}
            workspaces={workspaces}
            onClose={() => setEditingProject(null)}
            onSave={handleProjectSave}
          />
        )}

        {deleting && (
          <ConfirmModal
            title={`Delete ${deleting.kind}`}
            message={
              deleting.kind === 'workspace'
                ? deleting.project_count > 0
                  ? `${deleting.name} has ${deleting.project_count} ${
                      deleting.project_count === 1 ? 'project' : 'projects'
                    }. ${
                      deleting.project_count === 1
                        ? 'It will be'
                        : 'They will be'
                    } kept and listed without a work space.`
                  : `${deleting.name} has no projects. This cannot be undone.`
                : deleting.ticket_count > 0
                  ? `${deleting.name} has ${deleting.ticket_count} ${
                      deleting.ticket_count === 1 ? 'ticket' : 'tickets'
                    }. ${
                      deleting.ticket_count === 1
                        ? 'It will be'
                        : 'They will be'
                    } kept but become unassigned from any project.`
                  : `${deleting.name} has no tickets. This cannot be undone.`
            }
            confirmLabel={`Delete ${deleting.kind}`}
            onCancel={() => setDeleting(null)}
            onConfirm={handleDelete}
          />
        )}

        {deleteError && (
          <div className="error-banner">
            <strong>Error:</strong> {deleteError}
            <button type="button" onClick={() => setDeleteError('')}>
              Dismiss
            </button>
          </div>
        )}

        {children}
      </div>
    </div>
  );
}

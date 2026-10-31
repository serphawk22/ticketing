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
import { useToasts, Toaster } from './Toaster';
import {
  SIDEBAR_SECTION_IDS,
  createDefaultSidebarPreferences,
  normalizeSidebarPreferences,
} from '@/lib/sidebarPreferences';

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

function GripIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
      <circle cx="9" cy="6" r="1.4" />
      <circle cx="15" cy="6" r="1.4" />
      <circle cx="9" cy="12" r="1.4" />
      <circle cx="15" cy="12" r="1.4" />
      <circle cx="9" cy="18" r="1.4" />
      <circle cx="15" cy="18" r="1.4" />
    </svg>
  );
}

export function StarIcon({ filled = false, size = 14 }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9Z" />
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
  { id: 'workspaces', label: 'Workspaces', href: '/projects' },
];

function sortWithFavorites(items, order, isFavorite) {
  const position = new Map(order.map((id, index) => [id, index]));
  return [...items].sort((a, b) => {
    const favoriteDiff = Number(isFavorite(b)) - Number(isFavorite(a));
    if (favoriteDiff) return favoriteDiff;
    const aIndex = position.has(a) ? position.get(a) : Number.MAX_SAFE_INTEGER;
    const bIndex = position.has(b) ? position.get(b) : Number.MAX_SAFE_INTEGER;
    return aIndex - bIndex;
  });
}

function orderSectionIds(prefs, isAdmin) {
  const visible = SIDEBAR_SECTION_IDS.filter(
    (id) => id !== 'client-requests' || isAdmin
  );
  return sortWithFavorites(
    visible,
    prefs.sectionOrder,
    (id) => prefs.sections[id]?.favorite
  );
}

function orderWorkspaceList(workspaces, prefs) {
  return sortWithFavorites(workspaces, prefs.workspaceOrder, () => false);
}

function orderProjectList(projectList, prefs) {
  return sortWithFavorites(
    projectList,
    prefs?.projectOrder || [],
    (p) => prefs?.projects?.[String(p.id)]?.favorite
  );
}

function moveListItem(list, source, target) {
  if (source === target) return list;
  const from = list.indexOf(source);
  const to = list.indexOf(target);
  if (from < 0 || to < 0) return list;
  const next = [...list];
  next.splice(from, 1);
  next.splice(to, 0, source);
  return next;
}

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
  const { toasts, push: pushToast, dismiss: dismissToast, pause: pauseToast, resume: resumeToast } = useToasts();
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
  const [sidebarPrefs, setSidebarPrefs] = useState(createDefaultSidebarPreferences);
  const [draggingSection, setDraggingSection] = useState(null);
  const [draggingWorkspace, setDraggingWorkspace] = useState(null);
  const prefsLoadedRef = useRef(false);
  const prefsSaveTimer = useRef(null);
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

  async function loadSidebarPreferences() {
    try {
      const res = await fetch('/api/user-preferences');
      if (res.ok) {
        const data = await res.json();
        setSidebarPrefs(normalizeSidebarPreferences(data.preferences));
      }
    } catch {
      // The defaults keep the sidebar usable when preferences cannot load.
    } finally {
      prefsLoadedRef.current = true;
    }
  }

  useEffect(() => {
    if (seededWorkspaces.length > 0) setWorkspacesLoaded(true);
    loadWorkspaces();
    loadSidebarPreferences();
    loadClientRequests();
  }, []);

  useEffect(() => {
    if (!prefsLoadedRef.current) return undefined;
    clearTimeout(prefsSaveTimer.current);
    prefsSaveTimer.current = setTimeout(() => {
      fetch('/api/user-preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: sidebarPrefs }),
      }).catch(() => {});
    }, 500);
    return () => clearTimeout(prefsSaveTimer.current);
  }, [sidebarPrefs]);

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
      { id: 'workspaces', label: 'Workspaces', href: '/projects' },
      { id: 'reports', label: 'Reports', href: '/reports' },
    ];
  }, [isAdmin]);

  function isNavActive(item) {
    if (item.id === 'admin-dashboard') return view === 'admin-dashboard';
    if (item.id === 'employee-dashboard') return view === 'employee-dashboard';
    if (item.id === 'workspaces') return view === 'projects';
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

  function toggleSectionFavorite(id) {
    setSidebarPrefs((prev) => ({
      ...prev,
      sections: {
        ...prev.sections,
        [id]: {
          ...prev.sections[id],
          favorite: !prev.sections[id]?.favorite,
        },
      },
    }));
  }

  function toggleSectionCollapsed(id) {
    setSidebarPrefs((prev) => ({
      ...prev,
      sections: {
        ...prev.sections,
        [id]: {
          ...prev.sections[id],
          collapsed: !prev.sections[id]?.collapsed,
        },
      },
    }));
  }

  function moveSection(id, delta) {
    setSidebarPrefs((prev) => {
      const order = orderSectionIds(prev, isAdmin);
      const index = order.indexOf(id);
      const target = order[index + delta];
      if (!target) return prev;
      return {
        ...prev,
        sectionOrder: moveListItem(order, id, target),
      };
    });
  }

  function dropSection(source, target) {
    if (!source || !target) return;
    setSidebarPrefs((prev) => ({
      ...prev,
      sectionOrder: moveListItem(
        orderSectionIds(prev, isAdmin),
        source,
        target
      ),
    }));
  }

  function workspacePref(id) {
    return sidebarPrefs.workspaces[String(id)] || {};
  }

  function updateWorkspacePref(id, key) {
    const keyId = String(id);
    setSidebarPrefs((prev) => ({
      ...prev,
      workspaces: {
        ...prev.workspaces,
        [keyId]: {
          ...prev.workspaces[keyId],
          [key]: !prev.workspaces[keyId]?.[key],
        },
      },
    }));
  }

  function projectPref(id) {
    return sidebarPrefs.projects?.[String(id)] || {};
  }

  function toggleProjectFavorite(id) {
    const keyId = String(id);
    setSidebarPrefs((prev) => ({
      ...prev,
      projects: {
        ...(prev.projects || {}),
        [keyId]: {
          ...prev.projects?.[keyId],
          favorite: !prev.projects?.[keyId]?.favorite,
        },
      },
    }));
  }

  function moveWorkspace(id, delta) {
    setSidebarPrefs((prev) => {
      const order = orderWorkspaceList(workspaces, prev).map((w) => String(w.id));
      const index = order.indexOf(String(id));
      const target = order[index + delta];
      if (!target) return prev;
      return {
        ...prev,
        workspaceOrder: moveListItem(order, String(id), target),
      };
    });
  }

  function dropWorkspace(source, target) {
    if (!source || !target) return;
    setSidebarPrefs((prev) => ({
      ...prev,
      workspaceOrder: moveListItem(
        orderWorkspaceList(workspaces, prev).map((w) => String(w.id)),
        String(source),
        String(target)
      ),
    }));
  }

  const groupedIds = new Set(
    workspaces.map((w) => String(w.id))
  );

  // Projects created before work spaces existed have no workspace_id, so they
  // stay listed directly under the section rather than disappearing.
  const ungrouped = sidebarProjects.filter(
    (p) => p.workspace_id == null || !groupedIds.has(String(p.workspace_id))
  );

  const orderedSections = orderSectionIds(sidebarPrefs, isAdmin);
  const orderedWorkspaces = orderWorkspaceList(workspaces, sidebarPrefs);

  const SECTION_LABELS = {
    reports: 'Reporting & Analytics',
    issues: 'Issues',
    people: 'People',
    'client-requests': 'Client requests',
    workspaces: 'Workspaces',
  };

  function renderProjectItem(p) {
    const menuKey = `project:${p.id}`;
    const isActive =
      projectId != null && String(projectId) === String(p.id);
    const pref = projectPref(p.id);
    const isFav = Boolean(pref.favorite);
    return (
      <div
        className={`nav-item-wrap${isFav ? ' is-favorite' : ''}${isAdmin ? ' has-actions' : ''}`}
        key={p.id}
      >
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
        <button
          type="button"
          className={`nav-favorite${isFav ? ' is-active' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            toggleProjectFavorite(p.id);
          }}
          aria-pressed={isFav}
          aria-label={`${isFav ? 'Unfavorite' : 'Favorite'} ${p.name}`}
          title={isFav ? 'Remove from favorites' : 'Add to favorites'}
        >
          <StarIcon filled={isFav} />
        </button>
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

  function renderSectionBody(id) {
    if (id === 'reports') {
      return (
        <>
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
        </>
      );
    }

    if (id === 'issues') {
      return (
        <>
          <button
            className={`nav-item${view === 'dashboard' || (view === 'board' && filter === 'mine') ? ' active' : ''}`}
            onClick={() => selectFilter('mine')}
          >
            <PersonIcon />
            <span className="nav-text">My tickets</span>
            <span className="nav-count">{myIssuesCount}</span>
          </button>
          <Link
            href="/task-sheet"
            className={`nav-item${view === 'task-sheet' ? ' active' : ''}`}
            onClick={() => setSidebarOpen(false)}
          >
            <ClipboardIcon />
            <span className="nav-text">Task Sheet</span>
          </Link>
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
        </>
      );
    }

    if (id === 'people') {
      return (
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
      );
    }

    if (id === 'client-requests') {
      return (
        <Link
          href="/client-requests"
          className={`nav-item${view === 'client-requests' ? ' active' : ''}`}
          onClick={() => setSidebarOpen(false)}
        >
          <InboxIcon />
          <span className="nav-text">All client requests</span>
          <span className="nav-count">{clientRequests.length}</span>
        </Link>
      );
    }

    if (id === 'workspaces') {
      return (
        <>
          {workspacesLoaded &&
            orderedWorkspaces.map((w) => {
              const members = sidebarProjects.filter(
                (p) => String(p.workspace_id) === String(w.id)
              );
              const prefs = workspacePref(w.id);
              return (
                <div
                  className="nav-workspace"
                  key={w.id}
                >
                  <div
                    className={`nav-workspace-head${isAdmin ? ' has-actions' : ''}`}
                    title={w.name}
                    onDragOver={(e) => {
                      if (draggingWorkspace != null) e.preventDefault();
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      dropWorkspace(draggingWorkspace, w.id);
                      setDraggingWorkspace(null);
                    }}
                  >
                    <span
                      className="nav-drag-handle"
                      draggable
                      role="button"
                      tabIndex={0}
                      aria-label={`Reorder ${w.name}`}
                      title="Drag to reorder. Alt+Arrow up or down to move."
                      onDragStart={(e) => {
                        setDraggingWorkspace(String(w.id));
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', String(w.id));
                      }}
                      onDragEnd={() => setDraggingWorkspace(null)}
                      onKeyDown={(e) => {
                        if (!e.altKey) return;
                        if (e.key === 'ArrowUp') {
                          e.preventDefault();
                          moveWorkspace(w.id, -1);
                        } else if (e.key === 'ArrowDown') {
                          e.preventDefault();
                          moveWorkspace(w.id, 1);
                        }
                      }}
                    >
                      <GripIcon />
                    </span>
                    <button
                      type="button"
                      className="nav-workspace-collapse"
                      onClick={() => updateWorkspacePref(w.id, 'collapsed')}
                      aria-expanded={!prefs.collapsed}
                    >
                      <ChevronDown />
                      <span
                        className="workspace-dot"
                        style={{ background: w.color }}
                        aria-hidden="true"
                      />
                      <span className="nav-text">{w.name}</span>
                      <span className="nav-count">{members.length}</span>
                    </button>
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
                  {!prefs.collapsed && orderProjectList(members, sidebarPrefs).map(renderProjectItem)}
                </div>
              );
            })}

          {workspacesLoaded && orderProjectList(ungrouped, sidebarPrefs).map(renderProjectItem)}
        </>
      );
    }

    return null;
  }

  function renderSidebarSection(id) {
    const prefs = sidebarPrefs.sections[id] || {};
    const collapsed = Boolean(prefs.collapsed);
    return (
      <section
        key={id}
        className={`nav-section${prefs.favorite ? ' is-favorite' : ''}`}
        onDragOver={(e) => {
          if (draggingSection) e.preventDefault();
        }}
        onDrop={(e) => {
          e.preventDefault();
          dropSection(draggingSection, id);
          setDraggingSection(null);
        }}
      >
        <div className="nav-label nav-label-row nav-section-head">
          <span
            className="nav-drag-handle"
            draggable
            role="button"
            tabIndex={0}
            aria-label={`Reorder ${SECTION_LABELS[id]}`}
            title="Drag to reorder. Alt+Arrow up or down to move."
            onDragStart={(e) => {
              setDraggingSection(id);
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', id);
            }}
            onDragEnd={() => setDraggingSection(null)}
            onKeyDown={(e) => {
              if (!e.altKey) return;
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                moveSection(id, -1);
              } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                moveSection(id, 1);
              }
            }}
          >
            <GripIcon />
          </span>
          <button
            type="button"
            className="nav-section-toggle"
            onClick={() => toggleSectionCollapsed(id)}
            aria-expanded={!collapsed}
          >
            <span
              className={`nav-section-chevron${collapsed ? ' is-collapsed' : ''}`}
            >
              <ChevronDown />
            </span>
            <span>{SECTION_LABELS[id]}</span>
          </button>
          <span className="nav-label-actions">
            <button
              type="button"
              className={`nav-favorite${prefs.favorite ? ' is-active' : ''}`}
              onClick={() => toggleSectionFavorite(id)}
              aria-pressed={Boolean(prefs.favorite)}
              aria-label={`${prefs.favorite ? 'Unfavorite' : 'Favorite'} ${SECTION_LABELS[id]}`}
              title={prefs.favorite ? 'Remove from favorites' : 'Add to favorites'}
            >
              <StarIcon filled={Boolean(prefs.favorite)} />
            </button>
            {id === 'workspaces' && isAdmin && (
              <button
                className="nav-label-add"
                onClick={() => setCreatingWorkspace(true)}
                aria-label="Create workspace"
                title="Create workspace"
              >
                <PlusIcon />
              </button>
            )}
          </span>
        </div>
        {!collapsed && <nav className="nav">{renderSectionBody(id)}</nav>}
      </section>
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
            {orderedSections.map(renderSidebarSection)}
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
            onWorkspaceCreated={async () => {
              await loadWorkspaces();
              await loadSidebarProjects();
            }}
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
                    } kept and listed without a workspace.`
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
      <Toaster toasts={toasts} onDismiss={dismissToast} onPause={pauseToast} onResume={resumeToast} />
    </div>
  );
}

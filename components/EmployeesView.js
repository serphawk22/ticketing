'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AppShell from '@/components/AppShell';
import AnchoredMenu from '@/components/AnchoredMenu';
import EmployeeModal from '@/components/EmployeeModal';
import { useToasts, Toaster } from '@/components/Toaster';
import ConfirmModal from '@/components/ConfirmModal';
import Avatar from '@/components/Avatar';
import { formatFullDateTime } from '@/components/meta';

const TABS = [
  { id: 'directory', label: 'Directory' },
  { id: 'notifications', label: 'Notifications' },
];

const COLUMNS = [
  { id: 'name', label: 'Employee' },
  { id: 'department', label: 'Department' },
  { id: 'role', label: 'Role' },
  { id: 'open_count', label: 'Open', num: true },
  { id: 'assigned_count', label: 'Assigned', num: true },
  { id: 'active', label: 'Status' },
];

function SortIcon({ dir }) {
  return (
    <svg
      className="th-sort-arrow"
      viewBox="0 0 16 16"
      width="10"
      height="10"
      fill="currentColor"
      aria-hidden="true"
      style={dir ? { opacity: 1 } : undefined}
    >
      <path
        d={dir === 'desc' ? 'M8 2 2 8h12L8 2Zm0 12 6-6H2l6 6Z' : 'M8 1.5 13 8H3l5-6.5ZM3 9.5h10L8 15 3 9.5Z'}
        fillRule="evenodd"
      />
    </svg>
  );
}

export default function EmployeesView({
  initialEmployees,
  initialOutbox,
  currentUser,
  myIssuesCount,
  smtpConfigured,
  projects = [],
}) {
  const [employees, setEmployees] = useState(initialEmployees);
  const [outbox, setOutbox] = useState(initialOutbox);
  const [tab, setTab] = useState('directory');
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [deptFilter, setDeptFilter] = useState('all');
  const [sortKey, setSortKey] = useState('name');
  const [sortDir, setSortDir] = useState('asc');
  const [openMenu, setOpenMenu] = useState(null);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [resending, setResending] = useState(null);
  const [error, setError] = useState('');
  // The open row's "..." button, kept per row so the portaled menu has an
  // element to measure against.
  const rowAnchors = useRef({});
  const router = useRouter();
  const { toasts, push, dismiss, pause, resume } = useToasts();

  const isAdmin = currentUser.role === 'admin';

  const openEmployee = useMemo(
    () => employees.find((e) => e.id === openMenu) || null,
    [employees, openMenu]
  );

  async function refresh() {
    const [employeesRes, outboxRes] = await Promise.all([
      fetch('/api/employees'),
      fetch('/api/outbox'),
    ]);
    const employeesData = await employeesRes.json();
    const outboxData = await outboxRes.json();
    if (employeesRes.ok) setEmployees(employeesData.employees);
    if (outboxRes.ok) setOutbox(outboxData.outbox);
  }

  async function handleSave(employee, invite) {
    setEditing(null);
    await refresh();
    announceSave(employee, invite);
  }

  async function toggleActive(employee) {
    setError('');
    setOpenMenu(null);
    try {
      const res = await fetch(`/api/employees/${employee.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !employee.active }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update employee.');
      await refresh();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleDelete() {
    const target = deleting;
    setError('');
    try {
      const res = await fetch(`/api/employees/${target.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        // Their tickets are unassigned rather than left pointing at a deleted
        // user, so say how many were touched instead of doing it silently.
        body: JSON.stringify({ reassign: 'unassign' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to remove employee.');

      setDeleting(null);
      await refresh();

      const unassigned = Number(data.unassigned || 0);
      push({
        message: unassigned
          ? `Removed ${target.name}. ${unassigned} ${
              unassigned === 1 ? 'ticket is' : 'tickets are'
            } now unassigned.`
          : `Removed ${target.name}.`,
      });
    } catch (e) {
      setDeleting(null);
      setError(e.message);
      push({ message: e.message, tone: 'error' });
    }
  }

  async function handleResend() {
    const target = resending;
    setError('');
    try {
      const res = await fetch(`/api/employees/${target.id}/resend`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not resend the invite.');

      setResending(null);
      await refresh();
      push({ message: `Invite resent to ${target.email} with a new temporary password.` });
    } catch (e) {
      setResending(null);
      setError(e.message);
      push({ message: e.message, tone: 'error' });
    }
  }

  /**
   * An invite that could not be delivered is not a silent no-op: the employee
   * exists but has never been told, so warn and point at the resend action.
   */
  function announceSave(employee, invite) {
    if (invite?.sent) {
      push({
        message: `${employee.name} was added and emailed a temporary password.`,
      });
      return;
    }
    push({
      message: `${employee.name} was added, but the invite email failed to send. Use "Resend invite" to try again.`,
      tone: 'error',
    });
  }

  const departments = useMemo(() => {
    const set = new Set();
    for (const e of employees) if (e.department) set.add(e.department);
    return Array.from(set).sort();
  }, [employees]);

  const visibleEmployees = useMemo(() => {
    const query = search.trim().toLowerCase();
    const list = employees.filter((e) => {
      if (!showInactive && !e.active) return false;
      if (roleFilter !== 'all' && e.role !== roleFilter) return false;
      if (statusFilter === 'active' && !e.active) return false;
      if (statusFilter === 'inactive' && e.active) return false;
      if (deptFilter !== 'all' && e.department !== deptFilter) return false;
      if (!query) return true;
      return (
        e.name.toLowerCase().includes(query) ||
        e.email.toLowerCase().includes(query) ||
        e.department.toLowerCase().includes(query) ||
        e.title.toLowerCase().includes(query)
      );
    });

    const dir = sortDir === 'asc' ? 1 : -1;
    return list.sort((a, b) => {
      let av = a[sortKey];
      let bv = b[sortKey];
      if (sortKey === 'active') {
        av = a.active ? 1 : 0;
        bv = b.active ? 1 : 0;
      }
      if (typeof av === 'string' || typeof bv === 'string') {
        return String(av || '').localeCompare(String(bv || '')) * dir;
      }
      return ((av ?? 0) - (bv ?? 0)) * dir;
    });
  }, [employees, search, showInactive, roleFilter, statusFilter, deptFilter, sortKey, sortDir]);

  const inactiveCount = employees.filter((e) => !e.active).length;
  const activeCount = employees.filter((e) => e.active).length;
  const hasFilters =
    Boolean(search.trim()) || roleFilter !== 'all' || statusFilter !== 'all' || deptFilter !== 'all';

  function clearFilters() {
    setSearch('');
    setRoleFilter('all');
    setStatusFilter('all');
    setDeptFilter('all');
  }

  function toggleSort(key) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  return (
    <AppShell
      currentUser={currentUser}
      projects={projects}
      projectCounts={null}
      employeeCount={activeCount}
      myIssuesCount={myIssuesCount}
      view="employees"
      filter="all"
      onFilterChange={() => router.push('/?filter=mine')}
      projectId="all"
      onProjectChange={(id) => router.push(`/?project=${id}`)}
      onCreate={isAdmin ? () => setEditing({ isNew: true }) : null}
    >
      <div className="board">
        {error && (
          <div className="error-banner">
            <strong>Error:</strong> {error}
            <button type="button" onClick={() => setError('')}>
              Dismiss
            </button>
          </div>
        )}

        <div className="board-toolbar">
          <div className="toolbar-title">
            <nav className="breadcrumb" aria-label="Breadcrumb">
              <Link href="/employees">People</Link>
              <span className="breadcrumb-sep" aria-hidden="true">
                /
              </span>
              <span>Employees</span>
            </nav>
            <h1>Employees</h1>
            <p className="board-subtitle">
              {employees.length} in the directory · {activeCount} active
            </p>
          </div>
        </div>

        <div className="tab-bar" role="tablist" aria-label="Employee views">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              className={`tab${tab === t.id ? ' active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
              {t.id === 'notifications' && outbox.length > 0 && (
                <span className="nav-count">{outbox.length}</span>
              )}
            </button>
          ))}
        </div>

        {tab === 'directory' ? (
          <>
            <div className="board-toolbar">
              <div className="toolbar-actions">
                <div className="search-field">
                  <svg
                    viewBox="0 0 24 24"
                    width="15"
                    height="15"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <circle cx="11" cy="11" r="7" />
                    <path d="M21 21l-4.35-4.35" />
                  </svg>
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search"
                    aria-label="Search employees"
                  />
                </div>

                <label className={`filter-btn${roleFilter !== 'all' ? ' active' : ''}`}>
                  <span className="filter-btn-label">Role</span>
                  <select
                    className="filter-select"
                    value={roleFilter}
                    onChange={(e) => setRoleFilter(e.target.value)}
                  >
                    <option value="all">All</option>
                    <option value="admin">Admin</option>
                    <option value="developer">Developer</option>
                  </select>
                </label>

                <label className={`filter-btn${statusFilter !== 'all' ? ' active' : ''}`}>
                  <span className="filter-btn-label">Status</span>
                  <select
                    className="filter-select"
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                  >
                    <option value="all">All</option>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </label>

                <label className={`filter-btn${deptFilter !== 'all' ? ' active' : ''}`}>
                  <span className="filter-btn-label">Department</span>
                  <select
                    className="filter-select"
                    value={deptFilter}
                    onChange={(e) => setDeptFilter(e.target.value)}
                  >
                    <option value="all">All</option>
                    {departments.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="toolbar-actions">
                {isAdmin && (
                  <button
                    className="btn-ghost"
                    onClick={() => setEditing({ isNew: true })}
                  >
                    Invite people
                  </button>
                )}
                {isAdmin && (
                  <button
                    className="btn-primary"
                    onClick={() => setEditing({ isNew: true })}
                  >
                    Add employee
                  </button>
                )}
              </div>
            </div>

            <div className="table-scroll">
              {visibleEmployees.length === 0 ? (
                <div className="projects-empty">
                  <span>
                    {hasFilters
                      ? 'No employees match your search'
                      : 'No employees yet.'}
                  </span>
                  {hasFilters && (
                    <button className="link-button" onClick={clearFilters}>
                      Clear filters
                    </button>
                  )}
                </div>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      {COLUMNS.map((c) => (
                        <th key={c.id} className={c.num ? 'num' : undefined} scope="col">
                          <button
                            className="th-sort"
                            onClick={() => toggleSort(c.id)}
                            aria-label={`Sort by ${c.label}`}
                          >
                            {c.label}
                            <SortIcon dir={sortKey === c.id ? sortDir : null} />
                          </button>
                        </th>
                      ))}
                      {isAdmin && (
                        <th className="actions-col" scope="col">
                          <span className="visually-hidden">Actions</span>
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleEmployees.map((e) => (
                      <tr key={e.id} className={e.active ? '' : 'row-inactive'}>
                        <td>
                          <div className="cell-person">
                            <Avatar name={e.name} assigned size={32} />
                            <div className="cell-person-text">
                              <span className="cell-person-name">{e.name}</span>
                              <span className="cell-person-meta">{e.email}</span>
                            </div>
                          </div>
                        </td>
                        <td>{e.department || '—'}</td>
                        <td>
                          <span className={`role-tag role-${e.role}`}>{e.role}</span>
                        </td>
                        <td className="num">{e.open_count}</td>
                        <td className="num">{e.assigned_count}</td>
                        <td>
                          <span
                            className={`pill ${
                              e.active ? 'pill-active' : 'pill-inactive'
                            }`}
                          >
                            {e.active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        {isAdmin && (
                          <td className="actions-col">
                            <button
                              type="button"
                              className="icon-btn row-menu-btn"
                              onClick={() => setOpenMenu((id) => (id === e.id ? null : e.id))}
                              aria-haspopup="true"
                              aria-expanded={openMenu === e.id}
                              aria-label={`Actions for ${e.name}`}
                              title="More actions"
                              ref={(el) => {
                                if (el) rowAnchors.current[e.id] = el;
                                else delete rowAnchors.current[e.id];
                              }}
                            >
                              <svg
                                viewBox="0 0 24 24"
                                width="16"
                                height="16"
                                fill="currentColor"
                                aria-hidden="true"
                              >
                                <circle cx="5" cy="12" r="2" />
                                <circle cx="12" cy="12" r="2" />
                                <circle cx="19" cy="12" r="2" />
                              </svg>
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {/* Rendered through the shared portal primitive: the menu is
                  positioned against the row button and flips upward near the
                  bottom of the window, which an absolutely positioned dropdown
                  inside this scrolling table could not do. */}
              {openMenu != null && openEmployee && (
                <AnchoredMenu
                  open={openMenu != null}
                  onClose={() => setOpenMenu(null)}
                  getAnchor={() => rowAnchors.current[openMenu]}
                >
                  <button
                    type="button"
                    className="menu-item"
                    role="menuitem"
                    onClick={() => {
                      setOpenMenu(null);
                      setEditing(openEmployee);
                    }}
                  >
                    Edit details
                  </button>
                  <button
                    type="button"
                    className="menu-item"
                    role="menuitem"
                    onClick={() => {
                      setResending(openEmployee);
                      setOpenMenu(null);
                    }}
                  >
                    Resend invite
                  </button>
                  <button
                    type="button"
                    className="menu-item"
                    role="menuitem"
                    onClick={() => toggleActive(openEmployee)}
                  >
                    {openEmployee.active ? 'Deactivate' : 'Reactivate'}
                  </button>
                  <div className="menu-sep" />
                  <button
                    type="button"
                    className="menu-item menu-item-danger"
                    role="menuitem"
                    onClick={() => {
                      setOpenMenu(null);
                      setDeleting(openEmployee);
                    }}
                  >
                    Remove employee
                  </button>
                </AnchoredMenu>
              )}

              {inactiveCount > 0 && (
                <label className="show-inactive">
                  <input
                    type="checkbox"
                    checked={showInactive}
                    onChange={(e) => setShowInactive(e.target.checked)}
                  />
                  Show {inactiveCount} inactive{' '}
                  {inactiveCount === 1 ? 'employee' : 'employees'}
                </label>
              )}
            </div>
          </>
        ) : (
          <div className="table-scroll">
            <div className={`smtp-banner${smtpConfigured ? ' smtp-on' : ''}`}>
              {smtpConfigured
                ? 'SMTP is configured. Notifications are delivered and logged below.'
                : 'SMTP is not configured. Notifications are captured in this outbox instead of being sent. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and SMTP_FROM to enable delivery.'}
            </div>

            {outbox.length === 0 ? (
              <div className="projects-empty">No notifications sent yet.</div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Sent</th>
                    <th>Recipient</th>
                    <th>Subject</th>
                    <th>Trigger</th>
                    <th>Delivery</th>
                  </tr>
                </thead>
                <tbody>
                  {outbox.map((m) => (
                    <tr key={m.id}>
                      <td className="nowrap">{formatFullDateTime(m.created_at)}</td>
                      <td>
                        <div className="cell-person-text">
                          <span className="cell-person-name">{m.to_name}</span>
                          <span className="cell-person-meta">{m.to_email}</span>
                        </div>
                      </td>
                      <td>
                        <span className="outbox-subject">{m.subject}</span>
                      </td>
                      <td>{m.trigger}</td>
                      <td>
                        <span className={`pill pill-${m.status}`}>{m.status}</span>
                        {m.error && <span className="outbox-error">{m.error}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {editing && (
        <EmployeeModal
          employee={editing.isNew ? null : editing}
          onClose={() => setEditing(null)}
          onSave={handleSave}
        />
      )}

      {deleting && (
        <ConfirmModal
          title="Remove employee"
          message={
            deleting.assigned_count > 0
              ? `Remove ${deleting.name} from the directory? They will lose access to this workspace. ${
                  deleting.assigned_count
                } ${
                  deleting.assigned_count === 1 ? 'ticket' : 'tickets'
                } assigned to them will become unassigned. This cannot be undone.`
              : `Remove ${deleting.name} from the directory? They will lose access to this workspace. This cannot be undone.`
          }
          confirmLabel="Remove"
          onCancel={() => setDeleting(null)}
          onConfirm={handleDelete}
        />
      )}

      {resending && (
        <ConfirmModal
          title="Resend invite"
          message={`Email ${resending.name} a new invite? A fresh temporary password will be generated and any previous one will stop working.`}
          confirmLabel="Resend invite"
          onCancel={() => setResending(null)}
          onConfirm={handleResend}
        />
      )}

      <Toaster toasts={toasts} onDismiss={dismiss} onPause={pause} onResume={resume} />
    </AppShell>
  );
}

'use client';

import { useEffect, useState } from 'react';

const ROLES = [
  { value: 'developer', label: 'Developer' },
  { value: 'admin', label: 'Admin' },
  // Clients sign in to their own portal to raise requests. They are listed here
  // so an admin has one directory to manage accounts from, but they are not
  // assignable work.
  { value: 'client', label: 'Client' },
];

export default function EmployeeModal({ employee, onClose, onSave }) {
  const isEdit = Boolean(employee);
  const [name, setName] = useState(employee?.name || '');
  const [email, setEmail] = useState(employee?.email || '');
  const [role, setRole] = useState(employee?.role || 'developer');
  const [department, setDepartment] = useState(employee?.department || '');
  // A new employee is always created active; editing lets an admin correct the
  // status from here as well as from the row menu.
  const [active, setActive] = useState(employee ? Boolean(employee.active) : true);
  const [title, setTitle] = useState(employee?.title || '');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      const res = await fetch(
        isEdit ? `/api/employees/${employee.id}` : '/api/employees',
        {
          method: isEdit ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, email, role, department, title, active }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save employee.');
      // The invite result rides along so the caller can warn when the email
      // did not go out, rather than the add looking like a clean success.
      onSave(data.employee, data.invite);
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? 'Edit employee' : 'Add employee'}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header>
          <h3>
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
            {isEdit ? 'Edit employee' : 'Add employee'}
          </h3>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="employee-name">Full name</label>
            <input
              id="employee-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Priya Raman"
              required
              autoFocus
            />
          </div>

          <div className="form-group">
            <label htmlFor="employee-email">Email</label>
            <input
              id="employee-email"
              type="text"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="priya@example.com"
              required
            />
            <span className="field-hint">
              Assignment notifications are delivered to this address.
            </span>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="employee-department">Department</label>
              <input
                id="employee-department"
                type="text"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                placeholder="Platform"
              />
            </div>

            <div className="form-group">
              <label htmlFor="employee-title">Job title</label>
              <input
                id="employee-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Senior Engineer"
              />
            </div>

            <div className="form-group form-group-narrow">
              <label htmlFor="employee-role">Role</label>
              <select
                id="employee-role"
                value={role}
                onChange={(e) => setRole(e.target.value)}
              >
                {ROLES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>

            {isEdit && (
              <div className="form-group form-group-narrow">
                <label htmlFor="employee-active">Status</label>
                <select
                  id="employee-active"
                  value={active ? 'active' : 'inactive'}
                  onChange={(e) => setActive(e.target.value === 'active')}
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
            )}
          </div>

          {error && <div className="error-text">{error}</div>}

          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Add employee'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

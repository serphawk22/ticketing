'use client';

import { useEffect, useState } from 'react';
import Avatar from './Avatar';
import { CURRENCIES, getCurrencySymbol } from '@/lib/currency';

const ROLES = [
  { value: 'developer', label: 'Developer' },
  { value: 'admin', label: 'Admin' },
  // Clients sign in to their own portal to raise requests. They are listed here
  // so an admin has one directory to manage accounts from, but they are not
  // assignable work.
  { value: 'client', label: 'Client' },
];

const PAYMENT_STATUS_OPTIONS = [
  { value: '', label: 'Not set' },
  { value: 'paid', label: 'Paid' },
  { value: 'pending', label: 'Pending' },
  { value: 'processing', label: 'Processing' },
  { value: 'unpaid', label: 'Unpaid' },
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

  // Employment & Compensation fields (managed by administrators)
  const [baseSalary, setBaseSalary] = useState(
    employee?.base_salary !== null && employee?.base_salary !== undefined
      ? String(employee.base_salary)
      : ''
  );
  const [salaryCurrency, setSalaryCurrency] = useState(
    employee?.salary_currency || 'USD'
  );
  const [lastPaymentDate, setLastPaymentDate] = useState(
    employee?.last_payment_date || ''
  );
  const [paymentStatus, setPaymentStatus] = useState(
    employee?.payment_status || ''
  );

  // Profile metadata for view in modal
  const [profileMeta, setProfileMeta] = useState(null);

  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Load extended profile details if editing
  useEffect(() => {
    if (!employee?.id) return;
    let activeEffect = true;
    fetch(`/api/employees/${employee.id}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (activeEffect && data?.employee) {
          setProfileMeta(data.employee);
          if (data.employee.base_salary !== null && data.employee.base_salary !== undefined) {
            setBaseSalary(String(data.employee.base_salary));
          }
          if (data.employee.salary_currency) {
            setSalaryCurrency(data.employee.salary_currency);
          }
          if (data.employee.last_payment_date) {
            setLastPaymentDate(data.employee.last_payment_date);
          }
          if (data.employee.payment_status) {
            setPaymentStatus(data.employee.payment_status);
          }
        }
      })
      .catch(() => {});
    return () => {
      activeEffect = false;
    };
  }, [employee?.id]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (baseSalary && (Number.isNaN(Number(baseSalary)) || Number(baseSalary) < 0)) {
      setError('Base salary must be a positive number.');
      return;
    }

    setSubmitting(true);

    try {
      const res = await fetch(
        isEdit ? `/api/employees/${employee.id}` : '/api/employees',
        {
          method: isEdit ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            email,
            role,
            department,
            title,
            active,
            base_salary: baseSalary.trim() === '' ? null : Number(baseSalary),
            salary_currency: salaryCurrency || 'USD',
            last_payment_date: lastPaymentDate || null,
            payment_status: paymentStatus || '',
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save employee.');
      // The invite result rides along so the caller can warn when the email
      // did not go out, rather than the add looking like a clean success. A
      // client's passkey is echoed back only when the mail failed -- on a
      // successful send the plaintext is never handed to the UI.
      onSave(data.employee, data.invite, data.passkey);
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div
        className="modal"
        style={{ maxWidth: 560 }}
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
          {isEdit && profileMeta && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '10px 14px',
                background: 'var(--bg-surface)',
                borderRadius: 'var(--radius)',
                marginBottom: 16,
                border: '1px solid var(--border)',
              }}
            >
              <Avatar
                name={employee.name}
                src={profileMeta.avatar_url}
                assigned
                size={36}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{employee.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>
                  Joined: {profileMeta.joined_at ? String(profileMeta.joined_at).slice(0, 10) : '—'}
                  {profileMeta.age ? ` · Age: ${profileMeta.age}` : ''}
                </div>
              </div>
              {profileMeta.github_url && (
                <a
                  href={profileMeta.github_url}
                  target="_blank"
                  rel="noreferrer"
                  className="link-button"
                  style={{ fontSize: 12 }}
                >
                  GitHub
                </a>
              )}
              {profileMeta.linkedin_url && (
                <a
                  href={profileMeta.linkedin_url}
                  target="_blank"
                  rel="noreferrer"
                  className="link-button"
                  style={{ fontSize: 12 }}
                >
                  LinkedIn
                </a>
              )}
            </div>
          )}

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
          </div>

          <div className="form-row">
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

          {/* Administrator Compensation Management */}
          <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12, color: 'var(--text)' }}>
              Compensation & Payment (Admin Controls)
            </div>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="employee-salary-currency">Currency</label>
                <select
                  id="employee-salary-currency"
                  value={salaryCurrency}
                  onChange={(e) => setSalaryCurrency(e.target.value)}
                >
                  {CURRENCIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="employee-salary">
                  Base Salary ({getCurrencySymbol(salaryCurrency)})
                </label>
                <input
                  id="employee-salary"
                  type="number"
                  min="0"
                  step="0.01"
                  value={baseSalary}
                  onChange={(e) => setBaseSalary(e.target.value)}
                  placeholder={salaryCurrency === 'INR' ? 'e.g. 600000' : 'e.g. 75000'}
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="employee-payment-status">Payment Status</label>
                <select
                  id="employee-payment-status"
                  value={paymentStatus}
                  onChange={(e) => setPaymentStatus(e.target.value)}
                >
                  {PAYMENT_STATUS_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="employee-payment-date">Last Payment Date</label>
                <input
                  id="employee-payment-date"
                  type="date"
                  value={lastPaymentDate}
                  onChange={(e) => setLastPaymentDate(e.target.value)}
                />
              </div>
            </div>
          </div>

          {error && <div className="error-text" style={{ marginTop: 12 }}>{error}</div>}

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

'use client';

import { useEffect, useState } from 'react';
import Avatar from './Avatar';
import EmployeeDocumentsTab from './EmployeeDocumentsTab';
import { CURRENCIES, getCurrencySymbol } from '@/lib/currency';

const ROLES = [
  { value: 'developer', label: 'Developer' },
  { value: 'admin', label: 'Admin' },
  { value: 'client', label: 'Client' },
];

const PAYMENT_STATUS_OPTIONS = [
  { value: '', label: 'Not set' },
  { value: 'paid', label: 'Paid' },
  { value: 'pending', label: 'Pending' },
  { value: 'processing', label: 'Processing' },
  { value: 'unpaid', label: 'Unpaid' },
];

const EMPLOYMENT_STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'probation', label: 'Probation' },
  { value: 'on_leave', label: 'On Leave' },
  { value: 'notice_period', label: 'Notice Period' },
  { value: 'resigned', label: 'Resigned' },
  { value: 'terminated', label: 'Terminated' },
];

const GENDER_OPTIONS = [
  { value: '', label: 'Select Gender' },
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'other', label: 'Other / Prefer not to say' },
];

const BLOOD_GROUP_OPTIONS = [
  { value: '', label: 'Select Blood Group' },
  { value: 'A+', label: 'A+' },
  { value: 'A-', label: 'A-' },
  { value: 'B+', label: 'B+' },
  { value: 'B-', label: 'B-' },
  { value: 'AB+', label: 'AB+' },
  { value: 'AB-', label: 'AB-' },
  { value: 'O+', label: 'O+' },
  { value: 'O-', label: 'O-' },
];

export default function EmployeeModal({ employee, onClose, onSave }) {
  const isEdit = Boolean(employee);
  const [activeTab, setActiveTab] = useState('personal');

  // General & Personal
  const [name, setName] = useState(employee?.name || '');
  const [email, setEmail] = useState(employee?.email || '');
  const [secondaryEmail, setSecondaryEmail] = useState(employee?.secondary_email || '');
  const [role, setRole] = useState(employee?.role || 'developer');
  const [phone, setPhone] = useState(employee?.phone || '');
  const [dob, setDob] = useState(employee?.dob || '');
  const [gender, setGender] = useState(employee?.gender || '');
  const [bloodGroup, setBloodGroup] = useState(employee?.blood_group || '');

  // Organization & Reporting
  const [departmentId, setDepartmentId] = useState(employee?.department_id ? String(employee.department_id) : '');
  const [designationId, setDesignationId] = useState(employee?.designation_id ? String(employee.designation_id) : '');
  const [reportingManagerId, setReportingManagerId] = useState(employee?.reporting_manager_id ? String(employee.reporting_manager_id) : '');
  const [department, setDepartment] = useState(employee?.department || '');
  const [title, setTitle] = useState(employee?.title || '');
  const [employmentType, setEmploymentType] = useState(employee?.employment_type || 'full_time');
  const [employmentStatus, setEmploymentStatus] = useState(employee?.employment_status || 'active');
  const [joiningDate, setJoiningDate] = useState(employee?.joining_date || '');
  const [active, setActive] = useState(employee ? Boolean(employee.active) : true);

  // Address & Emergency
  const [currentAddress, setCurrentAddress] = useState(employee?.current_address || '');
  const [permanentAddress, setPermanentAddress] = useState(employee?.permanent_address || '');
  const [emergencyContactName, setEmergencyContactName] = useState(employee?.emergency_contact_name || '');
  const [emergencyContactRelation, setEmergencyContactRelation] = useState(employee?.emergency_contact_relation || '');
  const [emergencyContactPhone, setEmergencyContactPhone] = useState(employee?.emergency_contact_phone || '');

  // Compensation
  const [baseSalary, setBaseSalary] = useState(
    employee?.base_salary !== null && employee?.base_salary !== undefined
      ? String(employee.base_salary)
      : ''
  );
  const [salaryCurrency, setSalaryCurrency] = useState(employee?.salary_currency || 'USD');
  const [lastPaymentDate, setLastPaymentDate] = useState(employee?.last_payment_date || '');
  const [paymentStatus, setPaymentStatus] = useState(employee?.payment_status || '');

  // Remote data
  const [profileMeta, setProfileMeta] = useState(null);
  const [departmentsList, setDepartmentsList] = useState([]);
  const [designationsList, setDesignationsList] = useState([]);
  const [managersList, setManagersList] = useState([]);

  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Load departments, designations, and eligible managers
  useEffect(() => {
    let isMounted = true;
    Promise.all([
      fetch('/api/departments').then((r) => (r.ok ? r.json() : null)),
      fetch('/api/designations').then((r) => (r.ok ? r.json() : null)),
      fetch('/api/employees').then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([deptData, desigData, empData]) => {
        if (!isMounted) return;
        if (deptData?.departments) setDepartmentsList(deptData.departments);
        if (desigData?.designations) setDesignationsList(desigData.designations);
        if (empData?.employees) {
          // Filter out current employee to prevent selecting self
          const eligibleManagers = empData.employees.filter((emp) => !employee?.id || emp.id !== employee.id);
          setManagersList(eligibleManagers);
        }
      })
      .catch((err) => console.error('[EmployeeModal] lookup fetch error:', err));

    return () => {
      isMounted = false;
    };
  }, [employee?.id]);

  // Load extended profile details if editing
  useEffect(() => {
    if (!employee?.id) return;
    let activeEffect = true;
    fetch(`/api/employees/${employee.id}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (activeEffect && data?.employee) {
          const emp = data.employee;
          setProfileMeta(emp);
          if (emp.secondary_email !== undefined) setSecondaryEmail(emp.secondary_email || '');
          if (emp.base_salary !== null && emp.base_salary !== undefined) setBaseSalary(String(emp.base_salary));
          if (emp.salary_currency) setSalaryCurrency(emp.salary_currency);
          if (emp.last_payment_date) setLastPaymentDate(emp.last_payment_date);
          if (emp.payment_status) setPaymentStatus(emp.payment_status);
          if (emp.employment_type) setEmploymentType(emp.employment_type);
          if (emp.employment_status) setEmploymentStatus(emp.employment_status);
          if (emp.department_id) setDepartmentId(String(emp.department_id));
          if (emp.designation_id) setDesignationId(String(emp.designation_id));
          if (emp.reporting_manager_id) setReportingManagerId(String(emp.reporting_manager_id));
          if (emp.phone) setPhone(emp.phone);
          if (emp.dob) setDob(emp.dob);
          if (emp.gender) setGender(emp.gender);
          if (emp.blood_group) setBloodGroup(emp.blood_group);
          if (emp.current_address) setCurrentAddress(emp.current_address);
          if (emp.permanent_address) setPermanentAddress(emp.permanent_address);
          if (emp.emergency_contact_name) setEmergencyContactName(emp.emergency_contact_name);
          if (emp.emergency_contact_relation) setEmergencyContactRelation(emp.emergency_contact_relation);
          if (emp.emergency_contact_phone) setEmergencyContactPhone(emp.emergency_contact_phone);
          if (emp.joining_date) setJoiningDate(emp.joining_date);
        }
      })
      .catch(() => {});
    return () => {
      activeEffect = false;
    };
  }, [employee?.id]);

  const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    const isClient = role === 'client';
    const cleanEmail = email.trim();
    const cleanSecondary = secondaryEmail.trim();

    if (!cleanEmail) {
      setError(isClient ? 'Primary email is required.' : 'Email is required.');
      return;
    }

    if (!EMAIL_PATTERN.test(cleanEmail)) {
      setError('A valid email address is required.');
      return;
    }

    if (isClient && cleanSecondary && !EMAIL_PATTERN.test(cleanSecondary)) {
      setError('A valid secondary email address is required.');
      return;
    }

    if (isClient && cleanEmail && cleanSecondary && cleanEmail.toLowerCase() === cleanSecondary.toLowerCase()) {
      setError('Secondary email must be different from primary email.');
      return;
    }

    if (!isClient && baseSalary && (Number.isNaN(Number(baseSalary)) || Number(baseSalary) < 0)) {
      setError('Base salary must be a positive number.');
      return;
    }

    setSubmitting(true);

    try {
      const payload = {
        name: name.trim(),
        email: cleanEmail || null,
        secondary_email: isClient ? (cleanSecondary || null) : null,
        role,
        department: isClient ? '' : department.trim(),
        title: isClient ? '' : title.trim(),
        active,
        base_salary: isClient ? null : (baseSalary.trim() === '' ? null : Number(baseSalary)),
        salary_currency: isClient ? 'USD' : (salaryCurrency || 'USD'),
        last_payment_date: isClient ? null : (lastPaymentDate || null),
        payment_status: isClient ? '' : (paymentStatus || ''),
        employment_type: isClient ? 'full_time' : employmentType,
        employment_status: isClient ? 'active' : employmentStatus,
        department_id: isClient ? null : (departmentId ? Number(departmentId) : null),
        designation_id: isClient ? null : (designationId ? Number(designationId) : null),
        reporting_manager_id: isClient ? null : (reportingManagerId ? Number(reportingManagerId) : null),
        phone: phone.trim(),
        dob: dob || null,
        gender,
        blood_group: bloodGroup,
        current_address: currentAddress.trim(),
        permanent_address: permanentAddress.trim(),
        emergency_contact_name: emergencyContactName.trim(),
        emergency_contact_relation: emergencyContactRelation.trim(),
        emergency_contact_phone: emergencyContactPhone.trim(),
        joining_date: joiningDate || null,
      };

      const res = await fetch(
        isEdit ? `/api/employees/${employee.id}` : '/api/employees',
        {
          method: isEdit ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save employee.');
      onSave(data.employee, data.invite, data.passkey);
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  // Filter designations by selected department if selected
  const availableDesignations = departmentId
    ? designationsList.filter((d) => String(d.department_id) === String(departmentId))
    : designationsList;

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div
        className="modal"
        style={{ maxWidth: 640 }}
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
            {isEdit ? 'Edit Employee Profile' : 'Add New Employee'}
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

        {isEdit && profileMeta && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '10px 14px',
              background: 'var(--bg-surface)',
              borderRadius: 'var(--radius)',
              margin: '0 0 12px 0',
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
                Status:{' '}
                <span
                  style={{
                    textTransform: 'capitalize',
                    fontWeight: 500,
                    color: profileMeta.active ? 'var(--success, #2e7d32)' : 'var(--danger, #c62828)',
                  }}
                >
                  {profileMeta.employment_status || (profileMeta.active ? 'Active' : 'Inactive')}
                </span>
                {profileMeta.department_name ? ` · Dept: ${profileMeta.department_name}` : ''}
                {profileMeta.reporting_manager_name ? ` · Manager: ${profileMeta.reporting_manager_name}` : ''}
              </div>
            </div>
          </div>
        )}

        {/* Tab navigation inside modal */}
        <div
          style={{
            display: 'flex',
            gap: 8,
            borderBottom: '1px solid var(--border)',
            marginBottom: 16,
            paddingBottom: 4,
          }}
        >
          <button
            type="button"
            className={`tab-button${activeTab === 'personal' ? ' active' : ''}`}
            onClick={() => setActiveTab('personal')}
            style={{
              padding: '6px 12px',
              fontSize: 13,
              fontWeight: 500,
              background: activeTab === 'personal' ? 'var(--bg-hover)' : 'transparent',
              border: 'none',
              borderRadius: 'var(--radius)',
              cursor: 'pointer',
              color: activeTab === 'personal' ? 'var(--primary)' : 'var(--text-subtle)',
            }}
          >
            Personal Info
          </button>
          {role !== 'client' && (
            <>
              <button
                type="button"
                className={`tab-button${activeTab === 'organization' ? ' active' : ''}`}
                onClick={() => setActiveTab('organization')}
                style={{
                  padding: '6px 12px',
                  fontSize: 13,
                  fontWeight: 500,
                  background: activeTab === 'organization' ? 'var(--bg-hover)' : 'transparent',
                  border: 'none',
                  borderRadius: 'var(--radius)',
                  cursor: 'pointer',
                  color: activeTab === 'organization' ? 'var(--primary)' : 'var(--text-subtle)',
                }}
              >
                Organization & Roles
              </button>
              <button
                type="button"
                className={`tab-button${activeTab === 'address' ? ' active' : ''}`}
                onClick={() => setActiveTab('address')}
                style={{
                  padding: '6px 12px',
                  fontSize: 13,
                  fontWeight: 500,
                  background: activeTab === 'address' ? 'var(--bg-hover)' : 'transparent',
                  border: 'none',
                  borderRadius: 'var(--radius)',
                  cursor: 'pointer',
                  color: activeTab === 'address' ? 'var(--primary)' : 'var(--text-subtle)',
                }}
              >
                Address & Emergency
              </button>
              <button
                type="button"
                className={`tab-button${activeTab === 'compensation' ? ' active' : ''}`}
                onClick={() => setActiveTab('compensation')}
                style={{
                  padding: '6px 12px',
                  fontSize: 13,
                  fontWeight: 500,
                  background: activeTab === 'compensation' ? 'var(--bg-hover)' : 'transparent',
                  border: 'none',
                  borderRadius: 'var(--radius)',
                  cursor: 'pointer',
                  color: activeTab === 'compensation' ? 'var(--primary)' : 'var(--text-subtle)',
                }}
              >
                Compensation
              </button>
              {isEdit && (
                <button
                  type="button"
                  className={`tab-button${activeTab === 'documents' ? ' active' : ''}`}
                  onClick={() => setActiveTab('documents')}
                  style={{
                    padding: '6px 12px',
                    fontSize: 13,
                    fontWeight: 500,
                    background: activeTab === 'documents' ? 'var(--bg-hover)' : 'transparent',
                    border: 'none',
                    borderRadius: 'var(--radius)',
                    cursor: 'pointer',
                    color: activeTab === 'documents' ? 'var(--primary)' : 'var(--text-subtle)',
                  }}
                >
                  Documents
                </button>
              )}
            </>
          )}
        </div>

        <form onSubmit={handleSubmit}>
          {/* TAB 1: PERSONAL INFO */}
          {activeTab === 'personal' && (
            <>
              <div className="form-group">
                <label htmlFor="employee-name">Full name <span style={{ color: 'var(--danger)' }}>*</span></label>
                <input
                  id="employee-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Priya Raman"
                  required
                  autoFocus
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="employee-email">
                    {role === 'client' ? 'Primary Email' : 'Work Email'}{' '}
                    <span style={{ color: 'var(--danger)' }}>*</span>
                  </label>
                  <input
                    id="employee-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="priya@example.com"
                    required
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="employee-phone">Phone Number</label>
                  <input
                    id="employee-phone"
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+91 98765 43210"
                  />
                </div>
              </div>

              {role === 'client' && (
                <div className="form-group">
                  <label htmlFor="employee-secondary-email">Secondary Email (optional)</label>
                  <input
                    id="employee-secondary-email"
                    type="email"
                    value={secondaryEmail}
                    onChange={(e) => setSecondaryEmail(e.target.value)}
                    placeholder="backup@example.com"
                  />
                </div>
              )}

              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="employee-dob">Date of Birth</label>
                  <input
                    id="employee-dob"
                    type="date"
                    value={dob}
                    onChange={(e) => setDob(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="employee-gender">Gender</label>
                  <select
                    id="employee-gender"
                    value={gender}
                    onChange={(e) => setGender(e.target.value)}
                  >
                    {GENDER_OPTIONS.map((g) => (
                      <option key={g.value} value={g.value}>
                        {g.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label htmlFor="employee-blood-group">Blood Group</label>
                  <select
                    id="employee-blood-group"
                    value={bloodGroup}
                    onChange={(e) => setBloodGroup(e.target.value)}
                  >
                    {BLOOD_GROUP_OPTIONS.map((bg) => (
                      <option key={bg.value} value={bg.value}>
                        {bg.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="form-group form-group-narrow" style={{ maxWidth: 200 }}>
                <label htmlFor="employee-role">System Access Role</label>
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
            </>
          )}

          {/* TAB 2: ORGANIZATION & ROLES */}
          {activeTab === 'organization' && role !== 'client' && (
            <>
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="employee-department-id">Department</label>
                  <select
                    id="employee-department-id"
                    value={departmentId}
                    onChange={(e) => {
                      setDepartmentId(e.target.value);
                      const selected = departmentsList.find((d) => String(d.id) === e.target.value);
                      if (selected) setDepartment(selected.name);
                    }}
                  >
                    <option value="">Select Department</option>
                    {departmentsList.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} ({d.code})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label htmlFor="employee-designation-id">Designation / Role</label>
                  <select
                    id="employee-designation-id"
                    value={designationId}
                    onChange={(e) => {
                      setDesignationId(e.target.value);
                      const selected = designationsList.find((des) => String(des.id) === e.target.value);
                      if (selected) setTitle(selected.title);
                    }}
                  >
                    <option value="">Select Designation</option>
                    {availableDesignations.map((des) => (
                      <option key={des.id} value={des.id}>
                        {des.title} {des.level ? `(${des.level})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="employee-manager-id">Reporting Manager</label>
                  <select
                    id="employee-manager-id"
                    value={reportingManagerId}
                    onChange={(e) => setReportingManagerId(e.target.value)}
                  >
                    <option value="">None / Reports to Leadership</option>
                    {managersList.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} ({m.department || m.role})
                      </option>
                    ))}
                  </select>
                  <span className="field-hint">Defines the reporting line and hierarchy tree.</span>
                </div>

                <div className="form-group">
                  <label htmlFor="employee-status">Lifecycle Status</label>
                  <select
                    id="employee-status"
                    value={employmentStatus}
                    onChange={(e) => setEmploymentStatus(e.target.value)}
                  >
                    {EMPLOYMENT_STATUS_OPTIONS.map((st) => (
                      <option key={st.value} value={st.value}>
                        {st.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="employee-employment-type">Employment Type</label>
                  <select
                    id="employee-employment-type"
                    value={employmentType}
                    onChange={(e) => setEmploymentType(e.target.value)}
                  >
                    <option value="full_time">Full-Time Employee</option>
                    <option value="part_time">Part-Time Employee</option>
                    <option value="intern">Intern</option>
                    <option value="contract">Contractor</option>
                    <option value="freelancer">Freelancer</option>
                  </select>
                </div>

                <div className="form-group">
                  <label htmlFor="employee-joining-date">Joining Date</label>
                  <input
                    id="employee-joining-date"
                    type="date"
                    value={joiningDate}
                    onChange={(e) => setJoiningDate(e.target.value)}
                  />
                </div>
              </div>

              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={(e) => setActive(e.target.checked)}
                  />
                  <span>Active employee directory access</span>
                </label>
              </div>
            </>
          )}

          {/* TAB 3: ADDRESS & EMERGENCY */}
          {activeTab === 'address' && role !== 'client' && (
            <>
              <div className="form-group">
                <label htmlFor="employee-curr-address">Current Residential Address</label>
                <textarea
                  id="employee-curr-address"
                  rows={2}
                  value={currentAddress}
                  onChange={(e) => setCurrentAddress(e.target.value)}
                  placeholder="Street, Apartment, City, State, PIN"
                />
              </div>

              <div className="form-group">
                <label htmlFor="employee-perm-address">Permanent Address</label>
                <textarea
                  id="employee-perm-address"
                  rows={2}
                  value={permanentAddress}
                  onChange={(e) => setPermanentAddress(e.target.value)}
                  placeholder="Permanent residential address"
                />
              </div>

              <div style={{ fontWeight: 600, fontSize: 13, marginTop: 16, marginBottom: 8 }}>
                Emergency Contact Details
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="employee-emg-name">Contact Person Name</label>
                  <input
                    id="employee-emg-name"
                    type="text"
                    value={emergencyContactName}
                    onChange={(e) => setEmergencyContactName(e.target.value)}
                    placeholder="e.g. Ramesh Raman"
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="employee-emg-rel">Relationship</label>
                  <input
                    id="employee-emg-rel"
                    type="text"
                    value={emergencyContactRelation}
                    onChange={(e) => setEmergencyContactRelation(e.target.value)}
                    placeholder="e.g. Spouse / Parent / Sibling"
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="employee-emg-phone">Emergency Phone</label>
                  <input
                    id="employee-emg-phone"
                    type="tel"
                    value={emergencyContactPhone}
                    onChange={(e) => setEmergencyContactPhone(e.target.value)}
                    placeholder="+91 98765 00000"
                  />
                </div>
              </div>
            </>
          )}

          {/* TAB 4: COMPENSATION */}
          {activeTab === 'compensation' && role !== 'client' && (
            <>
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
            </>
          )}

          {/* TAB 5: DOCUMENTS */}
          {activeTab === 'documents' && employee && (
            <div style={{ marginTop: 8 }}>
              <EmployeeDocumentsTab
                employeeId={employee.id}
                isAdmin={true}
              />
            </div>
          )}

          {error && <div className="error-text" style={{ marginTop: 12 }}>{error}</div>}

          <div className="modal-actions" style={{ marginTop: 20 }}>
            <button type="button" className="btn-secondary" onClick={onClose}>
              {activeTab === 'documents' ? 'Close' : 'Cancel'}
            </button>
            {activeTab !== 'documents' && (
              <button type="submit" className="btn-primary" disabled={submitting}>
                {submitting ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Employee'}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

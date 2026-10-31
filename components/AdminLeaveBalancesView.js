'use client';

import { useState, useEffect } from 'react';
import LeaveBalanceCards from '@/components/LeaveBalanceCards';

const ALL_ROLES = [
  { key: 'full_time', label: 'Full-Time' },
  { key: 'part_time', label: 'Part-Time' },
  { key: 'intern', label: 'Intern' },
  { key: 'probation', label: 'Probation' },
  { key: 'freelancer', label: 'Freelancer' },
];

export default function AdminLeaveBalancesView() {
  const [employees, setEmployees] = useState([]);
  const [selectedEmpId, setSelectedEmpId] = useState(null);
  const [balanceData, setBalanceData] = useState(null);
  const [loadingBalances, setLoadingBalances] = useState(false);
  const [adjustments, setAdjustments] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Policy Settings state
  const [policy, setPolicy] = useState({
    fiscal_year_start_month: 4,
    new_joiner_prorata_method: 'day_count',
    categories: [],
  });
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [policyMessage, setPolicyMessage] = useState(null);

  // Holidays state
  const [holidays, setHolidays] = useState([]);
  const [loadingHolidays, setLoadingHolidays] = useState(false);
  const [newHolidayDate, setNewHolidayDate] = useState('');
  const [newHolidayName, setNewHolidayName] = useState('');
  const [newHolidayRecurring, setNewHolidayRecurring] = useState(false);
  const [newHolidaySunday, setNewHolidaySunday] = useState(false);
  const [holidayMessage, setHolidayMessage] = useState(null);

  // Category Edit / Add Modal state
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState(null);
  const [catCode, setCatCode] = useState('');
  const [catName, setCatName] = useState('');
  const [catAllowance, setCatAllowance] = useState('7.0');
  const [catEligibleRoles, setCatEligibleRoles] = useState(['full_time']);
  const [catIsPaid, setCatIsPaid] = useState(true);
  const [catAllowLop, setCatAllowLop] = useState(true);
  const [catCarryForward, setCatCarryForward] = useState(false);
  const [catMaxCf, setCatMaxCf] = useState('');
  const [catMinAdvance, setCatMinAdvance] = useState('0');
  const [catAllowPast, setCatAllowPast] = useState(false);
  const [catIsActive, setCatIsActive] = useState(true);
  const [savingCategory, setSavingCategory] = useState(false);
  const [categoryError, setCategoryError] = useState(null);

  // Rollover state
  const [rolloverTargetYear, setRolloverTargetYear] = useState('2027-2028');
  const [runningRollover, setRunningRollover] = useState(false);
  const [rolloverResult, setRolloverResult] = useState(null);

  // Adjust Modal state
  const [adjustModalOpen, setAdjustModalOpen] = useState(false);
  const [adjLeaveType, setAdjLeaveType] = useState('casual');
  const [adjType, setAdjType] = useState('balance_adjustment');
  const [adjFiscalYear, setAdjFiscalYear] = useState('');
  const [adjNewValue, setAdjNewValue] = useState('');
  const [adjReason, setAdjReason] = useState('');
  const [submittingAdjust, setSubmittingAdjust] = useState(false);
  const [adjustError, setAdjustError] = useState(null);
  const [adjustSuccess, setAdjustSuccess] = useState(null);

  // 1. Initial Load: Policy settings, Holidays, and Employees
  useEffect(() => {
    loadPolicySettings();
    fetchHolidays();
    fetchEmployees();
  }, []);

  async function loadPolicySettings() {
    try {
      const res = await fetch('/api/attendance/leave/admin/policy-settings');
      if (res.ok) {
        const data = await res.json();
        if (data?.settings) {
          setPolicy(data.settings);
        }
      }
    } catch {}
  }

  async function fetchHolidays() {
    setLoadingHolidays(true);
    try {
      const res = await fetch('/api/attendance/admin/holidays');
      if (res.ok) {
        const json = await res.json();
        setHolidays(json.holidays || []);
      }
    } catch {
      // ignore
    } finally {
      setLoadingHolidays(false);
    }
  }

  async function fetchEmployees() {
    try {
      const res = await fetch('/api/employees');
      if (res.ok) {
        const data = await res.json();
        if (data?.employees) {
          setEmployees(data.employees);
          if (data.employees.length > 0) {
            setSelectedEmpId(data.employees[0].id);
          } else {
            setSelectedEmpId(null);
            setBalanceData(null);
            setAdjustments([]);
          }
        }
      }
    } catch {}
  }

  // 2. Fetch balances and adjustment history when selected employee changes
  useEffect(() => {
    if (!selectedEmpId) return;
    fetchBalances(selectedEmpId);
    fetchAdjustments(selectedEmpId);
  }, [selectedEmpId]);

  async function fetchBalances(empId) {
    setLoadingBalances(true);
    try {
      const res = await fetch(`/api/attendance/leave/balances?employeeId=${empId}`);
      if (res.ok) {
        const json = await res.json();
        const bData = json.balances || json;
        setBalanceData(bData);
        if (bData?.fiscalYear && !adjFiscalYear) {
          setAdjFiscalYear(bData.fiscalYear);
        }
      }
    } catch {
      // ignore
    } finally {
      setLoadingBalances(false);
    }
  }

  async function fetchAdjustments(empId) {
    setLoadingHistory(true);
    try {
      const res = await fetch(`/api/attendance/leave/admin/adjustment-history?employeeId=${empId || ''}`);
      if (res.ok) {
        const json = await res.json();
        setAdjustments(json.adjustments || []);
      }
    } catch {
      // ignore
    } finally {
      setLoadingHistory(false);
    }
  }

  async function handleSavePolicy(e) {
    e.preventDefault();
    setSavingPolicy(true);
    setPolicyMessage(null);
    try {
      const res = await fetch('/api/attendance/leave/admin/policy-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fiscalYearStartMonth: policy.fiscal_year_start_month,
          newJoinerProrataMethod: policy.new_joiner_prorata_method,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to update leave policy settings.');
      setPolicy(json.settings);
      setPolicyMessage({ type: 'success', text: 'Leave policy settings updated successfully.' });
      if (selectedEmpId) fetchBalances(selectedEmpId);
    } catch (err) {
      setPolicyMessage({ type: 'error', text: err.message });
    } finally {
      setSavingPolicy(false);
    }
  }

  function openAddCategoryModal() {
    setEditingCategory(null);
    setCatCode('');
    setCatName('');
    setCatAllowance('7.0');
    setCatEligibleRoles(['full_time']);
    setCatIsPaid(true);
    setCatAllowLop(true);
    setCatCarryForward(false);
    setCatMaxCf('');
    setCatMinAdvance('0');
    setCatAllowPast(false);
    setCatIsActive(true);
    setCategoryError(null);
    setCategoryModalOpen(true);
  }

  function openEditCategoryModal(cat) {
    setEditingCategory(cat);
    setCatCode(cat.code);
    setCatName(cat.name);
    setCatAllowance(String(cat.annual_allowance));
    setCatEligibleRoles(Array.isArray(cat.eligible_employment_types) ? cat.eligible_employment_types : []);
    setCatIsPaid(Boolean(cat.is_paid));
    setCatAllowLop(Boolean(cat.allow_lop_beyond_balance));
    setCatCarryForward(Boolean(cat.carry_forward_enabled));
    setCatMaxCf(cat.max_carry_forward_days != null ? String(cat.max_carry_forward_days) : '');
    setCatMinAdvance(String(cat.min_advance_days || 0));
    setCatAllowPast(Boolean(cat.allow_past_dates));
    setCatIsActive(Boolean(cat.is_active));
    setCategoryError(null);
    setCategoryModalOpen(true);
  }

  async function handleSaveCategory(e) {
    e.preventDefault();
    setSavingCategory(true);
    setCategoryError(null);

    if (!catCode.trim() || !catName.trim()) {
      setCategoryError('Category code and name are required.');
      setSavingCategory(false);
      return;
    }

    try {
      const res = await fetch('/api/attendance/leave/admin/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: catCode.trim().toLowerCase(),
          name: catName.trim(),
          annualAllowance: parseFloat(catAllowance) || 0,
          eligibleEmploymentTypes: catEligibleRoles,
          isPaid: catIsPaid,
          allowLopBeyondBalance: catAllowLop,
          carryForwardEnabled: catCarryForward,
          maxCarryForwardDays: catMaxCf ? parseFloat(catMaxCf) : null,
          minAdvanceDays: parseInt(catMinAdvance, 10) || 0,
          allowPastDates: catAllowPast,
          isActive: catIsActive,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to save leave category.');

      // Refresh policy settings
      await loadPolicySettings();

      setCategoryModalOpen(false);
      if (selectedEmpId) fetchBalances(selectedEmpId);
    } catch (err) {
      setCategoryError(err.message);
    } finally {
      setSavingCategory(false);
    }
  }

  async function handleDeleteCategory(code) {
    if (!confirm(`Are you sure you want to deactivate or remove category "${code}"?`)) {
      return;
    }

    try {
      const res = await fetch(`/api/attendance/leave/admin/categories?code=${code}`, {
        method: 'DELETE',
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to remove category.');

      await loadPolicySettings();
      if (selectedEmpId) fetchBalances(selectedEmpId);
    } catch (err) {
      alert(err.message);
    }
  }

  async function handleAddHoliday(e) {
    e.preventDefault();
    setHolidayMessage(null);
    if (!newHolidayDate || !newHolidayName.trim()) {
      setHolidayMessage({ type: 'error', text: 'Holiday date and name are required.' });
      return;
    }

    try {
      const res = await fetch('/api/attendance/admin/holidays', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          holidayDate: newHolidayDate,
          name: newHolidayName.trim(),
          isRecurring: newHolidayRecurring ? 1 : 0,
          fallsOnSunday: newHolidaySunday ? 1 : 0,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to add holiday.');
      setHolidays(json.holidays || []);
      setNewHolidayDate('');
      setNewHolidayName('');
      setNewHolidayRecurring(false);
      setNewHolidaySunday(false);
      setHolidayMessage({ type: 'success', text: 'Holiday added successfully.' });
      if (selectedEmpId) fetchBalances(selectedEmpId);
    } catch (err) {
      setHolidayMessage({ type: 'error', text: err.message });
    }
  }

  async function handleDeleteHoliday(id) {
    if (!confirm('Are you sure you want to remove this company holiday?')) return;
    try {
      const res = await fetch(`/api/attendance/admin/holidays?id=${id}`, {
        method: 'DELETE',
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to delete holiday.');
      setHolidays(json.holidays || []);
      if (selectedEmpId) fetchBalances(selectedEmpId);
    } catch (err) {
      alert(err.message);
    }
  }

  async function handleRunRollover() {
    if (!confirm(`Are you sure you want to execute the Annual Rollover for financial year ${rolloverTargetYear}?\n\nThis will carry forward eligible leave, reset non-CF categories, and grant new upfront entitlements according to company policy. This operation is safe and idempotent.`)) {
      return;
    }
    setRunningRollover(true);
    setRolloverResult(null);
    try {
      const res = await fetch('/api/attendance/leave/admin/rollover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetFiscalYear: rolloverTargetYear,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to execute annual rollover.');
      setRolloverResult({ type: 'success', text: json.message, summary: json.summary });
      if (selectedEmpId) fetchBalances(selectedEmpId);
    } catch (err) {
      setRolloverResult({ type: 'error', text: err.message });
    } finally {
      setRunningRollover(false);
    }
  }

  function openAdjustmentModal() {
    setAdjustError(null);
    setAdjustSuccess(null);
    setAdjReason('');
    setAdjNewValue('');
    setAdjType('balance_adjustment');
    setAdjFiscalYear(balanceData?.fiscalYear || '2026-2027');
    const firstCat = policy.categories?.[0]?.code || 'casual';
    setAdjLeaveType(firstCat);
    setAdjustModalOpen(true);
  }

  async function handleAdjustmentSubmit(e) {
    e.preventDefault();
    setAdjustError(null);
    setAdjustSuccess(null);

    if (!adjReason || adjReason.trim().length < 5) {
      setAdjustError('A mandatory reason of at least 5 characters is required.');
      return;
    }

    if (adjNewValue === '' || isNaN(parseFloat(adjNewValue))) {
      setAdjustError('Please specify a valid numeric value.');
      return;
    }

    setSubmittingAdjust(true);
    try {
      const res = await fetch('/api/attendance/leave/admin/adjust-balance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeId: selectedEmpId,
          fiscalYear: adjFiscalYear,
          leaveType: adjLeaveType,
          adjustmentType: adjType,
          newValue: parseFloat(adjNewValue),
          reason: adjReason.trim(),
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to record leave balance adjustment.');

      setAdjustSuccess('Leave balance adjusted and auditable log recorded.');
      setBalanceData(json.balances);
      fetchAdjustments(selectedEmpId);
      setTimeout(() => {
        setAdjustModalOpen(false);
      }, 1200);
    } catch (err) {
      setAdjustError(err.message);
    } finally {
      setSubmittingAdjust(false);
    }
  }

  const selectedEmp = employees.find((e) => e.id === Number(selectedEmpId));
  const activeCategories = policy.categories || [];

  return (
    <div>
      {/* 1. Company & Employee Selection Bar */}
      <div style={{
        background: '#ffffff',
        border: '1px solid #ebecf0',
        borderRadius: '8px',
        padding: '16px 20px',
        marginBottom: '20px',
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: '14px'
      }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '16px' }}>
          {/* Employee Dropdown */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <label style={{ fontSize: '13px', fontWeight: 600, color: '#172b4d' }}>
              Employee:
            </label>
            <select
              value={selectedEmpId || ''}
              onChange={(e) => setSelectedEmpId(Number(e.target.value))}
              disabled={employees.length === 0}
              style={{
                padding: '8px 12px',
                borderRadius: '6px',
                border: '1px solid #dfe1e6',
                fontSize: '13px',
                fontWeight: 600,
                color: '#172b4d',
                background: '#fff',
                minWidth: '220px'
              }}
            >
              {employees.length === 0 ? (
                <option value="">No employees in this company</option>
              ) : (
                employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.name} ({emp.department || 'General'})
                  </option>
                ))
              )}
            </select>
          </div>

          {selectedEmp && (
            <span style={{ fontSize: '12px', color: '#626f86' }}>
              Role: <strong style={{ textTransform: 'capitalize' }}>{(selectedEmp.employment_type || 'full_time').replace('_', ' ')}</strong> · Joined: <strong>{selectedEmp.joining_date || 'N/A'}</strong>
            </span>
          )}
        </div>

        <button
          onClick={openAdjustmentModal}
          disabled={!selectedEmpId}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '8px 16px',
            background: '#0c66e4',
            color: '#fff',
            border: 'none',
            borderRadius: '6px',
            fontSize: '13px',
            fontWeight: 600,
            cursor: selectedEmpId ? 'pointer' : 'not-allowed',
            boxShadow: '0 1px 2px rgba(0,0,0,0.1)'
          }}
        >
          ✏️ Adjust Balance / Correction
        </button>
      </div>

      {/* 2. Employee Balances Cards */}
      <LeaveBalanceCards
        balanceData={balanceData}
        loading={loadingBalances}
        onRefresh={() => selectedEmpId && fetchBalances(selectedEmpId)}
      />

      {/* 3. Organization Leave Policy & Categories Section */}
      <div style={{
        background: '#ffffff',
        borderRadius: '8px',
        border: '1px solid #ebecf0',
        padding: '20px',
        marginBottom: '24px'
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '16px',
          flexWrap: 'wrap',
          gap: '10px'
        }}>
          <div>
            <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#172b4d' }}>
              📋 Company Leave Categories & Eligibility Rules
            </h4>
            <span style={{ fontSize: '12px', color: '#626f86' }}>
              Configure annual entitlements, role eligibility, paid/unpaid classification, and rollover rules per company without modifying code.
            </span>
          </div>
          <button
            onClick={openAddCategoryModal}
            style={{
              padding: '8px 14px',
              borderRadius: '6px',
              border: 'none',
              background: '#006644',
              color: '#fff',
              fontSize: '12px',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            + Add Custom Leave Category
          </button>
        </div>

        {/* Categories Table */}
        <div style={{ overflowX: 'auto', border: '1px solid #dfe1e6', borderRadius: '6px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left' }}>
            <thead>
              <tr style={{ background: '#f4f5f7', borderBottom: '1px solid #dfe1e6', color: '#44546f' }}>
                <th style={{ padding: '10px 12px' }}>Category Name</th>
                <th style={{ padding: '10px 12px' }}>Code</th>
                <th style={{ padding: '10px 12px', textAlign: 'right' }}>Allowance</th>
                <th style={{ padding: '10px 12px' }}>Eligible Employment Types</th>
                <th style={{ padding: '10px 12px' }}>Paid / LOP</th>
                <th style={{ padding: '10px 12px' }}>Carry Forward</th>
                <th style={{ padding: '10px 12px' }}>Status</th>
                <th style={{ padding: '10px 12px', textAlign: 'center' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {activeCategories.map((cat) => {
                const roles = Array.isArray(cat.eligible_employment_types) ? cat.eligible_employment_types : [];
                return (
                  <tr key={cat.code} style={{ borderBottom: '1px solid #ebecf0' }}>
                    <td style={{ padding: '10px 12px', fontWeight: 700, color: '#172b4d' }}>
                      {cat.name}
                    </td>
                    <td style={{ padding: '10px 12px', fontFamily: 'monospace', color: '#626f86' }}>
                      {cat.code}
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, color: '#0c66e4' }}>
                      {Number(cat.annual_allowance).toFixed(1)} days
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                        {ALL_ROLES.map((r) => {
                          const isElig = roles.includes(r.key);
                          return (
                            <span
                              key={r.key}
                              style={{
                                padding: '1px 6px',
                                borderRadius: '4px',
                                fontSize: '11px',
                                fontWeight: isElig ? 600 : 400,
                                background: isElig ? '#e3fcef' : '#f4f5f7',
                                color: isElig ? '#006644' : '#a5b2c6',
                                textDecoration: isElig ? 'none' : 'line-through'
                              }}
                            >
                              {r.label}
                            </span>
                          );
                        })}
                      </div>
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <span style={{
                        padding: '2px 8px',
                        borderRadius: '10px',
                        fontSize: '11px',
                        fontWeight: 600,
                        background: cat.is_paid ? '#deebff' : '#ffebe6',
                        color: cat.is_paid ? '#0747a6' : '#bf2600'
                      }}>
                        {cat.is_paid ? 'Paid' : 'Unpaid (LOP)'}
                      </span>
                    </td>
                    <td style={{ padding: '10px 12px', color: '#44546f' }}>
                      {cat.carry_forward_enabled ? (
                        <span style={{ color: '#006644', fontWeight: 600 }}>
                          ✓ Yes {cat.max_carry_forward_days != null ? `(max ${cat.max_carry_forward_days}d)` : '(unlimited)'}
                        </span>
                      ) : (
                        <span style={{ color: '#626f86' }}>✕ Resets at FY</span>
                      )}
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <span style={{
                        padding: '2px 8px',
                        borderRadius: '10px',
                        fontSize: '11px',
                        fontWeight: 600,
                        background: cat.is_active ? '#e3fcef' : '#f4f5f7',
                        color: cat.is_active ? '#006644' : '#626f86'
                      }}>
                        {cat.is_active ? 'Active' : 'Disabled'}
                      </span>
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                      <div style={{ display: 'inline-flex', gap: '6px' }}>
                        <button
                          type="button"
                          onClick={() => openEditCategoryModal(cat)}
                          style={{
                            background: '#f4f5f7',
                            border: '1px solid #dfe1e6',
                            borderRadius: '4px',
                            padding: '3px 8px',
                            fontSize: '11px',
                            cursor: 'pointer',
                            fontWeight: 600,
                            color: '#0c66e4'
                          }}
                        >
                          Edit
                        </button>
                        {cat.code !== 'casual' && cat.code !== 'sick' && (
                          <button
                            type="button"
                            onClick={() => handleDeleteCategory(cat.code)}
                            style={{
                              background: '#ffebe6',
                              border: '1px solid #ffbdad',
                              borderRadius: '4px',
                              padding: '3px 8px',
                              fontSize: '11px',
                              cursor: 'pointer',
                              fontWeight: 600,
                              color: '#bf2600'
                            }}
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 4. Two-Column Layout: Company Holiday Calendar & Policy / Rollover */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.3fr) minmax(0, 1fr)', gap: '20px', marginBottom: '24px' }}>
        {/* Left Column: Company Holiday Calendar */}
        <div style={{ background: '#ffffff', borderRadius: '8px', border: '1px solid #ebecf0', padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
            <div>
              <h4 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#172b4d' }}>
                📅 Company Holiday Calendar ({holidays.length} Holidays)
              </h4>
              <span style={{ fontSize: '11px', color: '#626f86' }}>
                All employees are eligible. Holidays are tracked separately and not deducted from leave balances.
              </span>
            </div>
            <button
              onClick={fetchHolidays}
              disabled={loadingHolidays}
              style={{
                background: '#f4f5f7',
                border: '1px solid #dfe1e6',
                borderRadius: '4px',
                padding: '4px 8px',
                fontSize: '11px',
                cursor: 'pointer',
                fontWeight: 600,
                color: '#44546f'
              }}
            >
              {loadingHolidays ? 'Loading...' : '↻ Refresh'}
            </button>
          </div>

          {holidayMessage && (
            <div style={{
              padding: '8px 12px',
              borderRadius: '6px',
              fontSize: '12px',
              marginBottom: '12px',
              background: holidayMessage.type === 'success' ? '#e3fcef' : '#ffebe6',
              color: holidayMessage.type === 'success' ? '#006644' : '#bf2600'
            }}>
              {holidayMessage.text}
            </div>
          )}

          {/* Add Holiday Inline Form */}
          <form onSubmit={handleAddHoliday} style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '8px',
            alignItems: 'center',
            marginBottom: '14px',
            background: '#f4f5f7',
            padding: '10px 12px',
            borderRadius: '6px'
          }}>
            <input
              type="date"
              value={newHolidayDate}
              onChange={(e) => setNewHolidayDate(e.target.value)}
              required
              style={{ padding: '6px 8px', borderRadius: '4px', border: '1px solid #dfe1e6', fontSize: '12px' }}
            />
            <input
              type="text"
              placeholder="Holiday name (e.g. Diwali)"
              value={newHolidayName}
              onChange={(e) => setNewHolidayName(e.target.value)}
              required
              style={{ flex: 1, minWidth: '140px', padding: '6px 8px', borderRadius: '4px', border: '1px solid #dfe1e6', fontSize: '12px' }}
            />
            <label style={{ fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px', color: '#44546f' }}>
              <input
                type="checkbox"
                checked={newHolidayRecurring}
                onChange={(e) => setNewHolidayRecurring(e.target.checked)}
              />
              Recurring
            </label>
            <button
              type="submit"
              style={{
                padding: '6px 12px',
                background: '#0c66e4',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              + Add
            </button>
          </form>

          {/* Holiday List Table */}
          <div style={{ maxHeight: '300px', overflowY: 'auto', border: '1px solid #ebecf0', borderRadius: '6px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left' }}>
              <thead>
                <tr style={{ background: '#f4f5f7', color: '#44546f', borderBottom: '1px solid #ebecf0' }}>
                  <th style={{ padding: '6px 10px' }}>Date</th>
                  <th style={{ padding: '6px 10px' }}>Holiday Name</th>
                  <th style={{ padding: '6px 10px' }}>Type</th>
                  <th style={{ padding: '6px 10px', textAlign: 'center' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {holidays.length === 0 ? (
                  <tr>
                    <td colSpan={4} style={{ padding: '16px', textAlign: 'center', color: '#626f86' }}>
                      No holidays configured for this company. Add holidays using the form above.
                    </td>
                  </tr>
                ) : (
                  holidays.map((h) => (
                    <tr key={h.id || h.holiday_date} style={{ borderBottom: '1px solid #f4f5f7' }}>
                      <td style={{ padding: '6px 10px', fontFamily: 'monospace', color: '#172b4d' }}>
                        {h.holiday_date}
                      </td>
                      <td style={{ padding: '6px 10px', fontWeight: 600, color: '#172b4d' }}>
                        {h.name}
                      </td>
                      <td style={{ padding: '6px 10px', color: '#626f86' }}>
                        {h.is_recurring ? 'Recurring' : 'Fixed Year'}
                      </td>
                      <td style={{ padding: '6px 10px', textAlign: 'center' }}>
                        <button
                          type="button"
                          onClick={() => handleDeleteHoliday(h.id)}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: '#bf2600',
                            fontSize: '11px',
                            fontWeight: 600,
                            cursor: 'pointer'
                          }}
                        >
                          ✕ Delete
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right Column: Policy Cycle & Rollover */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Policy Cycle Settings */}
          <div style={{ background: '#ffffff', borderRadius: '8px', border: '1px solid #ebecf0', padding: '20px' }}>
            <h4 style={{ margin: '0 0 14px', fontSize: '15px', fontWeight: 700, color: '#172b4d' }}>
              ⚙️ Organization Policy Settings
            </h4>

            {policyMessage && (
              <div style={{
                padding: '8px 12px',
                borderRadius: '6px',
                fontSize: '12px',
                marginBottom: '12px',
                background: policyMessage.type === 'success' ? '#e3fcef' : '#ffebe6',
                color: policyMessage.type === 'success' ? '#006644' : '#bf2600'
              }}>
                {policyMessage.text}
              </div>
            )}

            <form onSubmit={handleSavePolicy}>
              {/* New Joiner Pro-Rata Method */}
              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#44546f', marginBottom: '4px' }}>
                  New Joiner Pro-Rata Entitlement Calculation:
                </label>
                <select
                  value={policy.new_joiner_prorata_method || 'day_count'}
                  onChange={(e) => setPolicy({ ...policy, new_joiner_prorata_method: e.target.value })}
                  style={{ width: '100%', padding: '6px 10px', borderRadius: '6px', border: '1px solid #dfe1e6', fontSize: '13px', color: '#172b4d', background: '#fff' }}
                >
                  <option value="day_count">Day-Count Precision (Pro-rata by exact days remaining)</option>
                  <option value="whole_month">Whole-Month Standard (15th cut-off rule)</option>
                  <option value="none">No Pro-Rata (Full quota upfront regardless of join date)</option>
                </select>
              </div>

              {/* Fiscal Year Start Month */}
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#44546f', marginBottom: '4px' }}>
                  Financial Year Cycle Starts:
                </label>
                <select
                  value={policy.fiscal_year_start_month || 4}
                  onChange={(e) => setPolicy({ ...policy, fiscal_year_start_month: parseInt(e.target.value, 10) })}
                  style={{ width: '100%', padding: '6px 10px', borderRadius: '6px', border: '1px solid #dfe1e6', fontSize: '13px', color: '#172b4d', background: '#fff' }}
                >
                  <option value={4}>April 1 (Indian Standard Fiscal Year)</option>
                  <option value={1}>January 1 (Calendar Year)</option>
                  <option value={7}>July 1</option>
                  <option value={10}>October 1</option>
                </select>
              </div>

              <button
                type="submit"
                disabled={savingPolicy}
                style={{
                  width: '100%',
                  padding: '8px 16px',
                  borderRadius: '6px',
                  border: 'none',
                  background: '#0c66e4',
                  color: '#fff',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: savingPolicy ? 'not-allowed' : 'pointer'
                }}
              >
                {savingPolicy ? 'Saving Changes...' : 'Save Policy Settings'}
              </button>
            </form>
          </div>

          {/* Annual FY Rollover Panel */}
          <div style={{ background: '#ffffff', borderRadius: '8px', border: '1px solid #ebecf0', padding: '20px' }}>
            <h4 style={{ margin: '0 0 10px', fontSize: '15px', fontWeight: 700, color: '#172b4d' }}>
              🔄 Annual Financial Year Rollover
            </h4>
            <p style={{ margin: '0 0 14px', fontSize: '12px', color: '#626f86', lineHeight: '1.4' }}>
              Executes annual transition for this company: grants configured upfront entitlements, carries forward eligible balances, and safely resets non-CF categories. Fully idempotent.
            </p>

            {rolloverResult && (
              <div style={{
                padding: '8px 12px',
                borderRadius: '6px',
                fontSize: '12px',
                marginBottom: '12px',
                background: rolloverResult.type === 'success' ? '#e3fcef' : '#ffebe6',
                color: rolloverResult.type === 'success' ? '#006644' : '#bf2600'
              }}>
                {rolloverResult.text}
              </div>
            )}

            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '14px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#44546f' }}>
                Target FY:
              </label>
              <input
                type="text"
                value={rolloverTargetYear}
                onChange={(e) => setRolloverTargetYear(e.target.value)}
                placeholder="2027-2028"
                style={{ width: '130px', padding: '6px 10px', borderRadius: '6px', border: '1px solid #dfe1e6', fontSize: '13px', fontWeight: 600 }}
              />
            </div>

            <button
              type="button"
              onClick={handleRunRollover}
              disabled={runningRollover}
              style={{
                width: '100%',
                padding: '8px 16px',
                borderRadius: '6px',
                border: '1px solid #dfe1e6',
                background: '#f4f5f7',
                color: '#172b4d',
                fontSize: '13px',
                fontWeight: 600,
                cursor: runningRollover ? 'not-allowed' : 'pointer'
              }}
            >
              {runningRollover ? 'Executing Rollover...' : 'Execute Idempotent FY Rollover'}
            </button>
          </div>
        </div>
      </div>

      {/* 5. Adjustment Audit Trail */}
      <div style={{ background: '#ffffff', borderRadius: '8px', border: '1px solid #ebecf0', padding: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
          <h4 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#172b4d' }}>
            📜 Balance Adjustment Audit Trail
          </h4>
          <button
            onClick={() => selectedEmpId && fetchAdjustments(selectedEmpId)}
            disabled={loadingHistory || !selectedEmpId}
            style={{
              background: '#f4f5f7',
              border: '1px solid #dfe1e6',
              borderRadius: '4px',
              padding: '4px 8px',
              fontSize: '11px',
              cursor: 'pointer',
              fontWeight: 600,
              color: '#44546f'
            }}
          >
            {loadingHistory ? 'Loading...' : '↻ Refresh'}
          </button>
        </div>

        {adjustments.length === 0 ? (
          <div style={{ padding: '30px 10px', textAlign: 'center', color: '#626f86', fontSize: '13px' }}>
            No adjustments recorded for this employee yet. Every administrative balance modification will be audited here.
          </div>
        ) : (
          <div style={{ overflowX: 'auto', maxHeight: '350px', overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left' }}>
              <thead>
                <tr style={{ background: '#f4f5f7', color: '#44546f', borderBottom: '1px solid #ebecf0' }}>
                  <th style={{ padding: '8px 10px' }}>Timestamp</th>
                  <th style={{ padding: '8px 10px' }}>Admin</th>
                  <th style={{ padding: '8px 10px' }}>Type</th>
                  <th style={{ padding: '8px 10px' }}>FY</th>
                  <th style={{ padding: '8px 10px' }}>Old → New</th>
                  <th style={{ padding: '8px 10px' }}>Delta</th>
                  <th style={{ padding: '8px 10px' }}>Reason</th>
                </tr>
              </thead>
              <tbody>
                {adjustments.map((a) => (
                  <tr key={a.id} style={{ borderBottom: '1px solid #ebecf0' }}>
                    <td style={{ padding: '8px 10px', color: '#626f86', whiteSpace: 'nowrap' }}>
                      {a.created_at ? a.created_at.slice(0, 16).replace('T', ' ') : '—'}
                    </td>
                    <td style={{ padding: '8px 10px', fontWeight: 600, color: '#172b4d' }}>
                      {a.admin_name}
                    </td>
                    <td style={{ padding: '8px 10px', textTransform: 'capitalize' }}>
                      <span style={{
                        background: '#f4f5f7',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        fontSize: '11px',
                        fontWeight: 600,
                        color: '#0c66e4'
                      }}>
                        {a.leave_type} · {a.adjustment_type}
                      </span>
                    </td>
                    <td style={{ padding: '8px 10px', color: '#44546f', whiteSpace: 'nowrap' }}>
                      {a.fiscal_year}
                      {a.applied_to_fiscal_year && a.applied_to_fiscal_year !== a.fiscal_year && (
                        <div style={{ fontSize: '10px', color: '#006644' }}>
                          ↳ {a.applied_to_fiscal_year}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '8px 10px', color: '#172b4d', whiteSpace: 'nowrap' }}>
                      {a.previous_value}d → <strong>{a.new_value}d</strong>
                    </td>
                    <td style={{
                      padding: '8px 10px',
                      fontWeight: 700,
                      color: a.delta > 0 ? '#006644' : a.delta < 0 ? '#bf2600' : '#626f86',
                      whiteSpace: 'nowrap'
                    }}>
                      {a.delta > 0 ? `+${a.delta}` : a.delta}d
                    </td>
                    <td style={{ padding: '8px 10px', color: '#44546f', maxWidth: '160px' }}>
                      {a.reason}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Category Modal (Add / Edit) */}
      {categoryModalOpen && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(9, 30, 66, 0.54)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '16px'
        }}>
          <div style={{
            background: '#ffffff',
            borderRadius: '8px',
            maxWidth: '560px',
            width: '100%',
            boxShadow: '0 8px 30px rgba(0, 0, 0, 0.2)',
            overflow: 'hidden'
          }}>
            <div style={{
              padding: '16px 20px',
              borderBottom: '1px solid #ebecf0',
              background: '#f4f5f7',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#172b4d' }}>
                {editingCategory ? `Configure ${editingCategory.name} (${editingCategory.code})` : 'Add Custom Leave Category'}
              </h3>
              <button
                onClick={() => setCategoryModalOpen(false)}
                style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', color: '#626f86' }}
              >
                ×
              </button>
            </div>

            <form onSubmit={handleSaveCategory} style={{ padding: '20px', maxHeight: '80vh', overflowY: 'auto' }}>
              {categoryError && (
                <div style={{ background: '#ffebe6', color: '#bf2600', padding: '10px 14px', borderRadius: '6px', fontSize: '12px', marginBottom: '14px', border: '1px solid #ffbdad' }}>
                  {categoryError}
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '12px', marginBottom: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#44546f', marginBottom: '4px' }}>
                    Category Name *
                  </label>
                  <input
                    type="text"
                    value={catName}
                    onChange={(e) => setCatName(e.target.value)}
                    placeholder="e.g. Earned Leave, Maternity"
                    required
                    style={{ width: '100%', padding: '6px 10px', borderRadius: '6px', border: '1px solid #dfe1e6', fontSize: '13px' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#44546f', marginBottom: '4px' }}>
                    Category Code *
                  </label>
                  <input
                    type="text"
                    value={catCode}
                    onChange={(e) => setCatCode(e.target.value)}
                    placeholder="e.g. earned, maternity"
                    disabled={Boolean(editingCategory)}
                    required
                    style={{ width: '100%', padding: '6px 10px', borderRadius: '6px', border: '1px solid #dfe1e6', fontSize: '13px', background: editingCategory ? '#f4f5f7' : '#fff' }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '14px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#44546f', marginBottom: '4px' }}>
                    Annual Entitlement (Days) *
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    value={catAllowance}
                    onChange={(e) => setCatAllowance(e.target.value)}
                    required
                    style={{ width: '100%', padding: '6px 10px', borderRadius: '6px', border: '1px solid #dfe1e6', fontSize: '13px' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#44546f', marginBottom: '4px' }}>
                    Min. Advance Notice (Days):
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={catMinAdvance}
                    onChange={(e) => setCatMinAdvance(e.target.value)}
                    style={{ width: '100%', padding: '6px 10px', borderRadius: '6px', border: '1px solid #dfe1e6', fontSize: '13px' }}
                  />
                </div>
              </div>

              {/* Employment Type Eligibility Checkboxes */}
              <div style={{ marginBottom: '16px', background: '#f4f5f7', padding: '12px', borderRadius: '6px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#172b4d', marginBottom: '8px' }}>
                  Eligible Employment Types:
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '8px' }}>
                  {ALL_ROLES.map((role) => (
                    <label key={role.key} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#172b4d', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={catEligibleRoles.includes(role.key)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setCatEligibleRoles([...catEligibleRoles, role.key]);
                          } else {
                            setCatEligibleRoles(catEligibleRoles.filter((k) => k !== role.key));
                          }
                        }}
                      />
                      {role.label}
                    </label>
                  ))}
                </div>
              </div>

              {/* Toggles */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '14px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#172b4d', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={catIsPaid}
                    onChange={(e) => setCatIsPaid(e.target.checked)}
                  />
                  Paid Leave Category
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#172b4d', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={catAllowLop}
                    onChange={(e) => setCatAllowLop(e.target.checked)}
                  />
                  Allow LOP Beyond Balance
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#172b4d', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={catCarryForward}
                    onChange={(e) => setCatCarryForward(e.target.checked)}
                  />
                  Carry Forward to Next FY
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#172b4d', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={catAllowPast}
                    onChange={(e) => setCatAllowPast(e.target.checked)}
                  />
                  Allow Past-Date Applications
                </label>
              </div>

              {catCarryForward && (
                <div style={{ marginBottom: '14px', paddingLeft: '10px', borderLeft: '2px solid #0c66e4' }}>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#44546f', marginBottom: '4px' }}>
                    Max Carry Forward Days (Leave empty for unlimited):
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    placeholder="e.g. 15, 30, or blank"
                    value={catMaxCf}
                    onChange={(e) => setCatMaxCf(e.target.value)}
                    style={{ width: '140px', padding: '6px 10px', borderRadius: '6px', border: '1px solid #dfe1e6', fontSize: '13px' }}
                  />
                </div>
              )}

              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', fontWeight: 600, color: '#172b4d', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={catIsActive}
                    onChange={(e) => setCatIsActive(e.target.checked)}
                  />
                  Category is Active for Organization
                </label>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button
                  type="button"
                  onClick={() => setCategoryModalOpen(false)}
                  disabled={savingCategory}
                  style={{ padding: '8px 16px', borderRadius: '6px', border: '1px solid #dfe1e6', background: '#fff', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingCategory}
                  style={{ padding: '8px 18px', borderRadius: '6px', border: 'none', background: '#0c66e4', color: '#fff', fontSize: '13px', fontWeight: 600, cursor: savingCategory ? 'not-allowed' : 'pointer' }}
                >
                  {savingCategory ? 'Saving...' : 'Save Category'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Balance Adjustment Modal */}
      {adjustModalOpen && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(9, 30, 66, 0.54)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '16px'
        }}>
          <div style={{
            background: '#ffffff',
            borderRadius: '8px',
            maxWidth: '520px',
            width: '100%',
            boxShadow: '0 8px 30px rgba(0, 0, 0, 0.2)',
            overflow: 'hidden'
          }}>
            <div style={{
              padding: '16px 20px',
              borderBottom: '1px solid #ebecf0',
              background: '#f4f5f7',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#172b4d' }}>
                Adjust Leave Balance / Entitlement
              </h3>
              <button
                onClick={() => setAdjustModalOpen(false)}
                style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', color: '#626f86' }}
              >
                ×
              </button>
            </div>

            <form onSubmit={handleAdjustmentSubmit} style={{ padding: '20px' }}>
              {adjustError && (
                <div style={{ background: '#ffebe6', color: '#bf2600', padding: '10px 14px', borderRadius: '6px', fontSize: '12px', marginBottom: '14px', border: '1px solid #ffbdad' }}>
                  {adjustError}
                </div>
              )}
              {adjustSuccess && (
                <div style={{ background: '#e3fcef', color: '#006644', padding: '10px 14px', borderRadius: '6px', fontSize: '12px', marginBottom: '14px', border: '1px solid #abf5d1' }}>
                  {adjustSuccess}
                </div>
              )}

              <div style={{ marginBottom: '12px', fontSize: '13px', color: '#44546f' }}>
                Employee: <strong>{selectedEmp?.name}</strong>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#44546f', marginBottom: '4px' }}>
                    Leave Category:
                  </label>
                  <select
                    value={adjLeaveType}
                    onChange={(e) => setAdjLeaveType(e.target.value)}
                    style={{ width: '100%', padding: '6px 10px', borderRadius: '6px', border: '1px solid #dfe1e6', fontSize: '13px', background: '#fff' }}
                  >
                    {activeCategories.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.name} ({c.code})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#44546f', marginBottom: '4px' }}>
                    Fiscal Year:
                  </label>
                  <input
                    type="text"
                    value={adjFiscalYear}
                    onChange={(e) => setAdjFiscalYear(e.target.value)}
                    placeholder="2026-2027"
                    required
                    style={{ width: '100%', padding: '6px 10px', borderRadius: '6px', border: '1px solid #dfe1e6', fontSize: '13px' }}
                  />
                </div>
              </div>

              <div style={{ marginBottom: '12px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#44546f', marginBottom: '4px' }}>
                  Adjustment Type:
                </label>
                <select
                  value={adjType}
                  onChange={(e) => setAdjType(e.target.value)}
                  style={{ width: '100%', padding: '6px 10px', borderRadius: '6px', border: '1px solid #dfe1e6', fontSize: '13px', background: '#fff' }}
                >
                  <option value="balance_adjustment">Manual Balance Adjustment (Adds/Subtracts from active balance)</option>
                  <option value="entitlement">Annual Entitlement Correction (Sets upfront annual quota)</option>
                  <option value="carry_forward">Carry-Forward Override (Sets carried-forward days)</option>
                  <option value="historical_correction">Historical Correction (Preceding FY closing balance & CF sync)</option>
                </select>
              </div>

              <div style={{ marginBottom: '12px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#44546f', marginBottom: '4px' }}>
                  New Value (in Days):
                </label>
                <input
                  type="number"
                  step="0.5"
                  value={adjNewValue}
                  onChange={(e) => setAdjNewValue(e.target.value)}
                  placeholder="e.g. 7.0, 1.5, -1.0"
                  required
                  style={{ width: '100%', padding: '6px 10px', borderRadius: '6px', border: '1px solid #dfe1e6', fontSize: '13px' }}
                />
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#44546f', marginBottom: '4px' }}>
                  Reason for Adjustment * (Mandatory &ge; 5 characters):
                </label>
                <textarea
                  rows={3}
                  value={adjReason}
                  onChange={(e) => setAdjReason(e.target.value)}
                  placeholder="e.g. Medical certificate verified; compensatory credit; prior FY audit reconciliation..."
                  required
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #dfe1e6', fontSize: '13px' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button
                  type="button"
                  onClick={() => setAdjustModalOpen(false)}
                  disabled={submittingAdjust}
                  style={{ padding: '8px 16px', borderRadius: '6px', border: '1px solid #dfe1e6', background: '#fff', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingAdjust}
                  style={{ padding: '8px 18px', borderRadius: '6px', border: 'none', background: '#0c66e4', color: '#fff', fontSize: '13px', fontWeight: 600, cursor: submittingAdjust ? 'not-allowed' : 'pointer' }}
                >
                  {submittingAdjust ? 'Saving...' : 'Apply Adjustment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

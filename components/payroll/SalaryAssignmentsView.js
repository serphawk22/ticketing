'use client';

import { useState, useEffect } from 'react';

export default function SalaryAssignmentsView({ workspaceId = 1 }) {
  const [assignments, setAssignments] = useState([]);
  const [structures, setStructures] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingEmp, setEditingEmp] = useState(null);
  const [selectedStructureId, setSelectedStructureId] = useState('');
  const [baseSalary, setBaseSalary] = useState('');
  const [currency, setCurrency] = useState('INR');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadData();
  }, [workspaceId]);

  async function loadData() {
    setLoading(true);
    try {
      const [assignRes, structRes] = await Promise.all([
        fetch(`/api/payroll/assignments?workspaceId=${workspaceId}`),
        fetch(`/api/payroll/structures?workspaceId=${workspaceId}`),
      ]);
      const assignData = await assignRes.json();
      const structData = await structRes.json();
      setAssignments(assignData.assignments || []);
      setStructures(structData.structures || []);
    } catch (err) {
      console.error('Error loading assignments:', err);
    } finally {
      setLoading(false);
    }
  }

  function handleOpenAssignModal(emp) {
    setEditingEmp(emp);
    setSelectedStructureId(emp.structure_id ? String(emp.structure_id) : '');
    setBaseSalary(emp.base_salary_cents ? String(emp.base_salary_cents / 100) : '');
    setCurrency(emp.currency || 'INR');
  }

  async function handleSaveAssignment(e) {
    e.preventDefault();
    if (!editingEmp) return;
    const empId = editingEmp.employee_id || editingEmp.id;
    if (!empId) {
      alert('Error: Employee ID could not be determined. Please refresh.');
      return;
    }
    const cents = Math.round(parseFloat(baseSalary || 0) * 100);
    if (!cents || isNaN(cents) || cents <= 0) {
      alert('Please enter a valid base monthly salary greater than 0.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/payroll/assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspaceId,
          employee_id: empId,
          structure_id: selectedStructureId ? Number(selectedStructureId) : null,
          base_salary_cents: cents,
          currency,
        }),
      });

      if (res.ok) {
        setEditingEmp(null);
        await loadData();
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to update salary assignment');
      }
    } catch (err) {
      alert(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      style={{
        background: '#ffffff',
        border: '1px solid #dfe1e6',
        borderRadius: '8px',
        boxShadow: '0 1px 3px rgba(9, 30, 66, 0.08)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '16px 20px',
          borderBottom: '1px solid #ebecf0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: '#fafbfc',
        }}
      >
        <div>
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#172b4d' }}>
            Employee Salary Assignments
          </h3>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#626f86' }}>
            Link active team members with salary structure templates and fixed monthly base compensation.
          </p>
        </div>
        <span
          style={{
            fontSize: '12px',
            fontWeight: 600,
            color: '#626f86',
            background: '#ebecf0',
            padding: '4px 10px',
            borderRadius: '12px',
          }}
        >
          {assignments.length} Total Team Members
        </span>
      </div>

      {loading ? (
        <div style={{ padding: '48px', textAlign: 'center', color: '#626f86', fontSize: '14px' }}>
          Loading employee salary assignments...
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: '#f4f5f7', color: '#626f86', borderBottom: '1px solid #dfe1e6' }}>
                <th style={{ padding: '12px 18px', fontWeight: 600, textTransform: 'uppercase', fontSize: '11px' }}>Employee</th>
                <th style={{ padding: '12px 18px', fontWeight: 600, textTransform: 'uppercase', fontSize: '11px' }}>Department & Role</th>
                <th style={{ padding: '12px 18px', fontWeight: 600, textTransform: 'uppercase', fontSize: '11px' }}>Assigned Template</th>
                <th style={{ padding: '12px 18px', fontWeight: 600, textTransform: 'uppercase', fontSize: '11px', textAlign: 'right' }}>Base Monthly Salary</th>
                <th style={{ padding: '12px 18px', fontWeight: 600, textTransform: 'uppercase', fontSize: '11px', textAlign: 'center' }}>Configuration</th>
                <th style={{ padding: '12px 18px', fontWeight: 600, textTransform: 'uppercase', fontSize: '11px', textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {assignments.map((emp) => {
                const name = emp.employee_name || emp.name || 'Employee';
                const initial = name.charAt(0).toUpperCase();
                const isConfigured = Boolean(emp.base_salary_cents && emp.base_salary_cents > 0);
                return (
                  <tr key={emp.employee_id || emp.id} style={{ borderBottom: '1px solid #ebecf0' }}>
                    <td style={{ padding: '12px 18px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div
                          style={{
                            width: '32px',
                            height: '32px',
                            borderRadius: '50%',
                            background: '#0c66e4',
                            color: '#ffffff',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontWeight: 700,
                            fontSize: '13px',
                          }}
                        >
                          {initial}
                        </div>
                        <div>
                          <div style={{ fontWeight: 600, color: '#172b4d', fontSize: '14px' }}>{name}</div>
                          <div style={{ fontSize: '12px', color: '#626f86' }}>{emp.employee_email || emp.email}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: '12px 18px' }}>
                      <div style={{ fontWeight: 500, color: '#172b4d' }}>{emp.department || 'General'}</div>
                      <div style={{ fontSize: '12px', color: '#626f86' }}>{emp.title || 'Team Member'}</div>
                    </td>
                    <td style={{ padding: '12px 18px' }}>
                      {emp.structure_name ? (
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '3px 8px',
                            borderRadius: '4px',
                            background: '#deebff',
                            color: '#0747a6',
                            fontWeight: 600,
                            fontSize: '11px',
                          }}
                        >
                          {emp.structure_name}
                        </span>
                      ) : (
                        <span style={{ color: '#626f86', fontStyle: 'italic', fontSize: '12px' }}>
                          Default (Basic Salary Only)
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '12px 18px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, fontSize: '14px', color: isConfigured ? '#172b4d' : '#626f86' }}>
                      {isConfigured
                        ? `₹${(emp.base_salary_cents / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
                        : 'Not Set'}
                    </td>
                    <td style={{ padding: '12px 18px', textAlign: 'center' }}>
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '2px 8px',
                          borderRadius: '10px',
                          fontSize: '11px',
                          fontWeight: 700,
                          background: isConfigured ? '#e3fcef' : '#fff0b3',
                          color: isConfigured ? '#006644' : '#172b4d',
                        }}
                      >
                        {isConfigured ? '✓ Configured' : 'Pending'}
                      </span>
                    </td>
                    <td style={{ padding: '12px 18px', textAlign: 'right' }}>
                      <button
                        type="button"
                        onClick={() => handleOpenAssignModal(emp)}
                        style={{
                          padding: '5px 12px',
                          background: '#ffffff',
                          border: '1px solid #dfe1e6',
                          borderRadius: '4px',
                          fontSize: '12px',
                          fontWeight: 600,
                          color: '#0c66e4',
                          cursor: 'pointer',
                        }}
                      >
                        {isConfigured ? 'Edit Details' : 'Configure'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal: Edit Salary Assignment */}
      {editingEmp && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(9, 30, 66, 0.54)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
          }}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: '8px',
              maxWidth: '460px',
              width: '100%',
              boxShadow: '0 8px 30px rgba(9, 30, 66, 0.25)',
              overflow: 'hidden',
            }}
          >
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #ebecf0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#172b4d' }}>Assign Employee Salary</h3>
                <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#626f86' }}>{editingEmp.employee_name || editingEmp.name}</p>
              </div>
              <button
                type="button"
                onClick={() => setEditingEmp(null)}
                style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: '#626f86' }}
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleSaveAssignment} style={{ padding: '20px' }}>
              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#42526e', marginBottom: '4px' }}>
                  Salary Structure Template
                </label>
                <select
                  value={selectedStructureId}
                  onChange={(e) => setSelectedStructureId(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid #dfe1e6', borderRadius: '4px', fontSize: '13px', boxSizing: 'border-box' }}
                >
                  <option value="">Default (Basic Pay Only)</option>
                  {structures.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.components?.length || 0} components)
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '10px', marginBottom: '20px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#42526e', marginBottom: '4px' }}>
                    Base Monthly Salary (₹) *
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="100"
                    required
                    placeholder="e.g. 50000"
                    value={baseSalary}
                    onChange={(e) => setBaseSalary(e.target.value)}
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid #dfe1e6', borderRadius: '4px', fontSize: '13px', fontFamily: 'monospace', boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#42526e', marginBottom: '4px' }}>
                    Currency
                  </label>
                  <select
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid #dfe1e6', borderRadius: '4px', fontSize: '13px', boxSizing: 'border-box' }}
                  >
                    <option value="INR">INR (₹)</option>
                    <option value="USD">USD ($)</option>
                    <option value="EUR">EUR (€)</option>
                    <option value="GBP">GBP (£)</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button
                  type="button"
                  onClick={() => setEditingEmp(null)}
                  style={{ padding: '8px 16px', background: '#f4f5f7', border: '1px solid #dfe1e6', borderRadius: '4px', fontSize: '13px', fontWeight: 600, color: '#42526e', cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  style={{ padding: '8px 18px', background: '#0c66e4', color: '#ffffff', border: 'none', borderRadius: '4px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', opacity: submitting ? 0.6 : 1 }}
                >
                  {submitting ? 'Saving...' : 'Save Salary'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

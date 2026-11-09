'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import PageHeader from '@/components/PageHeader';
import { BarChartIcon } from '@/components/AppShellIcons';
import SalaryStructuresView from './SalaryStructuresView';
import SalaryAssignmentsView from './SalaryAssignmentsView';
import PayslipsView from './PayslipsView';

export default function PayrollDashboard({ currentUser, workspaces = [], workspaceId = 1 }) {
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState(
    (workspaces && workspaces.length > 0) ? workspaces[0].id : workspaceId
  );
  const activeWorkspaceId = selectedWorkspaceId || workspaceId || 1;

  const [activeTab, setActiveTab] = useState('periods');
  const [periods, setPeriods] = useState([]);
  const [reports, setReports] = useState(null);
  const [loading, setLoading] = useState(true);

  // Modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [periodName, setPeriodName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [payDate, setPayDate] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    loadPayrollData();
  }, [activeWorkspaceId]);

  async function loadPayrollData() {
    setLoading(true);
    try {
      const [periodsRes, reportsRes] = await Promise.all([
        fetch(`/api/payroll/periods?workspaceId=${activeWorkspaceId}`),
        fetch(`/api/payroll/reports?workspaceId=${activeWorkspaceId}`),
      ]);
      const pData = await periodsRes.json();
      const rData = await reportsRes.json();
      setPeriods(pData.periods || []);
      setReports(rData);
    } catch (err) {
      console.error('Error loading payroll data:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreatePeriod(e) {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await fetch('/api/payroll/periods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: activeWorkspaceId,
          period_name: periodName,
          start_date: startDate,
          end_date: endDate,
          pay_date: payDate,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setShowCreateModal(false);
        setPeriodName('');
        setStartDate('');
        setEndDate('');
        setPayDate('');
        await loadPayrollData();
      } else {
        alert(data.error || 'Failed to create period');
      }
    } catch (err) {
      alert(err.message);
    } finally {
      setCreating(false);
    }
  }

  const summary = reports?.summary || {};

  const STATUS_STYLES = {
    draft: { bg: '#ebecf0', color: '#42526e', border: '#dfe1e6', label: 'Draft' },
    calculated: { bg: '#deebff', color: '#0747a6', border: '#b3d4ff', label: 'Calculated' },
    approved: { bg: '#eae6ff', color: '#403294', border: '#c0b6f2', label: 'Approved' },
    finalized: { bg: '#fffae6', color: '#ff8b00', border: '#ffe380', label: 'Finalized' },
    disbursed: { bg: '#e3fcef', color: '#006644', border: '#abf5d1', label: 'Disbursed' },
  };

  return (
    <div style={{ maxWidth: '1240px', margin: '0 auto', padding: '0 8px 48px' }}>
      {/* 1. Header with Breadcrumbs and Create CTA */}
      <PageHeader
        breadcrumb={[{ label: 'People', href: '/employees' }, { label: 'Payroll Management' }]}
        title="Payroll Management"
        icon={<BarChartIcon />}
        subtitle="Manage salary components, monthly payroll calculation, review & approvals, bank disbursement, and immutable payslips."
        actions={
          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 16px',
              background: '#0c66e4',
              color: '#ffffff',
              border: 'none',
              borderRadius: '6px',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              boxShadow: '0 1px 2px rgba(9, 30, 66, 0.15)',
              transition: 'background 0.15s ease',
            }}
          >
            + Create Payroll Period
          </button>
        }
      />

      {/* 2. Top Metric KPI Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: '16px',
          marginTop: '20px',
          marginBottom: '24px',
        }}
      >
        <div
          style={{
            background: '#ffffff',
            border: '1px solid #dfe1e6',
            borderRadius: '8px',
            padding: '18px 20px',
            boxShadow: '0 1px 3px rgba(9, 30, 66, 0.06)',
            borderLeft: '4px solid #36b37e',
          }}
        >
          <div style={{ fontSize: '12px', fontWeight: 700, color: '#626f86', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Total Disbursed
          </div>
          <div style={{ fontSize: '26px', fontWeight: 800, color: '#006644', marginTop: '6px' }}>
            ₹{((summary.disbursed_net_cents || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: '12px', color: '#626f86', marginTop: '4px' }}>
            Completed payouts across all periods
          </div>
        </div>

        <div
          style={{
            background: '#ffffff',
            border: '1px solid #dfe1e6',
            borderRadius: '8px',
            padding: '18px 20px',
            boxShadow: '0 1px 3px rgba(9, 30, 66, 0.06)',
            borderLeft: '4px solid #ffab00',
          }}
        >
          <div style={{ fontSize: '12px', fontWeight: 700, color: '#626f86', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Pending Disbursement
          </div>
          <div style={{ fontSize: '26px', fontWeight: 800, color: '#ff8b00', marginTop: '6px' }}>
            ₹{((summary.finalized_net_cents || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: '12px', color: '#626f86', marginTop: '4px' }}>
            Finalized periods locked for payout
          </div>
        </div>

        <div
          style={{
            background: '#ffffff',
            border: '1px solid #dfe1e6',
            borderRadius: '8px',
            padding: '18px 20px',
            boxShadow: '0 1px 3px rgba(9, 30, 66, 0.06)',
            borderLeft: '4px solid #0c66e4',
          }}
        >
          <div style={{ fontSize: '12px', fontWeight: 700, color: '#626f86', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Configured Employees
          </div>
          <div style={{ fontSize: '26px', fontWeight: 800, color: '#172b4d', marginTop: '6px' }}>
            {summary.employeesWithStructure || 0} <span style={{ fontSize: '16px', color: '#626f86', fontWeight: 500 }}>/ {summary.totalEmployees || 0}</span>
          </div>
          <div style={{ fontSize: '12px', color: '#626f86', marginTop: '4px' }}>
            Employees assigned to salary structures
          </div>
        </div>

        <div
          style={{
            background: '#ffffff',
            border: '1px solid #dfe1e6',
            borderRadius: '8px',
            padding: '18px 20px',
            boxShadow: '0 1px 3px rgba(9, 30, 66, 0.06)',
            borderLeft: '4px solid #6554c0',
          }}
        >
          <div style={{ fontSize: '12px', fontWeight: 700, color: '#626f86', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Active Periods
          </div>
          <div style={{ fontSize: '26px', fontWeight: 800, color: '#403294', marginTop: '6px' }}>
            {periods.length}
          </div>
          <div style={{ fontSize: '12px', color: '#626f86', marginTop: '4px' }}>
            Governed by 5-stage lifecycle
          </div>
        </div>
      </div>

      {/* 3. Section Tabs */}
      <div
        style={{
          display: 'flex',
          gap: '8px',
          borderBottom: '2px solid #ebecf0',
          marginBottom: '20px',
          overflowX: 'auto',
        }}
      >
        {[
          { id: 'periods', label: '📅 Payroll Cycles', count: periods.length },
          { id: 'assignments', label: '💼 Salary Assignments' },
          { id: 'structures', label: '⚙️ Structures & Components' },
          { id: 'payslips', label: '📄 Issued Payslips' },
          { id: 'audit', label: '📜 Audit Trail' },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '12px 18px',
              border: 'none',
              background: 'none',
              fontSize: '14px',
              fontWeight: activeTab === tab.id ? 700 : 500,
              cursor: 'pointer',
              color: activeTab === tab.id ? '#0c66e4' : '#626f86',
              borderBottom: activeTab === tab.id ? '2px solid #0c66e4' : '2px solid transparent',
              marginBottom: '-2px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              whiteSpace: 'nowrap',
              transition: 'all 0.15s ease',
            }}
          >
            {tab.label}
            {tab.count != null && (
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 700,
                  padding: '2px 7px',
                  borderRadius: '10px',
                  background: activeTab === tab.id ? '#deebff' : '#ebecf0',
                  color: activeTab === tab.id ? '#0747a6' : '#626f86',
                }}
              >
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* 4. Tab Content */}
      {activeTab === 'periods' && (
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
                Payroll Processing Cycles
              </h3>
              <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#626f86' }}>
                Strict 5-stage lifecycle: <span style={{ fontWeight: 600 }}>Draft → Calculated → Approved → Finalized → Disbursed</span>
              </p>
            </div>
            <button
              onClick={loadPayrollData}
              style={{
                fontSize: '12px',
                padding: '6px 12px',
                background: '#ffffff',
                border: '1px solid #dfe1e6',
                borderRadius: '4px',
                color: '#42526e',
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              ↻ Refresh
            </button>
          </div>

          {loading ? (
            <div style={{ padding: '48px', textAlign: 'center', color: '#626f86', fontSize: '14px' }}>
              Loading payroll periods...
            </div>
          ) : periods.length === 0 ? (
            <div style={{ padding: '64px 24px', textAlign: 'center' }}>
              <div style={{ fontSize: '36px', marginBottom: '12px' }}>🗓️</div>
              <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#172b4d' }}>No Payroll Periods Yet</h4>
              <p style={{ margin: '6px 0 20px', fontSize: '13px', color: '#626f86' }}>
                Create your first monthly payroll cycle to compute attendance-based salaries, earnings, and deductions.
              </p>
              <button
                type="button"
                onClick={() => setShowCreateModal(true)}
                style={{
                  padding: '8px 20px',
                  background: '#0c66e4',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                + Create Payroll Period
              </button>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                <thead>
                  <tr style={{ background: '#f4f5f7', color: '#626f86', borderBottom: '1px solid #dfe1e6' }}>
                    <th style={{ padding: '12px 18px', fontWeight: 600, textTransform: 'uppercase', fontSize: '11px' }}>Period Name</th>
                    <th style={{ padding: '12px 18px', fontWeight: 600, textTransform: 'uppercase', fontSize: '11px' }}>Duration</th>
                    <th style={{ padding: '12px 18px', fontWeight: 600, textTransform: 'uppercase', fontSize: '11px' }}>Pay Date</th>
                    <th style={{ padding: '12px 18px', fontWeight: 600, textTransform: 'uppercase', fontSize: '11px', textAlign: 'center' }}>Lifecycle Status</th>
                    <th style={{ padding: '12px 18px', fontWeight: 600, textTransform: 'uppercase', fontSize: '11px', textAlign: 'right' }}>Employees</th>
                    <th style={{ padding: '12px 18px', fontWeight: 600, textTransform: 'uppercase', fontSize: '11px', textAlign: 'right' }}>Net Take-Home</th>
                    <th style={{ padding: '12px 18px', fontWeight: 600, textTransform: 'uppercase', fontSize: '11px', textAlign: 'right' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {periods.map((p) => {
                    const st = STATUS_STYLES[p.status] || STATUS_STYLES.draft;
                    return (
                      <tr key={p.id} style={{ borderBottom: '1px solid #ebecf0' }}>
                        <td style={{ padding: '14px 18px' }}>
                          <Link
                            href={`/payroll/periods/${p.id}`}
                            style={{ fontWeight: 600, color: '#0c66e4', textDecoration: 'none', fontSize: '14px' }}
                          >
                            {p.period_name}
                          </Link>
                        </td>
                        <td style={{ padding: '14px 18px', fontFamily: 'monospace', color: '#42526e', fontSize: '12px' }}>
                          {p.start_date} → {p.end_date}
                        </td>
                        <td style={{ padding: '14px 18px', fontFamily: 'monospace', color: '#42526e', fontSize: '12px' }}>
                          {p.pay_date}
                        </td>
                        <td style={{ padding: '14px 18px', textAlign: 'center' }}>
                          <span
                            style={{
                              display: 'inline-block',
                              padding: '3px 10px',
                              borderRadius: '12px',
                              fontSize: '11px',
                              fontWeight: 700,
                              textTransform: 'uppercase',
                              background: st.bg,
                              color: st.color,
                              border: `1px solid ${st.border}`,
                            }}
                          >
                            {st.label}
                          </span>
                        </td>
                        <td style={{ padding: '14px 18px', textAlign: 'right', fontWeight: 600, color: '#172b4d' }}>
                          {p.record_count || 0}
                        </td>
                        <td style={{ padding: '14px 18px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: '#006644', fontSize: '14px' }}>
                          ₹{((p.total_net_cents || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </td>
                        <td style={{ padding: '14px 18px', textAlign: 'right' }}>
                          <Link
                            href={`/payroll/periods/${p.id}`}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              padding: '6px 14px',
                              background: '#f4f5f7',
                              color: '#0c66e4',
                              border: '1px solid #dfe1e6',
                              borderRadius: '4px',
                              fontSize: '12px',
                              fontWeight: 600,
                              textDecoration: 'none',
                              transition: 'all 0.15s ease',
                            }}
                          >
                            Process Cycle →
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Salary Assignments */}
      {activeTab === 'assignments' && <SalaryAssignmentsView workspaceId={activeWorkspaceId} />}

      {/* Tab 3: Salary Structures & Components */}
      {activeTab === 'structures' && <SalaryStructuresView workspaceId={activeWorkspaceId} />}

      {/* Tab 4: Generated Payslips */}
      {activeTab === 'payslips' && <PayslipsView />}

      {/* Tab 5: Audit Trail */}
      {activeTab === 'audit' && (
        <div
          style={{
            background: '#ffffff',
            border: '1px solid #dfe1e6',
            borderRadius: '8px',
            boxShadow: '0 1px 3px rgba(9, 30, 66, 0.08)',
            padding: '20px',
          }}
        >
          <div style={{ marginBottom: '16px' }}>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#172b4d' }}>
              Immutable Payroll Audit Trail
            </h3>
            <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#626f86' }}>
              Historical log recording calculations, approvals, finalizations, disbursements, and gateway reconciliations.
            </p>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
              <thead>
                <tr style={{ background: '#f4f5f7', color: '#626f86', borderBottom: '1px solid #dfe1e6' }}>
                  <th style={{ padding: '10px 14px', textTransform: 'uppercase', fontSize: '11px', textAlign: 'left' }}>Timestamp</th>
                  <th style={{ padding: '10px 14px', textTransform: 'uppercase', fontSize: '11px', textAlign: 'left' }}>Actor</th>
                  <th style={{ padding: '10px 14px', textTransform: 'uppercase', fontSize: '11px', textAlign: 'left' }}>Action Event</th>
                  <th style={{ padding: '10px 14px', textTransform: 'uppercase', fontSize: '11px', textAlign: 'left' }}>Target Entity</th>
                  <th style={{ padding: '10px 14px', textTransform: 'uppercase', fontSize: '11px', textAlign: 'left' }}>Event Details</th>
                </tr>
              </thead>
              <tbody>
                {(reports?.auditLogs || []).map((log) => (
                  <tr key={log.id} style={{ borderBottom: '1px solid #ebecf0' }}>
                    <td style={{ padding: '10px 14px', color: '#626f86', fontFamily: 'monospace' }}>
                      {new Date(log.created_at).toLocaleString()}
                    </td>
                    <td style={{ padding: '10px 14px', fontWeight: 600, color: '#172b4d' }}>
                      {log.actor_name || 'System / Gateway'}
                    </td>
                    <td style={{ padding: '10px 14px', fontWeight: 700, color: '#0c66e4' }}>
                      {log.action}
                    </td>
                    <td style={{ padding: '10px 14px', color: '#42526e', textTransform: 'capitalize' }}>
                      {log.entity_type} #{log.entity_id}
                    </td>
                    <td style={{ padding: '10px 14px', fontFamily: 'monospace', color: '#626f86', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {log.details_json}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Create Payroll Period Modal */}
      {showCreateModal && (
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
              maxWidth: '480px',
              width: '100%',
              boxShadow: '0 8px 30px rgba(9, 30, 66, 0.25)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                padding: '18px 24px',
                borderBottom: '1px solid #ebecf0',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#172b4d' }}>
                Create Payroll Cycle
              </h3>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: '#626f86' }}
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleCreatePeriod} style={{ padding: '24px' }}>
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#42526e', marginBottom: '6px' }}>
                  Period Title *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. November 2026 Payroll"
                  value={periodName}
                  onChange={(e) => setPeriodName(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    border: '1px solid #dfe1e6',
                    borderRadius: '4px',
                    fontSize: '14px',
                    color: '#172b4d',
                    boxSizing: 'border-box',
                    outline: 'none',
                  }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#42526e', marginBottom: '6px' }}>
                    Cycle Start Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      border: '1px solid #dfe1e6',
                      borderRadius: '4px',
                      fontSize: '13px',
                      color: '#172b4d',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#42526e', marginBottom: '6px' }}>
                    Cycle End Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      border: '1px solid #dfe1e6',
                      borderRadius: '4px',
                      fontSize: '13px',
                      color: '#172b4d',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
              </div>

              <div style={{ marginBottom: '24px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#42526e', marginBottom: '6px' }}>
                  Scheduled Pay Date *
                </label>
                <input
                  type="date"
                  required
                  value={payDate}
                  onChange={(e) => setPayDate(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    border: '1px solid #dfe1e6',
                    borderRadius: '4px',
                    fontSize: '13px',
                    color: '#172b4d',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  style={{
                    padding: '8px 16px',
                    background: '#f4f5f7',
                    border: '1px solid #dfe1e6',
                    borderRadius: '4px',
                    fontSize: '13px',
                    fontWeight: 600,
                    color: '#42526e',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  style={{
                    padding: '8px 20px',
                    background: '#0c66e4',
                    border: 'none',
                    borderRadius: '4px',
                    fontSize: '13px',
                    fontWeight: 600,
                    color: '#ffffff',
                    cursor: 'pointer',
                    opacity: creating ? 0.6 : 1,
                  }}
                >
                  {creating ? 'Creating Cycle...' : 'Create Draft Cycle'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

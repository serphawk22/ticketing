'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import PageHeader from '@/components/PageHeader';
import { BarChartIcon } from '@/components/AppShellIcons';

export default function PeriodDetailView({ periodId }) {
  const [period, setPeriod] = useState(null);
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [inspectRecord, setInspectRecord] = useState(null);
  const [payingRecord, setPayingRecord] = useState(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('bank_transfer');
  const [search, setSearch] = useState('');

  useEffect(() => {
    loadPeriod();
  }, [periodId]);

  async function loadPeriod() {
    setLoading(true);
    try {
      const res = await fetch(`/api/payroll/periods/${periodId}`);
      if (!res.ok) throw new Error('Failed to fetch period details');
      const data = await res.json();
      setPeriod(data.period);
      setRecords(data.records || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleLifecycleAction(endpoint, actionName) {
    if (!confirm(`Are you sure you want to ${actionName} this payroll period?`)) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/payroll/periods/${periodId}/${endpoint}`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || `Failed to ${actionName}`);
      } else {
        await loadPeriod();
      }
    } catch (err) {
      alert(err.message);
    } finally {
      setActionLoading(false);
    }
  }

  async function handleRecordPayment(e) {
    e.preventDefault();
    if (!payingRecord) return;
    setActionLoading(true);
    try {
      const res = await fetch('/api/payroll/payments/initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payroll_record_id: payingRecord.id,
          amount_cents: Math.round(parseFloat(paymentAmount) * 100),
          payment_method: paymentMethod,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setPayingRecord(null);
        await loadPeriod();
      } else {
        alert(data.error || 'Failed to record payment');
      }
    } catch (err) {
      alert(err.message);
    } finally {
      setActionLoading(false);
    }
  }

  const filteredRecords = useMemo(() => {
    if (!search.trim()) return records;
    const q = search.toLowerCase();
    return records.filter(
      (r) =>
        (r.employee_name && r.employee_name.toLowerCase().includes(q)) ||
        (r.department && r.department.toLowerCase().includes(q)) ||
        (r.title && r.title.toLowerCase().includes(q))
    );
  }, [records, search]);

  if (loading) {
    return (
      <div style={{ padding: '64px', textAlign: 'center', color: '#626f86', fontSize: '14px' }}>
        Loading payroll cycle data...
      </div>
    );
  }

  if (!period) {
    return (
      <div style={{ padding: '64px', textAlign: 'center', color: '#bf2600', fontSize: '14px' }}>
        Payroll cycle not found. <Link href="/payroll" style={{ color: '#0c66e4', marginLeft: '6px' }}>Return to Hub</Link>
      </div>
    );
  }

  const STAGES = [
    { key: 'draft', label: '1. Draft' },
    { key: 'calculated', label: '2. Calculated' },
    { key: 'approved', label: '3. Approved' },
    { key: 'finalized', label: '4. Finalized' },
    { key: 'disbursed', label: '5. Disbursed' },
  ];

  const currentStageIndex = STAGES.findIndex((s) => s.key === period.status);

  return (
    <div style={{ maxWidth: '1240px', margin: '0 auto', padding: '0 8px 48px' }}>
      {/* 1. Header with Breadcrumbs & Actions */}
      <PageHeader
        breadcrumb={[
          { label: 'People', href: '/employees' },
          { label: 'Payroll Management', href: '/payroll' },
          { label: period.period_name },
        ]}
        title={period.period_name}
        icon={<BarChartIcon />}
        subtitle={`Processing cycle for ${period.start_date} to ${period.end_date} • Scheduled pay date: ${period.pay_date}`}
        actions={
          <div style={{ display: 'flex', gap: '8px' }}>
            {period.status === 'draft' && (
              <button
                type="button"
                disabled={actionLoading}
                onClick={() => handleLifecycleAction('calculate', 'calculate')}
                style={{
                  padding: '8px 18px',
                  background: '#0c66e4',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  boxShadow: '0 1px 2px rgba(9, 30, 66, 0.15)',
                  opacity: actionLoading ? 0.6 : 1,
                }}
              >
                {actionLoading ? 'Calculating...' : '⚡ Run Calculation'}
              </button>
            )}

            {period.status === 'calculated' && (
              <>
                <button
                  type="button"
                  disabled={actionLoading}
                  onClick={() => handleLifecycleAction('recalculate', 'recalculate')}
                  style={{
                    padding: '8px 14px',
                    background: '#f4f5f7',
                    color: '#172b4d',
                    border: '1px solid #dfe1e6',
                    borderRadius: '6px',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  ↻ Recalculate
                </button>
                <button
                  type="button"
                  disabled={actionLoading}
                  onClick={() => handleLifecycleAction('approve', 'approve')}
                  style={{
                    padding: '8px 18px',
                    background: '#6554c0',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '6px',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  ✓ Approve Payroll
                </button>
              </>
            )}

            {period.status === 'approved' && (
              <button
                type="button"
                disabled={actionLoading}
                onClick={() => handleLifecycleAction('finalize', 'finalize and lock')}
                style={{
                  padding: '8px 18px',
                  background: '#ffab00',
                  color: '#172b4d',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '13px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                🔒 Finalize & Issue Payslips
              </button>
            )}

            {period.status === 'finalized' && (
              <button
                type="button"
                disabled={actionLoading}
                onClick={() => handleLifecycleAction('disburse', 'mark as fully disbursed')}
                style={{
                  padding: '8px 18px',
                  background: '#36b37e',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                ✓ Complete Payouts & Disburse
              </button>
            )}

            {period.status === 'disbursed' && (
              <span
                style={{
                  padding: '6px 14px',
                  background: '#e3fcef',
                  color: '#006644',
                  borderRadius: '6px',
                  fontSize: '13px',
                  fontWeight: 700,
                  border: '1px solid #abf5d1',
                }}
              >
                ✓ Fully Disbursed
              </span>
            )}
          </div>
        }
      />

      {/* 2. Visual 5-Stage Lifecycle Progress Tracker */}
      <div
        style={{
          background: '#ffffff',
          border: '1px solid #dfe1e6',
          borderRadius: '8px',
          padding: '16px 20px',
          marginTop: '16px',
          marginBottom: '20px',
          boxShadow: '0 1px 3px rgba(9, 30, 66, 0.06)',
        }}
      >
        <div style={{ fontSize: '11px', fontWeight: 700, color: '#626f86', textTransform: 'uppercase', marginBottom: '10px' }}>
          Lifecycle State Machine:
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflowX: 'auto' }}>
          {STAGES.map((st, i) => {
            const isCompleted = i < currentStageIndex;
            const isCurrent = i === currentStageIndex;
            return (
              <div key={st.key} style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 12px',
                    borderRadius: '20px',
                    fontSize: '12px',
                    fontWeight: isCurrent ? 700 : 500,
                    background: isCurrent ? '#0c66e4' : isCompleted ? '#e3fcef' : '#f4f5f7',
                    color: isCurrent ? '#ffffff' : isCompleted ? '#006644' : '#626f86',
                    border: `1px solid ${isCurrent ? '#0c66e4' : isCompleted ? '#abf5d1' : '#dfe1e6'}`,
                  }}
                >
                  {isCompleted ? '✓ ' : ''}
                  {st.label}
                </div>
                {i < STAGES.length - 1 && (
                  <span style={{ color: '#c1c7d0', fontSize: '14px', fontWeight: 700 }}>→</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 3. Cycle Metrics Summary */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '14px',
          marginBottom: '20px',
        }}
      >
        <div style={{ background: '#ffffff', border: '1px solid #dfe1e6', borderRadius: '8px', padding: '16px', boxShadow: '0 1px 2px rgba(9, 30, 66, 0.04)' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: '#626f86', textTransform: 'uppercase' }}>Employees in Cycle</div>
          <div style={{ fontSize: '24px', fontWeight: 800, color: '#172b4d', marginTop: '4px' }}>{records.length}</div>
        </div>

        <div style={{ background: '#ffffff', border: '1px solid #dfe1e6', borderRadius: '8px', padding: '16px', boxShadow: '0 1px 2px rgba(9, 30, 66, 0.04)' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: '#626f86', textTransform: 'uppercase' }}>Total Gross Earnings</div>
          <div style={{ fontSize: '24px', fontWeight: 800, color: '#172b4d', marginTop: '4px' }}>
            ₹{((period.total_gross_cents || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </div>
        </div>

        <div style={{ background: '#ffffff', border: '1px solid #dfe1e6', borderRadius: '8px', padding: '16px', boxShadow: '0 1px 2px rgba(9, 30, 66, 0.04)' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: '#626f86', textTransform: 'uppercase' }}>Total Deductions</div>
          <div style={{ fontSize: '24px', fontWeight: 800, color: '#bf2600', marginTop: '4px' }}>
            ₹{((period.total_deductions_cents || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </div>
        </div>

        <div style={{ background: '#e3fcef', border: '1px solid #abf5d1', borderRadius: '8px', padding: '16px', boxShadow: '0 1px 2px rgba(9, 30, 66, 0.04)' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: '#006644', textTransform: 'uppercase' }}>Net Take-Home Payout</div>
          <div style={{ fontSize: '24px', fontWeight: 800, color: '#006644', marginTop: '4px' }}>
            ₹{((period.total_net_cents || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </div>
        </div>
      </div>

      {/* 4. Payroll Register Table */}
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
            padding: '14px 20px',
            borderBottom: '1px solid #ebecf0',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: '#fafbfc',
            flexWrap: 'wrap',
            gap: '10px',
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#172b4d' }}>
              Payroll Register & Employee Ledger
            </h3>
            <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#626f86' }}>
              Itemized breakdown with attendance proration, allowances, deductions, and payout statuses.
            </p>
          </div>
          <input
            type="text"
            placeholder="Search employee or department..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              padding: '6px 12px',
              border: '1px solid #dfe1e6',
              borderRadius: '4px',
              fontSize: '13px',
              width: '240px',
              outline: 'none',
            }}
          />
        </div>

        {records.length === 0 ? (
          <div style={{ padding: '64px', textAlign: 'center', color: '#626f86' }}>
            <div style={{ fontSize: '32px', marginBottom: '8px' }}>⚙️</div>
            <h4 style={{ margin: 0, fontSize: '15px', color: '#172b4d' }}>No Calculation Generated Yet</h4>
            <p style={{ margin: '4px 0 16px', fontSize: '13px' }}>
              Click "⚡ Run Calculation" above to compute wages from attendance and salary structures.
            </p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
              <thead>
                <tr style={{ background: '#f4f5f7', color: '#626f86', borderBottom: '1px solid #dfe1e6' }}>
                  <th style={{ padding: '10px 14px', fontWeight: 600, textTransform: 'uppercase', fontSize: '11px' }}>Employee</th>
                  <th style={{ padding: '10px 14px', fontWeight: 600, textTransform: 'uppercase', fontSize: '11px', textAlign: 'center' }}>Paid / Work</th>
                  <th style={{ padding: '10px 14px', fontWeight: 600, textTransform: 'uppercase', fontSize: '11px', textAlign: 'center' }}>LOP</th>
                  <th style={{ padding: '10px 14px', fontWeight: 600, textTransform: 'uppercase', fontSize: '11px', textAlign: 'right' }}>Base Pay</th>
                  <th style={{ padding: '10px 14px', fontWeight: 600, textTransform: 'uppercase', fontSize: '11px', textAlign: 'right' }}>Gross Pay</th>
                  <th style={{ padding: '10px 14px', fontWeight: 600, textTransform: 'uppercase', fontSize: '11px', textAlign: 'right' }}>Deductions</th>
                  <th style={{ padding: '10px 14px', fontWeight: 600, textTransform: 'uppercase', fontSize: '11px', textAlign: 'right' }}>Net Take-Home</th>
                  <th style={{ padding: '10px 14px', fontWeight: 600, textTransform: 'uppercase', fontSize: '11px', textAlign: 'center' }}>Payout Status</th>
                  <th style={{ padding: '10px 14px', fontWeight: 600, textTransform: 'uppercase', fontSize: '11px', textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredRecords.map((rec) => (
                  <tr key={rec.id} style={{ borderBottom: '1px solid #ebecf0' }}>
                    <td style={{ padding: '12px 14px' }}>
                      <div style={{ fontWeight: 600, color: '#172b4d' }}>{rec.employee_name}</div>
                      <div style={{ fontSize: '11px', color: '#626f86' }}>{rec.department || 'General'}</div>
                    </td>
                    <td style={{ padding: '12px 14px', textAlign: 'center', fontFamily: 'monospace', fontSize: '12px', color: '#42526e' }}>
                      {rec.paid_days} / {rec.working_days}
                    </td>
                    <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                      {rec.lop_days > 0 ? (
                        <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 6px', borderRadius: '4px', background: '#ffebe6', color: '#bf2600' }}>
                          {rec.lop_days} d
                        </span>
                      ) : (
                        <span style={{ color: '#c1c7d0' }}>-</span>
                      )}
                    </td>
                    <td style={{ padding: '12px 14px', textAlign: 'right', fontFamily: 'monospace', color: '#42526e', fontSize: '12px' }}>
                      ₹{(rec.base_salary_cents / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td style={{ padding: '12px 14px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: '#172b4d', fontSize: '13px' }}>
                      ₹{(rec.gross_pay_cents / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td style={{ padding: '12px 14px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: '#bf2600', fontSize: '13px' }}>
                      ₹{(rec.total_deductions_cents / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td style={{ padding: '12px 14px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 800, color: '#006644', fontSize: '14px' }}>
                      ₹{(rec.net_pay_cents / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '2px 8px',
                          borderRadius: '10px',
                          fontSize: '11px',
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          background: rec.payment_status === 'paid' ? '#e3fcef' : rec.payment_status === 'partially_paid' ? '#fff0b3' : '#ebecf0',
                          color: rec.payment_status === 'paid' ? '#006644' : rec.payment_status === 'partially_paid' ? '#172b4d' : '#626f86',
                        }}
                      >
                        {rec.payment_status.replace('_', ' ')}
                      </span>
                    </td>
                    <td style={{ padding: '12px 14px', textAlign: 'right' }}>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px' }}>
                        <button
                          type="button"
                          onClick={() => setInspectRecord(rec)}
                          style={{
                            padding: '4px 10px',
                            background: '#f4f5f7',
                            border: '1px solid #dfe1e6',
                            borderRadius: '4px',
                            fontSize: '12px',
                            fontWeight: 600,
                            color: '#0c66e4',
                            cursor: 'pointer',
                          }}
                        >
                          Breakdown
                        </button>
                        {(period.status === 'finalized' || period.status === 'disbursed') && rec.payment_status !== 'paid' && (
                          <button
                            type="button"
                            onClick={() => {
                              setPayingRecord(rec);
                              const rem = (rec.net_pay_cents - (rec.total_paid_cents || 0)) / 100;
                              setPaymentAmount(String(rem));
                            }}
                            style={{
                              padding: '4px 10px',
                              background: '#36b37e',
                              color: '#ffffff',
                              border: 'none',
                              borderRadius: '4px',
                              fontSize: '12px',
                              fontWeight: 600,
                              cursor: 'pointer',
                            }}
                          >
                            Pay
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Breakdown Modal */}
      {inspectRecord && (
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
              maxWidth: '520px',
              width: '100%',
              boxShadow: '0 8px 30px rgba(9, 30, 66, 0.25)',
              overflow: 'hidden',
            }}
          >
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #ebecf0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#172b4d' }}>{inspectRecord.employee_name}</h3>
                <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#626f86' }}>Itemized Compensation Breakdown</p>
              </div>
              <button
                type="button"
                onClick={() => setInspectRecord(null)}
                style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: '#626f86' }}
              >
                &times;
              </button>
            </div>

            <div style={{ padding: '20px', maxHeight: '70vh', overflowY: 'auto' }}>
              {/* Earnings */}
              <div style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#006644', textTransform: 'uppercase', marginBottom: '6px' }}>
                  Gross Earnings & Allowances
                </div>
                <div style={{ border: '1px solid #ebecf0', borderRadius: '6px', padding: '8px 12px', background: '#fafbfc' }}>
                  {(inspectRecord.earnings || []).map((e, idx) => (
                    <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', padding: '4px 0', borderBottom: '1px dashed #ebecf0' }}>
                      <span style={{ color: '#172b4d', fontWeight: 500 }}>{e.name}</span>
                      <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>₹{(e.amount_cents / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                    </div>
                  ))}
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', fontWeight: 700, paddingTop: '6px', color: '#172b4d' }}>
                    <span>Total Earnings</span>
                    <span style={{ fontFamily: 'monospace' }}>₹{(inspectRecord.gross_pay_cents / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                  </div>
                </div>
              </div>

              {/* Deductions */}
              <div style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#bf2600', textTransform: 'uppercase', marginBottom: '6px' }}>
                  Statutory Deductions & Taxes
                </div>
                <div style={{ border: '1px solid #ebecf0', borderRadius: '6px', padding: '8px 12px', background: '#fafbfc' }}>
                  {(inspectRecord.deductions || []).map((d, idx) => (
                    <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', padding: '4px 0', borderBottom: '1px dashed #ebecf0' }}>
                      <span style={{ color: '#172b4d', fontWeight: 500 }}>{d.name}</span>
                      <span style={{ fontFamily: 'monospace', fontWeight: 600, color: '#bf2600' }}>₹{(d.amount_cents / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                    </div>
                  ))}
                  {(!inspectRecord.deductions || inspectRecord.deductions.length === 0) && (
                    <div style={{ fontSize: '12px', color: '#626f86', fontStyle: 'italic', padding: '4px 0' }}>No deductions for this record.</div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', fontWeight: 700, paddingTop: '6px', color: '#bf2600' }}>
                    <span>Total Deductions</span>
                    <span style={{ fontFamily: 'monospace' }}>₹{(inspectRecord.total_deductions_cents / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                  </div>
                </div>
              </div>

              {/* Net Take-Home Box */}
              <div
                style={{
                  padding: '14px 18px',
                  background: '#e3fcef',
                  border: '1px solid #abf5d1',
                  borderRadius: '6px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div style={{ fontSize: '13px', fontWeight: 700, color: '#006644' }}>Net Take-Home Pay</div>
                <div style={{ fontSize: '20px', fontFamily: 'monospace', fontWeight: 800, color: '#006644' }}>
                  ₹{(inspectRecord.net_pay_cents / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </div>
              </div>
            </div>

            <div style={{ padding: '12px 20px', background: '#f4f5f7', borderTop: '1px solid #ebecf0', display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setInspectRecord(null)}
                style={{ padding: '6px 16px', background: '#ffffff', border: '1px solid #dfe1e6', borderRadius: '4px', fontSize: '13px', fontWeight: 600, color: '#42526e', cursor: 'pointer' }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Record Payment Modal */}
      {payingRecord && (
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
              maxWidth: '440px',
              width: '100%',
              boxShadow: '0 8px 30px rgba(9, 30, 66, 0.25)',
              overflow: 'hidden',
            }}
          >
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #ebecf0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#172b4d' }}>Disburse Salary Payout</h3>
                <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#626f86' }}>{payingRecord.employee_name}</p>
              </div>
              <button
                type="button"
                onClick={() => setPayingRecord(null)}
                style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: '#626f86' }}
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleRecordPayment} style={{ padding: '20px' }}>
              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#42526e', marginBottom: '4px' }}>
                  Payout Amount (₹) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid #dfe1e6', borderRadius: '4px', fontSize: '14px', fontFamily: 'monospace', boxSizing: 'border-box' }}
                />
              </div>

              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#42526e', marginBottom: '4px' }}>
                  Disbursement Method
                </label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid #dfe1e6', borderRadius: '4px', fontSize: '13px', boxSizing: 'border-box' }}
                >
                  <option value="bank_transfer">Bank Transfer (NEFT / RTGS / IMPS)</option>
                  <option value="upi">UPI Auto-Payout</option>
                  <option value="cheque">Company Cheque</option>
                  <option value="cash">Direct Cash Voucher</option>
                </select>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button
                  type="button"
                  onClick={() => setPayingRecord(null)}
                  style={{ padding: '8px 16px', background: '#f4f5f7', border: '1px solid #dfe1e6', borderRadius: '4px', fontSize: '13px', fontWeight: 600, color: '#42526e', cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  style={{ padding: '8px 18px', background: '#36b37e', color: '#ffffff', border: 'none', borderRadius: '4px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', opacity: actionLoading ? 0.6 : 1 }}
                >
                  {actionLoading ? 'Recording...' : 'Record Payout'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

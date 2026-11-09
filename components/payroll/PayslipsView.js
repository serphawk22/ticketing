'use client';

import { useState, useEffect, useMemo } from 'react';

export default function PayslipsView({ employeeId = null }) {
  const [payslips, setPayslips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    loadPayslips();
  }, [employeeId]);

  async function loadPayslips() {
    setLoading(true);
    try {
      const url = employeeId
        ? `/api/payroll/payslips?employeeId=${employeeId}`
        : '/api/payroll/payslips';
      const res = await fetch(url);
      const data = await res.json();
      setPayslips(data.payslips || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  function handleOpenPrint(payslipId) {
    window.open(`/api/payroll/payslips/${payslipId}?format=html`, '_blank');
  }

  const filtered = useMemo(() => {
    if (!search.trim()) return payslips;
    const q = search.toLowerCase();
    return payslips.filter(
      (p) =>
        (p.payslip_number && p.payslip_number.toLowerCase().includes(q)) ||
        (p.employee_name && p.employee_name.toLowerCase().includes(q)) ||
        (p.period_name && p.period_name.toLowerCase().includes(q))
    );
  }, [payslips, search]);

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
          flexWrap: 'wrap',
          gap: '10px',
        }}
      >
        <div>
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#172b4d' }}>
            Issued Immutable Payslips
          </h3>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#626f86' }}>
            Point-in-time salary certificates with itemized earnings, statutory tax deductions, and net take-home pay.
          </p>
        </div>
        <input
          type="text"
          placeholder="Filter payslip # or employee..."
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

      {loading ? (
        <div style={{ padding: '48px', textAlign: 'center', color: '#626f86', fontSize: '14px' }}>
          Loading payslip records...
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: '64px', textAlign: 'center', color: '#626f86' }}>
          <div style={{ fontSize: '32px', marginBottom: '8px' }}>📄</div>
          <h4 style={{ margin: 0, fontSize: '15px', color: '#172b4d' }}>No Payslips Available</h4>
          <p style={{ margin: '4px 0 0', fontSize: '13px' }}>
            Payslips are automatically generated and versioned when a payroll period is transitioned to <strong>Finalized</strong>.
          </p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: '#f4f5f7', color: '#626f86', borderBottom: '1px solid #dfe1e6' }}>
                <th style={{ padding: '12px 18px', fontWeight: 600, textTransform: 'uppercase', fontSize: '11px' }}>Payslip #</th>
                <th style={{ padding: '12px 18px', fontWeight: 600, textTransform: 'uppercase', fontSize: '11px' }}>Employee</th>
                <th style={{ padding: '12px 18px', fontWeight: 600, textTransform: 'uppercase', fontSize: '11px' }}>Payroll Cycle</th>
                <th style={{ padding: '12px 18px', fontWeight: 600, textTransform: 'uppercase', fontSize: '11px' }}>Pay Date</th>
                <th style={{ padding: '12px 18px', fontWeight: 600, textTransform: 'uppercase', fontSize: '11px', textAlign: 'right' }}>Net Take-Home</th>
                <th style={{ padding: '12px 18px', fontWeight: 600, textTransform: 'uppercase', fontSize: '11px', textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((slip) => (
                <tr key={slip.id} style={{ borderBottom: '1px solid #ebecf0' }}>
                  <td style={{ padding: '12px 18px', fontFamily: 'monospace', fontWeight: 700, color: '#0c66e4', fontSize: '13px' }}>
                    {slip.payslip_number}
                  </td>
                  <td style={{ padding: '12px 18px' }}>
                    <div style={{ fontWeight: 600, color: '#172b4d' }}>{slip.employee_name}</div>
                    <div style={{ fontSize: '11px', color: '#626f86' }}>{slip.employee_email}</div>
                  </td>
                  <td style={{ padding: '12px 18px', color: '#172b4d', fontWeight: 500 }}>
                    {slip.period_name}
                  </td>
                  <td style={{ padding: '12px 18px', fontFamily: 'monospace', color: '#626f86', fontSize: '12px' }}>
                    {slip.pay_date}
                  </td>
                  <td style={{ padding: '12px 18px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 800, color: '#006644', fontSize: '14px' }}>
                    ₹{((slip.net_pay_cents || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </td>
                  <td style={{ padding: '12px 18px', textAlign: 'right' }}>
                    <button
                      type="button"
                      onClick={() => handleOpenPrint(slip.id)}
                      style={{
                        padding: '6px 14px',
                        background: '#deebff',
                        color: '#0747a6',
                        border: '1px solid #b3d4ff',
                        borderRadius: '4px',
                        fontSize: '12px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        transition: 'background 0.15s ease',
                      }}
                    >
                      🖨️ View / Print Payslip
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

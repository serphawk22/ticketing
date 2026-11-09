'use client';

import { useState, useEffect, useMemo } from 'react';
import PageHeader from '@/components/PageHeader';
import { ClipboardIcon } from '@/components/AppShellIcons';

export default function MyPayslipsView({ employeeId = null }) {
  const [payslips, setPayslips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [previewSlip, setPreviewSlip] = useState(null);
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
      console.error('Failed to load payslips:', err);
    } finally {
      setLoading(false);
    }
  }

  function handleOpenPrint(payslipId) {
    window.open(`/api/payroll/payslips/${payslipId}?format=html`, '_blank');
  }

  // Compute personal metrics
  const stats = useMemo(() => {
    if (!payslips || payslips.length === 0) {
      return { latest: 0, ytdNet: 0, totalSlips: 0, latestPeriod: 'N/A', latestPayDate: 'N/A' };
    }
    const latest = payslips[0];
    const totalNet = payslips.reduce((sum, p) => sum + (p.net_pay_cents || 0), 0);
    return {
      latest: (latest.net_pay_cents || 0) / 100,
      latestPeriod: latest.period_name || 'Latest Cycle',
      latestPayDate: latest.pay_date || 'N/A',
      ytdNet: totalNet / 100,
      totalSlips: payslips.length,
    };
  }, [payslips]);

  const filtered = useMemo(() => {
    if (!search.trim()) return payslips;
    const q = search.toLowerCase();
    return payslips.filter(
      (p) =>
        (p.payslip_number && p.payslip_number.toLowerCase().includes(q)) ||
        (p.period_name && p.period_name.toLowerCase().includes(q))
    );
  }, [payslips, search]);

  return (
    <div style={{ maxWidth: '1240px', margin: '0 auto', padding: '0 8px 48px' }}>
      {/* 1. Page Header */}
      <PageHeader
        breadcrumb={[{ label: 'Dashboard', href: '/my-dashboard' }, { label: 'My Salary Slips' }]}
        title="My Salary Slips & Remuneration"
        icon={<ClipboardIcon />}
        subtitle="Access, inspect and download your certified monthly payslips, statutory deductions, and tax summaries."
      />

      {/* 2. Personal Compensation Highlights */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: '16px',
          marginTop: '16px',
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
          <div style={{ fontSize: '11px', fontWeight: 700, color: '#626f86', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Latest Disbursed Salary
          </div>
          <div style={{ fontSize: '26px', fontWeight: 800, color: '#006644', marginTop: '6px', fontFamily: 'monospace' }}>
            ₹{stats.latest.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: '12px', color: '#626f86', marginTop: '4px' }}>
            {stats.latestPeriod} • Paid on {stats.latestPayDate}
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
          <div style={{ fontSize: '11px', fontWeight: 700, color: '#626f86', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Cumulative Net Remuneration
          </div>
          <div style={{ fontSize: '26px', fontWeight: 800, color: '#0c66e4', marginTop: '6px', fontFamily: 'monospace' }}>
            ₹{stats.ytdNet.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: '12px', color: '#626f86', marginTop: '4px' }}>
            Total net take-home received across cycles
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
          <div style={{ fontSize: '11px', fontWeight: 700, color: '#626f86', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Certified Salary Slips
          </div>
          <div style={{ fontSize: '26px', fontWeight: 800, color: '#403294', marginTop: '6px' }}>
            {stats.totalSlips}
          </div>
          <div style={{ fontSize: '12px', color: '#626f86', marginTop: '4px' }}>
            Available for official PDF download
          </div>
        </div>
      </div>

      {/* 3. Payslips Directory Card */}
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
            gap: '12px',
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#172b4d' }}>
              Your Official Payslip Archive
            </h3>
            <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#626f86' }}>
              Click <strong>Preview</strong> for an instant breakdown or <strong>Download Official PDF</strong> for bank, visa, or loan verification.
            </p>
          </div>
          <input
            type="text"
            placeholder="Search month or payslip #..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              padding: '6px 14px',
              border: '1px solid #dfe1e6',
              borderRadius: '4px',
              fontSize: '13px',
              width: '260px',
              outline: 'none',
            }}
          />
        </div>

        {loading ? (
          <div style={{ padding: '64px', textAlign: 'center', color: '#626f86', fontSize: '14px' }}>
            Loading your salary slips...
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: '64px 20px', textAlign: 'center', color: '#626f86' }}>
            <div style={{ fontSize: '36px', marginBottom: '8px' }}>📄</div>
            <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#172b4d' }}>No Payslips Found</h4>
            <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#626f86' }}>
              Your salary slips will be issued and appear here as soon as HR/Finance finalizes the monthly payroll cycle.
            </p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
              <thead>
                <tr style={{ background: '#f4f5f7', color: '#626f86', borderBottom: '1px solid #dfe1e6' }}>
                  <th style={{ padding: '12px 18px', fontWeight: 600, textTransform: 'uppercase', fontSize: '11px' }}>Payslip Reference #</th>
                  <th style={{ padding: '12px 18px', fontWeight: 600, textTransform: 'uppercase', fontSize: '11px' }}>Salary Cycle</th>
                  <th style={{ padding: '12px 18px', fontWeight: 600, textTransform: 'uppercase', fontSize: '11px' }}>Pay Date</th>
                  <th style={{ padding: '12px 18px', fontWeight: 600, textTransform: 'uppercase', fontSize: '11px', textAlign: 'right' }}>Net Take-Home Pay</th>
                  <th style={{ padding: '12px 18px', fontWeight: 600, textTransform: 'uppercase', fontSize: '11px', textAlign: 'center' }}>Certificate Status</th>
                  <th style={{ padding: '12px 18px', fontWeight: 600, textTransform: 'uppercase', fontSize: '11px', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((slip) => (
                  <tr key={slip.id} style={{ borderBottom: '1px solid #ebecf0' }}>
                    <td style={{ padding: '14px 18px', fontFamily: 'monospace', fontWeight: 700, color: '#0c66e4', fontSize: '13px' }}>
                      {slip.payslip_number}
                    </td>
                    <td style={{ padding: '14px 18px', fontWeight: 600, color: '#172b4d' }}>
                      {slip.period_name}
                    </td>
                    <td style={{ padding: '14px 18px', fontFamily: 'monospace', color: '#42526e', fontSize: '12px' }}>
                      {slip.pay_date}
                    </td>
                    <td style={{ padding: '14px 18px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 800, color: '#006644', fontSize: '15px' }}>
                      ₹{((slip.net_pay_cents || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td style={{ padding: '14px 18px', textAlign: 'center' }}>
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '2px 8px',
                          borderRadius: '10px',
                          fontSize: '11px',
                          fontWeight: 700,
                          background: '#e3fcef',
                          color: '#006644',
                        }}
                      >
                        ✓ Certified
                      </span>
                    </td>
                    <td style={{ padding: '14px 18px', textAlign: 'right' }}>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              const r = await fetch(`/api/payroll/payslips/${slip.id}`);
                              const data = await r.json();
                              setPreviewSlip(data.payslip?.payload || null);
                            } catch (e) {
                              alert('Failed to load payslip preview: ' + e.message);
                            }
                          }}
                          style={{
                            padding: '6px 12px',
                            background: '#f4f5f7',
                            border: '1px solid #dfe1e6',
                            borderRadius: '4px',
                            fontSize: '12px',
                            fontWeight: 600,
                            color: '#172b4d',
                            cursor: 'pointer',
                          }}
                        >
                          👁️ Quick View
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenPrint(slip.id)}
                          style={{
                            padding: '6px 14px',
                            background: '#0c66e4',
                            border: 'none',
                            borderRadius: '4px',
                            fontSize: '12px',
                            fontWeight: 600,
                            color: '#ffffff',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                          }}
                        >
                          🖨️ PDF / Print
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 4. Interactive In-App Quick View Modal */}
      {previewSlip && (
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
              maxWidth: '680px',
              width: '100%',
              boxShadow: '0 8px 30px rgba(9, 30, 66, 0.25)',
              maxHeight: '90vh',
              overflowY: 'auto',
            }}
          >
            {/* Modal Header */}
            <div
              style={{
                padding: '16px 24px',
                borderBottom: '1px solid #ebecf0',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                background: '#fafbfc',
              }}
            >
              <div>
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#172b4d' }}>
                  Salary Slip — {previewSlip.period.name}
                </h3>
                <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#626f86', fontFamily: 'monospace' }}>
                  Reference: {previewSlip.payslipNumber}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewSlip(null)}
                style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: '#626f86' }}
              >
                &times;
              </button>
            </div>

            {/* Modal Body */}
            <div style={{ padding: '24px' }}>
              {/* Employee Particulars Grid */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '12px',
                  background: '#f4f5f7',
                  padding: '14px 16px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  marginBottom: '20px',
                }}
              >
                <div>
                  <div style={{ color: '#5e6c84' }}>Employee Name:</div>
                  <div style={{ fontWeight: 700, color: '#172b4d', fontSize: '13px' }}>{previewSlip.employee.name}</div>
                  <div style={{ color: '#5e6c84', marginTop: '6px' }}>Designation:</div>
                  <div style={{ fontWeight: 600, color: '#172b4d' }}>{previewSlip.employee.title}</div>
                  <div style={{ color: '#5e6c84', marginTop: '6px' }}>Department:</div>
                  <div style={{ fontWeight: 600, color: '#172b4d' }}>{previewSlip.employee.department}</div>
                </div>
                <div>
                  <div style={{ color: '#5e6c84' }}>Bank Account:</div>
                  <div style={{ fontWeight: 600, color: '#172b4d', fontFamily: 'monospace' }}>
                    {previewSlip.employee.bankName} ({previewSlip.employee.accountNumberMasked})
                  </div>
                  <div style={{ color: '#5e6c84', marginTop: '6px' }}>Days Worked:</div>
                  <div style={{ fontWeight: 700, color: '#006644' }}>
                    {previewSlip.attendance.paidDays} of {previewSlip.attendance.workingDays} Days
                  </div>
                  <div style={{ color: '#5e6c84', marginTop: '6px' }}>Loss of Pay (LOP):</div>
                  <div style={{ fontWeight: 700, color: previewSlip.attendance.lopDays > 0 ? '#bf2600' : '#42526e' }}>
                    {previewSlip.attendance.lopDays} Days
                  </div>
                </div>
              </div>

              {/* Side-by-Side Breakdown */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>
                {/* Earnings */}
                <div style={{ border: '1px solid #dfe1e6', borderRadius: '6px', overflow: 'hidden' }}>
                  <div style={{ background: '#deebff', color: '#0747a6', padding: '8px 12px', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' }}>
                    Earnings
                  </div>
                  <div style={{ padding: '8px 12px' }}>
                    {(previewSlip.earnings || []).map((e, idx) => (
                      <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', padding: '4px 0', borderBottom: '1px dashed #ebecf0' }}>
                        <span>{e.name}</span>
                        <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>₹{(e.amountCents / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                      </div>
                    ))}
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', fontWeight: 800, color: '#006644', paddingTop: '8px' }}>
                      <span>Gross Earnings</span>
                      <span style={{ fontFamily: 'monospace' }}>₹{(previewSlip.financials.grossPayCents / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                    </div>
                  </div>
                </div>

                {/* Deductions */}
                <div style={{ border: '1px solid #dfe1e6', borderRadius: '6px', overflow: 'hidden' }}>
                  <div style={{ background: '#ffebe6', color: '#bf2600', padding: '8px 12px', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' }}>
                    Deductions
                  </div>
                  <div style={{ padding: '8px 12px' }}>
                    {(previewSlip.deductions || []).map((d, idx) => (
                      <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', padding: '4px 0', borderBottom: '1px dashed #ebecf0' }}>
                        <span>{d.name}</span>
                        <span style={{ fontFamily: 'monospace', fontWeight: 600, color: '#bf2600' }}>₹{(d.amountCents / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                      </div>
                    ))}
                    {(!previewSlip.deductions || previewSlip.deductions.length === 0) && (
                      <div style={{ fontSize: '12px', color: '#626f86', fontStyle: 'italic', padding: '4px 0' }}>No deductions recorded</div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', fontWeight: 800, color: '#bf2600', paddingTop: '8px' }}>
                      <span>Total Deductions</span>
                      <span style={{ fontFamily: 'monospace' }}>₹{(previewSlip.financials.totalDeductionsCents / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Net Remuneration Box */}
              <div
                style={{
                  background: '#e3fcef',
                  border: '2px solid #36b37e',
                  borderRadius: '6px',
                  padding: '14px 20px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div>
                  <div style={{ fontSize: '12px', fontWeight: 800, color: '#006644', textTransform: 'uppercase' }}>
                    Net Take-Home Pay
                  </div>
                  <div style={{ fontSize: '11px', color: '#006644', fontStyle: 'italic', marginTop: '2px' }}>
                    {previewSlip.financials.netPayWords || 'Authorized Corporate Payout'}
                  </div>
                </div>
                <div style={{ fontSize: '24px', fontWeight: 800, color: '#006644', fontFamily: 'monospace' }}>
                  ₹{(previewSlip.financials.netPayCents / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </div>
              </div>
            </div>

            {/* Modal Actions */}
            <div
              style={{
                padding: '14px 24px',
                background: '#f4f5f7',
                borderTop: '1px solid #ebecf0',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <button
                type="button"
                onClick={() => setPreviewSlip(null)}
                style={{
                  padding: '8px 16px',
                  background: '#ffffff',
                  border: '1px solid #dfe1e6',
                  borderRadius: '4px',
                  fontSize: '13px',
                  fontWeight: 600,
                  color: '#42526e',
                  cursor: 'pointer',
                }}
              >
                Close Preview
              </button>

              <button
                type="button"
                onClick={() => {
                  const currentSlip = payslips.find((p) => p.payslip_number === previewSlip.payslipNumber);
                  if (currentSlip) handleOpenPrint(currentSlip.id);
                }}
                style={{
                  padding: '8px 20px',
                  background: '#0c66e4',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '4px',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                🖨️ Download Official PDF / Print
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

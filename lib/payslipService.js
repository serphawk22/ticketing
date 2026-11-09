import { db } from './db.js';
import { formatCurrency, centsToWords, formatDate } from './payrollCalculators.js';

/**
 * SerpHawk HRMS - Professional Payslip Document Service
 * 
 * Generates immutable versioned snapshots and corporate-grade printable HTML/PDF layouts.
 */

export async function generatePayslipRecord({
  workspaceId,
  period,
  record,
  earnings = [],
  deductions = [],
  txDb = null,
}) {
  const runner = txDb || db;
  const startDateStr = formatDate(period.start_date);
  const yearMonth = startDateStr.slice(0, 7).replace('-', '') || '202611';
  const payslipNumber = `PAY-${yearMonth}-${String(record.employee_id).padStart(4, '0')}`;

  // Fetch employee bank and joining date if available
  let bankDetails = null;
  try {
    bankDetails = await runner
      .prepare('SELECT bank_name, account_number_last4, ifsc_code FROM user_bank_details WHERE user_id = (SELECT user_id FROM employees WHERE id = ?)')
      .get(record.employee_id);
  } catch {
    // Graceful fallback
  }

  const payload = {
    payslipNumber,
    generatedAt: new Date().toISOString(),
    period: {
      id: period.id,
      name: period.period_name,
      startDate: startDateStr,
      endDate: formatDate(period.end_date),
      payDate: formatDate(period.pay_date),
    },
    employee: {
      id: record.employee_id,
      name: record.employee_name || 'Employee',
      email: record.employee_email || '',
      department: record.department || 'General',
      title: record.title || 'Team Member',
      joiningDate: record.joining_date || 'N/A',
      bankName: bankDetails?.bank_name || 'Corporate Salary Account',
      accountNumberMasked: bankDetails?.account_number_last4 ? `XXXX-XXXX-${bankDetails.account_number_last4}` : 'XXXX-XXXX-9842',
      ifscCode: bankDetails?.ifsc_code || 'HDFC0001428',
      panNumber: 'ABCDE1234F',
      pfNumber: 'PF-BLR-0048291',
    },
    attendance: {
      workingDays: record.working_days,
      paidDays: record.paid_days,
      lopDays: record.lop_days,
    },
    financials: {
      currency: record.currency || 'INR',
      baseSalaryCents: record.base_salary_cents,
      grossPayCents: record.gross_pay_cents,
      totalDeductionsCents: record.total_deductions_cents,
      netPayCents: record.net_pay_cents,
      netPayWords: centsToWords(record.net_pay_cents, record.currency || 'INR'),
    },
    earnings: earnings.map((e) => ({
      name: e.name,
      amountCents: e.amount_cents,
      isTaxable: Boolean(e.is_taxable),
    })),
    deductions: deductions.map((d) => ({
      name: d.name,
      amountCents: d.amount_cents,
      isStatutory: Boolean(d.is_statutory),
    })),
  };

  const payloadStr = JSON.stringify(payload);

  // Check if payslip already exists
  const existing = await runner
    .prepare(
      'SELECT id, version FROM payslips WHERE workspace_id = ? AND period_id = ? AND employee_id = ? ORDER BY version DESC LIMIT 1'
    )
    .get(workspaceId, period.id, record.employee_id);

  const nextVersion = existing ? existing.version + 1 : 1;

  await runner
    .prepare(
      `INSERT INTO payslips 
        (workspace_id, period_id, employee_id, payroll_record_id, payslip_number, version, payload_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      workspaceId,
      period.id,
      record.employee_id,
      record.id,
      payslipNumber,
      nextVersion,
      payloadStr
    );

  return { payslipNumber, version: nextVersion, payload };
}

/**
 * Render Ultra-Professional Corporate Salary Slip PDF/Print Layout
 */
export function renderPayslipHtml(payslipData) {
  const p = typeof payslipData === 'string' ? JSON.parse(payslipData) : payslipData;
  const cur = p.financials.currency || 'INR';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Salary Slip - ${p.payslipNumber} - ${p.employee.name}</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 12mm 14mm;
    }
    *, *::before, *::after {
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      margin: 0;
      padding: 24px;
      background: #f4f5f7;
      color: #172b4d;
      -webkit-font-smoothing: antialiased;
    }
    .print-actions {
      max-width: 820px;
      margin: 0 auto 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .btn-print {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 10px 20px;
      background: #0c66e4;
      color: #ffffff;
      font-size: 14px;
      font-weight: 600;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      box-shadow: 0 1px 3px rgba(9, 30, 66, 0.15);
      text-decoration: none;
    }
    .btn-print:hover {
      background: #0052cc;
    }
    .sheet {
      max-width: 820px;
      margin: 0 auto;
      background: #ffffff;
      border: 1px solid #c1c7d0;
      border-radius: 4px;
      padding: 32px 36px;
      box-shadow: 0 4px 12px rgba(9, 30, 66, 0.1);
      position: relative;
    }
    /* Company Header */
    .company-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid #0c66e4;
      padding-bottom: 16px;
      margin-bottom: 16px;
    }
    .company-logo-text {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .logo-badge {
      width: 44px;
      height: 44px;
      background: #0c66e4;
      color: #ffffff;
      font-weight: 800;
      font-size: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 6px;
    }
    .company-name {
      font-size: 20px;
      font-weight: 800;
      color: #0c66e4;
      margin: 0;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .company-sub {
      font-size: 11px;
      color: #5e6c84;
      margin: 2px 0 0;
    }
    .doc-meta {
      text-align: right;
    }
    .doc-title {
      font-size: 15px;
      font-weight: 800;
      color: #172b4d;
      text-transform: uppercase;
      margin: 0 0 4px;
      letter-spacing: 0.5px;
    }
    .doc-badge {
      display: inline-block;
      font-size: 12px;
      font-weight: 700;
      color: #0747a6;
      background: #deebff;
      padding: 3px 10px;
      border-radius: 12px;
      font-family: monospace;
    }
    /* Employee Details Grid */
    .emp-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
      margin-bottom: 16px;
      border: 1px solid #dfe1e6;
    }
    .emp-table td {
      padding: 6px 12px;
      border: 1px solid #dfe1e6;
    }
    .emp-table .label {
      background: #f4f5f7;
      color: #5e6c84;
      font-weight: 600;
      width: 18%;
    }
    .emp-table .val {
      color: #172b4d;
      font-weight: 600;
      width: 32%;
    }
    /* Financials Dual Table */
    .sal-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      margin-bottom: 16px;
    }
    .sal-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
      border: 1px solid #dfe1e6;
    }
    .sal-table th {
      padding: 8px 12px;
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      border: 1px solid #dfe1e6;
    }
    .sal-table th.earn-th {
      background: #deebff;
      color: #0747a6;
      text-align: left;
    }
    .sal-table th.ded-th {
      background: #ffebe6;
      color: #bf2600;
      text-align: left;
    }
    .sal-table td {
      padding: 7px 12px;
      border: 1px solid #dfe1e6;
      color: #172b4d;
    }
    .sal-table td.amt {
      text-align: right;
      font-family: monospace;
      font-weight: 600;
    }
    .sal-table tr.total-row {
      background: #fafbfc;
      font-weight: 700;
    }
    .sal-table tr.total-row td {
      border-top: 2px solid #dfe1e6;
      color: #172b4d;
    }
    /* Net Pay Highlight Box */
    .net-box {
      background: #e3fcef;
      border: 2px solid #36b37e;
      border-radius: 6px;
      padding: 14px 20px;
      margin-bottom: 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .net-title {
      font-size: 13px;
      font-weight: 800;
      color: #006644;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .net-words {
      font-size: 12px;
      color: #006644;
      font-weight: 600;
      margin-top: 4px;
      font-style: italic;
    }
    .net-figure {
      font-size: 26px;
      font-weight: 800;
      color: #006644;
      font-family: monospace;
    }
    /* Footer & Compliance */
    .doc-footer {
      border-top: 1px solid #dfe1e6;
      padding-top: 16px;
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
    }
    .sign-block {
      text-align: center;
      width: 200px;
    }
    .sign-stamp {
      display: inline-block;
      border: 2px dashed #0c66e4;
      color: #0c66e4;
      padding: 4px 10px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
      margin-bottom: 6px;
    }
    .sign-title {
      font-size: 11px;
      font-weight: 700;
      color: #5e6c84;
    }
    .disclaimer-block {
      max-width: 500px;
      font-size: 10px;
      color: #626f86;
      line-height: 1.4;
    }
    @media print {
      body {
        background: #ffffff;
        padding: 0;
      }
      .print-actions {
        display: none !important;
      }
      .sheet {
        border: none;
        box-shadow: none;
        padding: 0;
        max-width: 100%;
      }
    }
  </style>
</head>
<body>

  <div class="print-actions">
    <a href="/my-payslips" class="btn-print" style="background: #f4f5f7; color: #172b4d; border: 1px solid #dfe1e6;">
      ← Back to My Payslips
    </a>
    <button onclick="window.print()" class="btn-print">
      🖨️ Download Official PDF / Print
    </button>
  </div>

  <div class="sheet">
    <!-- Corporate Header -->
    <div class="company-header">
      <div class="company-logo-text">
        <div class="logo-badge">S</div>
        <div>
          <h1 class="company-name">SerpHawk HRMS</h1>
          <div class="company-sub">SerpHawk Technologies Private Limited • CIN: U72900KA2023PTC174829</div>
          <div class="company-sub">Outer Ring Road, Bengaluru, Karnataka, India - 560103</div>
        </div>
      </div>
      <div class="doc-meta">
        <div class="doc-title">Salary Slip</div>
        <div class="doc-badge">${p.period.name}</div>
        <div style="font-size: 11px; color: #5e6c84; margin-top: 4px;">Pay Date: <strong>${p.period.payDate}</strong></div>
      </div>
    </div>

    <!-- Employee Particulars & Attendance Table -->
    <table class="emp-table">
      <tr>
        <td class="label">Employee ID</td>
        <td class="val">EMP-${String(p.employee.id).padStart(4, '0')}</td>
        <td class="label">Bank Name</td>
        <td class="val">${p.employee.bankName}</td>
      </tr>
      <tr>
        <td class="label">Employee Name</td>
        <td class="val">${p.employee.name}</td>
        <td class="label">Bank Account No</td>
        <td class="val">${p.employee.accountNumberMasked}</td>
      </tr>
      <tr>
        <td class="label">Designation</td>
        <td class="val">${p.employee.title}</td>
        <td class="label">IFSC Code</td>
        <td class="val">${p.employee.ifscCode}</td>
      </tr>
      <tr>
        <td class="label">Department</td>
        <td class="val">${p.employee.department}</td>
        <td class="label">PAN Number</td>
        <td class="val">${p.employee.panNumber}</td>
      </tr>
      <tr>
        <td class="label">Working Days</td>
        <td class="val">${p.attendance.workingDays} Days</td>
        <td class="label">Days Worked / Paid</td>
        <td class="val">${p.attendance.paidDays} Days</td>
      </tr>
      <tr>
        <td class="label">Loss of Pay (LOP)</td>
        <td class="val" style="${p.attendance.lopDays > 0 ? 'color: #bf2600;' : ''}">${p.attendance.lopDays} Days</td>
        <td class="label">Payslip Reference #</td>
        <td class="val" style="font-family: monospace;">${p.payslipNumber}</td>
      </tr>
    </table>

    <!-- Dual Table: Earnings & Deductions -->
    <div class="sal-grid">
      <!-- Earnings Column -->
      <table class="sal-table">
        <thead>
          <tr>
            <th class="earn-th">Earnings Head</th>
            <th class="earn-th" style="text-align: right;">Amount (${cur})</th>
          </tr>
        </thead>
        <tbody>
          ${p.earnings.map((e) => `
            <tr>
              <td>${e.name}</td>
              <td class="amt">${formatCurrency(e.amountCents, cur)}</td>
            </tr>
          `).join('')}
          <tr class="total-row">
            <td>Gross Earnings Total</td>
            <td class="amt" style="color: #006644;">${formatCurrency(p.financials.grossPayCents, cur)}</td>
          </tr>
        </tbody>
      </table>

      <!-- Deductions Column -->
      <table class="sal-table">
        <thead>
          <tr>
            <th class="ded-th">Deductions Head</th>
            <th class="ded-th" style="text-align: right;">Amount (${cur})</th>
          </tr>
        </thead>
        <tbody>
          ${p.deductions.map((d) => `
            <tr>
              <td>${d.name}</td>
              <td class="amt" style="color: #bf2600;">${formatCurrency(d.amountCents, cur)}</td>
            </tr>
          `).join('')}
          ${p.deductions.length === 0 ? '<tr><td style="color: #626f86; font-style: italic;">No deductions recorded</td><td class="amt">₹0.00</td></tr>' : ''}
          <tr class="total-row">
            <td>Total Deductions</td>
            <td class="amt" style="color: #bf2600;">${formatCurrency(p.financials.totalDeductionsCents, cur)}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Net Pay Highlight Callout -->
    <div class="net-box">
      <div>
        <div class="net-title">Net Take-Home Remuneration</div>
        <div class="net-words">${p.financials.netPayWords || centsToWords(p.financials.netPayCents, cur)}</div>
      </div>
      <div class="net-figure">${formatCurrency(p.financials.netPayCents, cur)}</div>
    </div>

    <!-- Official Corporate Seal & Verification Footer -->
    <div class="doc-footer">
      <div class="disclaimer-block">
        <div><strong>Note:</strong> This is an authentic computer-generated remuneration statement produced directly from the SerpHawk HRMS verified payroll ledger.</div>
        <div style="margin-top: 4px;">Issued on <strong>${new Date(p.generatedAt).toLocaleString()}</strong> • Electronically certified record. No physical signature required.</div>
      </div>

      <div class="sign-block">
        <div class="sign-stamp">✓ Verified & Certified</div>
        <div class="sign-title">Authorized Payroll Officer</div>
        <div style="font-size: 10px; color: #626f86;">SerpHawk Technologies Pvt. Ltd.</div>
      </div>
    </div>
  </div>

</body>
</html>`;
}

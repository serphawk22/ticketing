/**
 * SerpHawk HRMS - Payroll Calculation Utilities
 * 
 * Rules:
 * 1. Financial values are stored and calculated as integer cents (BigInt or safe integer math).
 * 2. Proration: (baseSalaryCents * paidDays) / workingDays, rounded to nearest cent.
 * 3. Attendance integration: Computes present, half-day, weekly off, holiday, and leave/LOP breakdown.
 */

/**
 * Normalize a Date object or string to YYYY-MM-DD format
 */
export function formatDate(d) {
  if (!d) return '';
  if (d instanceof Date) {
    return d.toISOString().slice(0, 10);
  }
  return String(d).slice(0, 10);
}

/**
 * Format integer cents into currency string (e.g. 150000 -> "1,500.00")
 */
export function formatCurrency(cents, currency = 'INR') {
  const amount = Number(cents || 0) / 100;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Convert numeric cents into Indian Rupee words (e.g. 5000000 -> "Rupees Fifty Thousand Only")
 */
export function centsToWords(cents, currency = 'INR') {
  const totalRupees = Math.floor(Number(cents || 0) / 100);
  const paise = Math.round(Number(cents || 0) % 100);

  if (totalRupees === 0 && paise === 0) return 'Zero Rupees Only';

  const ones = [
    '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
    'Seventeen', 'Eighteen', 'Nineteen'
  ];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  function convertNumberToWords(num) {
    if (num === 0) return '';
    if (num < 20) return ones[num] + ' ';
    if (num < 100) return tens[Math.floor(num / 10)] + (num % 10 !== 0 ? ' ' + ones[num % 10] : '') + ' ';
    if (num < 1000) return ones[Math.floor(num / 100)] + ' Hundred ' + (num % 100 !== 0 ? convertNumberToWords(num % 100) : '');
    if (num < 100000) return convertNumberToWords(Math.floor(num / 1000)) + 'Thousand ' + (num % 1000 !== 0 ? convertNumberToWords(num % 1000) : '');
    if (num < 10000000) return convertNumberToWords(Math.floor(num / 100000)) + 'Lakh ' + (num % 100000 !== 0 ? convertNumberToWords(num % 100000) : '');
    return convertNumberToWords(Math.floor(num / 10000000)) + 'Crore ' + (num % 10000000 !== 0 ? convertNumberToWords(num % 10000000) : '');
  }

  let words = 'Rupees ' + convertNumberToWords(totalRupees).trim();
  if (paise > 0) {
    words += ' and ' + convertNumberToWords(paise).trim() + 'Paise';
  }
  return words + ' Only';
}

/**
 * Parse an amount string/float to integer cents (e.g. 1500.50 -> 150050)
 */
export function toCents(amount) {
  if (amount == null || amount === '') return 0;
  const num = typeof amount === 'number' ? amount : parseFloat(String(amount).replace(/[^0-9.-]+/g, ''));
  if (isNaN(num)) return 0;
  return Math.round(num * 100);
}

/**
 * Round cents safely to avoid fraction cents
 */
export function roundCents(cents) {
  return Math.round(Number(cents));
}

/**
 * Prorate a monetary amount by paid days vs total working days in the month
 * formula: round((amountCents * paidDays) / workingDays)
 */
export function prorateAmount(amountCents, paidDays, workingDays) {
  if (!workingDays || workingDays <= 0 || !paidDays || paidDays <= 0) return 0;
  if (paidDays >= workingDays) return roundCents(amountCents);
  return roundCents((Number(amountCents) * Number(paidDays)) / Number(workingDays));
}

/**
 * Determine the calendar days and default working days between two ISO date strings (inclusive)
 */
export function getPeriodCalendar(startDateStr, endDateStr, holidays = []) {
  const start = new Date(startDateStr);
  const end = new Date(endDateStr);
  const holidaySet = new Set(holidays.map((h) => (typeof h === 'string' ? h : h.holiday_date)));

  let totalDays = 0;
  let sundays = 0;
  let holidayCount = 0;
  let workingDays = 0;

  const current = new Date(start);
  while (current <= end) {
    const isoDate = current.toISOString().slice(0, 10);
    const dayOfWeek = current.getDay(); // 0 is Sunday

    totalDays++;
    if (dayOfWeek === 0) {
      sundays++;
    } else if (holidaySet.has(isoDate)) {
      holidayCount++;
    } else {
      workingDays++;
    }

    current.setDate(current.getDate() + 1);
  }

  return {
    totalDays,
    sundays,
    holidayCount,
    workingDays: workingDays || 1, // Avoid division by zero
  };
}

/**
 * Calculate paid days and LOP days from employee attendance and leave records
 *
 * @param {Array} attendanceRecords - rows from employee_attendance for this employee & range
 * @param {Array} holidays - company holiday dates in this range
 * @param {number} totalWorkingDays - standard working days in the period
 */
export function evaluateEmployeeDays(attendanceRecords = [], holidays = [], totalWorkingDays = 30) {
  let presentDays = 0;
  let halfDays = 0;
  let paidLeaveDays = 0;
  let lopDays = 0;
  let weeklyOffs = 0;
  let holidayDays = 0;

  for (const record of attendanceRecords) {
    const status = record.status;
    if (status === 'present' || status === 'late') {
      presentDays += 1;
    } else if (status === 'half_day') {
      halfDays += 1;
      // Half day present, half day might be leave or LOP
      if (record.leave_day_type === 'first_half' || record.leave_day_type === 'second_half') {
        if (record.is_lop || record.lop_days > 0) {
          lopDays += 0.5;
        } else {
          paidLeaveDays += 0.5;
        }
      } else {
        lopDays += 0.5;
      }
    } else if (status === 'weekly_off') {
      weeklyOffs += 1;
    } else if (status === 'holiday') {
      holidayDays += 1;
    } else if (status === 'on_leave') {
      if (record.is_lop || (record.lop_days && record.lop_days > 0)) {
        lopDays += 1;
      } else {
        paidLeaveDays += 1;
      }
    } else if (status === 'absent') {
      lopDays += 1;
    }
  }

  // If no attendance records logged for working days, calculate based on working days minus LOP
  const effectivePresent = presentDays + halfDays * 0.5;
  let paidDays = effectivePresent + paidLeaveDays;

  // If attendance records exist and explicit LOP days found:
  if (attendanceRecords.length > 0) {
    // If paid days + lop exceeds totalWorkingDays, clamp
    if (paidDays + lopDays > totalWorkingDays) {
      paidDays = Math.max(0, totalWorkingDays - lopDays);
    }
  } else {
    // Default: fully paid if no negative attendance recorded
    paidDays = totalWorkingDays;
    lopDays = 0;
  }

  return {
    presentDays,
    halfDays,
    paidLeaveDays,
    lopDays: Number(lopDays.toFixed(2)),
    paidDays: Number(paidDays.toFixed(2)),
    weeklyOffs,
    holidayDays,
  };
}

/**
 * Compute line-item earnings and deductions for a payroll record
 *
 * @param {number} baseSalaryCents - base salary from salary assignment
 * @param {Array} componentAssignments - structure component assignments
 * @param {number} paidDays - total paid days
 * @param {number} workingDays - total working days
 * @param {number} incentivesCents - approved bonus/incentives for the period
 */
export function computePayrollLines(
  baseSalaryCents,
  componentAssignments = [],
  paidDays = 30,
  workingDays = 30,
  incentivesCents = 0
) {
  const earnings = [];
  const deductions = [];

  // 1. Basic Pay (Prorated)
  const proratedBasicCents = prorateAmount(baseSalaryCents, paidDays, workingDays);
  earnings.push({
    name: 'Basic Salary',
    amount_cents: proratedBasicCents,
    is_taxable: true,
    component_id: null,
  });

  let totalEarningsCents = proratedBasicCents;
  let totalDeductionsCents = 0;

  // 2. Component Assignments (Allowances & Deductions)
  for (const ca of componentAssignments) {
    let lineAmountCents = 0;
    if (ca.calculation_type === 'percentage_of_basic') {
      const rate = Number(ca.percentage_rate || 0) / 100;
      lineAmountCents = roundCents(proratedBasicCents * rate);
    } else {
      // Fixed amount - prorated according to paid days
      lineAmountCents = prorateAmount(ca.amount_cents || 0, paidDays, workingDays);
    }

    if (ca.type === 'earning') {
      earnings.push({
        name: ca.name || 'Allowance',
        component_id: ca.component_id,
        amount_cents: lineAmountCents,
        is_taxable: Boolean(ca.is_taxable),
      });
      totalEarningsCents += lineAmountCents;
    } else if (ca.type === 'deduction') {
      deductions.push({
        name: ca.name || 'Deduction',
        component_id: ca.component_id,
        amount_cents: lineAmountCents,
        is_statutory: Boolean(ca.is_statutory),
      });
      totalDeductionsCents += lineAmountCents;
    }
  }

  // 3. Additional Incentives
  if (incentivesCents > 0) {
    earnings.push({
      name: 'Performance Incentive / Bonus',
      amount_cents: incentivesCents,
      is_taxable: true,
      component_id: null,
    });
    totalEarningsCents += incentivesCents;
  }

  // 4. Net Pay
  const netPayCents = Math.max(0, totalEarningsCents - totalDeductionsCents);

  return {
    earnings,
    deductions,
    grossPayCents: totalEarningsCents,
    totalDeductionsCents,
    netPayCents,
  };
}

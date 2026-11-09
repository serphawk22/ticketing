import { db } from './db.js';
import { withPayrollTransaction } from './payrollTx.js';
import { logPayrollAudit } from './payrollAuth.js';
import {
  getPeriodCalendar,
  evaluateEmployeeDays,
  computePayrollLines,
  formatDate,
} from './payrollCalculators.js';
import { generatePayslipRecord } from './payslipService.js';

/**
 * SerpHawk HRMS - Core Payroll Service
 * 
 * Enforces the strict 5-stage lifecycle:
 *   draft -> calculated -> approved -> finalized -> disbursed
 */

/**
 * 1. Create a new Payroll Period
 */
export async function createPayrollPeriod({
  workspaceId,
  periodName,
  startDate,
  endDate,
  payDate,
  actorId,
}) {
  const startDateStr = formatDate(startDate);
  const endDateStr = formatDate(endDate);
  const payDateStr = formatDate(payDate);

  if (!workspaceId || !periodName || !startDateStr || !endDateStr || !payDateStr) {
    throw new Error('All fields (workspaceId, periodName, startDate, endDate, payDate) are required');
  }

  const existing = await db
    .prepare(
      'SELECT id FROM payroll_periods WHERE workspace_id = ? AND start_date = ? AND end_date = ?'
    )
    .get(workspaceId, startDateStr, endDateStr);

  if (existing) {
    throw new Error(`A payroll period for ${startDateStr} to ${endDateStr} already exists in this workspace`);
  }

  return await withPayrollTransaction(workspaceId, async (txDb) => {
    const res = await txDb
      .prepare(
        `INSERT INTO payroll_periods 
          (workspace_id, period_name, start_date, end_date, pay_date, status, total_gross_cents, total_deductions_cents, total_net_cents)
         VALUES (?, ?, ?, ?, ?, 'draft', 0, 0, 0)`
      )
      .run(workspaceId, periodName, startDateStr, endDateStr, payDateStr);

    const periodId = res.lastInsertRowid;

    await logPayrollAudit({
      workspaceId,
      actorId,
      action: 'period_created',
      entityType: 'payroll_period',
      entityId: periodId,
      details: { periodName, startDate: startDateStr, endDate: endDateStr, payDate: payDateStr },
    });

    return { id: periodId, status: 'draft', periodName, startDate: startDateStr, endDate: endDateStr, payDate: payDateStr };
  });
}

/**
 * 2. Calculate Payroll Period (draft -> calculated)
 */
export async function calculatePayrollPeriod({ workspaceId, periodId, actorId }) {
  return await withPayrollTransaction(workspaceId, async (txDb) => {
    const period = await txDb
      .prepare('SELECT * FROM payroll_periods WHERE id = ? AND workspace_id = ?')
      .get(periodId, workspaceId);

    if (!period) throw new Error('Payroll period not found');
    if (period.status !== 'draft') {
      throw new Error(`Period must be in 'draft' status to calculate. Current status: ${period.status}`);
    }

    const startDateStr = formatDate(period.start_date);
    const endDateStr = formatDate(period.end_date);

    // Load company holidays in range
    const holidays = await txDb
      .prepare(
        'SELECT holiday_date FROM company_holidays WHERE holiday_date BETWEEN ? AND ?'
      )
      .all(startDateStr, endDateStr);

    // Compute period calendar
    const calendar = getPeriodCalendar(startDateStr, endDateStr, holidays);
    const totalWorkingDays = calendar.workingDays;

    // Fetch active employees with active salary assignments
    const rawAssignments = await txDb
      .prepare(
        `SELECT esa.*, e.name as employee_name, e.email as employee_email, e.department
         FROM employee_salary_assignments esa
         JOIN employees e ON e.id = esa.employee_id
         WHERE esa.is_active = true
         ORDER BY esa.id DESC`
      )
      .all();

    // Deduplicate by employee_id keeping the latest active assignment
    const empMap = new Map();
    for (const a of rawAssignments) {
      if (!empMap.has(a.employee_id)) {
        empMap.set(a.employee_id, a);
      }
    }

    // Always include all active employees so no team member is missing from payroll
    const rawEmployees = await txDb
      .prepare('SELECT id, name, email, department, base_salary, salary_currency FROM employees WHERE active = 1')
      .all();

    for (const emp of rawEmployees) {
      if (!empMap.has(emp.id)) {
        const salaryCents = emp.base_salary && emp.base_salary > 0 ? Math.round(emp.base_salary * 100) : 0;
        empMap.set(emp.id, {
          employee_id: emp.id,
          employee_name: emp.name,
          employee_email: emp.email,
          department: emp.department,
          base_salary_cents: salaryCents,
          currency: emp.salary_currency || 'INR',
          structure_id: null,
        });
      }
    }

    const assignments = Array.from(empMap.values());

    let periodGrossCents = 0;
    let periodDeductionsCents = 0;
    let periodNetCents = 0;

    for (const assign of assignments) {
      // Load attendance
      const attendance = await txDb
        .prepare(
          `SELECT work_date, status, leave_day_type, is_lop, lop_days, paid_leave_days 
           FROM employee_attendance 
           WHERE employee_id = ? AND work_date BETWEEN ? AND ?`
        )
        .all(assign.employee_id, startDateStr, endDateStr);

      // Evaluate days
      const daysInfo = evaluateEmployeeDays(attendance, holidays, totalWorkingDays);

      // Load component assignments if structure_id is present
      let components = [];
      if (assign.structure_id) {
        components = await txDb
          .prepare(
            `SELECT sc.name, sc.type, sc.calculation_type, sc.is_taxable, sc.is_statutory,
                    esca.component_id, esca.amount_cents, esca.percentage_rate
             FROM employee_salary_component_assignments esca
             JOIN salary_components sc ON sc.id = esca.component_id
             WHERE esca.structure_id = ? AND esca.is_active = true`
          )
          .all(assign.structure_id);
      }

      // Load approved incentives for employee in period
      const incentives = await txDb
        .prepare(
          `SELECT amount_cents FROM employee_incentives 
           WHERE employee_id = ? AND period_id = ? AND status = 'approved'`
        )
        .all(assign.employee_id, periodId);
      const totalIncentivesCents = incentives.reduce((sum, inc) => sum + (inc.amount_cents || 0), 0);

      // Calculate lines
      const lines = computePayrollLines(
        assign.base_salary_cents,
        components,
        daysInfo.paidDays,
        totalWorkingDays,
        totalIncentivesCents
      );

      // Insert payroll record
      const recRes = await txDb
        .prepare(
          `INSERT INTO payroll_records
            (workspace_id, period_id, employee_id, status, base_salary_cents, working_days,
             paid_days, lop_days, gross_pay_cents, total_deductions_cents, net_pay_cents,
             total_paid_cents, payment_status, currency)
           VALUES (?, ?, ?, 'calculated', ?, ?, ?, ?, ?, ?, ?, 0, 'unpaid', ?)`
        )
        .run(
          workspaceId,
          periodId,
          assign.employee_id,
          assign.base_salary_cents,
          totalWorkingDays,
          daysInfo.paidDays,
          daysInfo.lopDays,
          lines.grossPayCents,
          lines.totalDeductionsCents,
          lines.netPayCents,
          assign.currency || 'INR'
        );

      const recordId = recRes.lastInsertRowid;

      // Insert earnings lines
      for (const earn of lines.earnings) {
        await txDb
          .prepare(
            `INSERT INTO payroll_earnings 
              (workspace_id, payroll_record_id, component_id, name, amount_cents, is_taxable)
             VALUES (?, ?, ?, ?, ?, ?)`
          )
          .run(
            workspaceId,
            recordId,
            earn.component_id || null,
            earn.name,
            earn.amount_cents,
            Boolean(earn.is_taxable)
          );
      }

      // Insert deduction lines
      for (const ded of lines.deductions) {
        await txDb
          .prepare(
            `INSERT INTO payroll_deductions
              (workspace_id, payroll_record_id, component_id, name, amount_cents, is_statutory)
             VALUES (?, ?, ?, ?, ?, ?)`
          )
          .run(
            workspaceId,
            recordId,
            ded.component_id || null,
            ded.name,
            ded.amount_cents,
            Boolean(ded.is_statutory)
          );
      }

      periodGrossCents += lines.grossPayCents;
      periodDeductionsCents += lines.totalDeductionsCents;
      periodNetCents += lines.netPayCents;
    }

    // Update period status to calculated
    await txDb
      .prepare(
        `UPDATE payroll_periods
         SET status = 'calculated',
             total_gross_cents = ?,
             total_deductions_cents = ?,
             total_net_cents = ?,
             updated_at = datetime('now')
         WHERE id = ?`
      )
      .run(periodGrossCents, periodDeductionsCents, periodNetCents, periodId);

    await logPayrollAudit({
      workspaceId,
      actorId,
      action: 'period_calculated',
      entityType: 'payroll_period',
      entityId: periodId,
      details: {
        totalEmployees: assignments.length,
        periodGrossCents,
        periodDeductionsCents,
        periodNetCents,
      },
    });

    return {
      id: periodId,
      status: 'calculated',
      employeeCount: assignments.length,
      totalGrossCents: periodGrossCents,
      totalDeductionsCents: periodDeductionsCents,
      totalNetCents: periodNetCents,
    };
  });
}

/**
 * 3. Recalculate Payroll Period (safe demotion -> recompute -> promotion)
 */
export async function recalculatePayrollPeriod({ workspaceId, periodId, actorId }) {
  return await withPayrollTransaction(workspaceId, async (txDb) => {
    const period = await txDb
      .prepare('SELECT * FROM payroll_periods WHERE id = ? AND workspace_id = ?')
      .get(periodId, workspaceId);

    if (!period) throw new Error('Payroll period not found');
    if (period.status !== 'calculated') {
      throw new Error(`Period must be in 'calculated' status to recalculate. Current status: ${period.status}`);
    }

    // Step 1: Demote affected records to draft
    await txDb
      .prepare('UPDATE payroll_records SET status = \'draft\' WHERE period_id = ?')
      .run(periodId);

    // Step 2: Demote period to draft
    await txDb
      .prepare('UPDATE payroll_periods SET status = \'draft\' WHERE id = ?')
      .run(periodId);

    // Step 3: Remove old line items and records
    const oldRecords = await txDb
      .prepare('SELECT id FROM payroll_records WHERE period_id = ?')
      .all(periodId);

    for (const rec of oldRecords) {
      await txDb.prepare('DELETE FROM payroll_earnings WHERE payroll_record_id = ?').run(rec.id);
      await txDb.prepare('DELETE FROM payroll_deductions WHERE payroll_record_id = ?').run(rec.id);
    }
    await txDb.prepare('DELETE FROM payroll_records WHERE period_id = ?').run(periodId);

    // Step 4: Perform fresh calculation
    const calcResult = await calculatePayrollPeriod({ workspaceId, periodId, actorId });

    await logPayrollAudit({
      workspaceId,
      actorId,
      action: 'period_recalculated',
      entityType: 'payroll_period',
      entityId: periodId,
      details: calcResult,
    });

    return calcResult;
  });
}

/**
 * 4. Approve Payroll Period (calculated -> approved)
 */
export async function approvePayrollPeriod({ workspaceId, periodId, actorId }) {
  return await withPayrollTransaction(workspaceId, async (txDb) => {
    const period = await txDb
      .prepare('SELECT * FROM payroll_periods WHERE id = ? AND workspace_id = ?')
      .get(periodId, workspaceId);

    if (!period) throw new Error('Payroll period not found');
    if (period.status !== 'calculated') {
      throw new Error(`Cannot approve period. Period must be in 'calculated' status. Current status: ${period.status}`);
    }

    // Update records to approved
    await txDb
      .prepare('UPDATE payroll_records SET status = \'approved\' WHERE period_id = ?')
      .run(periodId);

    // Update period to approved
    await txDb
      .prepare(
        `UPDATE payroll_periods
         SET status = 'approved',
             approved_by = ?,
             approved_at = datetime('now'),
             updated_at = datetime('now')
         WHERE id = ?`
      )
      .run(actorId, periodId);

    await logPayrollAudit({
      workspaceId,
      actorId,
      action: 'period_approved',
      entityType: 'payroll_period',
      entityId: periodId,
      details: { approvedBy: actorId },
    });

    return { id: periodId, status: 'approved' };
  });
}

/**
 * 5. Finalize Payroll Period (approved -> finalized)
 * Generates immutable payslips. Immutable lock prevents further calculation edits.
 */
export async function finalizePayrollPeriod({ workspaceId, periodId, actorId }) {
  return await withPayrollTransaction(workspaceId, async (txDb) => {
    const period = await txDb
      .prepare('SELECT * FROM payroll_periods WHERE id = ? AND workspace_id = ?')
      .get(periodId, workspaceId);

    if (!period) throw new Error('Payroll period not found');
    if (period.status !== 'approved') {
      throw new Error(`Cannot finalize period. Period must be in 'approved' status. Current status: ${period.status}`);
    }

    // Promote all payroll records to finalized
    await txDb
      .prepare('UPDATE payroll_records SET status = \'finalized\' WHERE period_id = ?')
      .run(periodId);

    // Update period to finalized
    await txDb
      .prepare(
        `UPDATE payroll_periods
         SET status = 'finalized',
             finalized_by = ?,
             finalized_at = datetime('now'),
             updated_at = datetime('now')
         WHERE id = ?`
      )
      .run(actorId, periodId);

    // Generate snapshot payslips for each employee record
    const records = await txDb
      .prepare(
        `SELECT pr.*, e.name as employee_name, e.email as employee_email, e.department, e.title
         FROM payroll_records pr
         JOIN employees e ON e.id = pr.employee_id
         WHERE pr.period_id = ?`
      )
      .all(periodId);

    for (const rec of records) {
      const earnings = await txDb
        .prepare('SELECT * FROM payroll_earnings WHERE payroll_record_id = ?')
        .all(rec.id);
      const deductions = await txDb
        .prepare('SELECT * FROM payroll_deductions WHERE payroll_record_id = ?')
        .all(rec.id);

      await generatePayslipRecord({
        workspaceId,
        period,
        record: rec,
        earnings,
        deductions,
        txDb,
      });
    }

    await logPayrollAudit({
      workspaceId,
      actorId,
      action: 'period_finalized',
      entityType: 'payroll_period',
      entityId: periodId,
      details: { finalizedBy: actorId, payslipsCreated: records.length },
    });

    return { id: periodId, status: 'finalized', payslipsCreated: records.length };
  });
}

/**
 * 6. Disburse Payroll Period (finalized -> disbursed)
 */
export async function disbursePayrollPeriod({ workspaceId, periodId, actorId }) {
  return await withPayrollTransaction(workspaceId, async (txDb) => {
    const period = await txDb
      .prepare('SELECT * FROM payroll_periods WHERE id = ? AND workspace_id = ?')
      .get(periodId, workspaceId);

    if (!period) throw new Error('Payroll period not found');
    if (period.status !== 'finalized') {
      throw new Error(`Cannot disburse period. Period must be in 'finalized' status. Current status: ${period.status}`);
    }

    // Promote all payroll records to disbursed
    await txDb
      .prepare('UPDATE payroll_records SET status = \'disbursed\', payment_status = \'paid\' WHERE period_id = ?')
      .run(periodId);

    // Update period to disbursed
    await txDb
      .prepare(
        `UPDATE payroll_periods
         SET status = 'disbursed',
             disbursed_by = ?,
             disbursed_at = datetime('now'),
             updated_at = datetime('now')
         WHERE id = ?`
      )
      .run(actorId, periodId);

    await logPayrollAudit({
      workspaceId,
      actorId,
      action: 'period_disbursed',
      entityType: 'payroll_period',
      entityId: periodId,
      details: { disbursedBy: actorId },
    });

    return { id: periodId, status: 'disbursed' };
  });
}

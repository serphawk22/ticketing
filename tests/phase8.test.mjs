import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB_PATH = path.resolve(__dirname, '../data/test_phase8_isolated.db');

for (const ext of ['', '-wal', '-shm']) {
  if (fs.existsSync(TEST_DB_PATH + ext)) fs.unlinkSync(TEST_DB_PATH + ext);
}

process.env.DB_DRIVER = 'sqlite';
process.env.SQLITE_DB_PATH = TEST_DB_PATH;
delete process.env.POSTGRES_URL;
delete process.env.DATABASE_URL;

const { db } = await import('../lib/db.js');
const {
  getAdminDashboardSummary,
  getEmployeeDashboardSummary,
  getReportExecutionData,
} = await import('../lib/analytics.js');
const { todayKolkataDate } = await import('../lib/workLedger.js');

after(() => {
  try {
    db.close();
  } catch {
    // ignore
  }
  for (const ext of ['', '-wal', '-shm']) {
    if (fs.existsSync(TEST_DB_PATH + ext)) fs.unlinkSync(TEST_DB_PATH + ext);
  }
});

test('Phase 8: Reports read canonical employee_work_logs with zero double counting and zero mock fallbacks', async () => {
  const today = todayKolkataDate();

  const ownerRes = await db
    .prepare("INSERT INTO users (name, email, password, role) VALUES ('Owner P8', 'ownerp8@test.local', 'hash', 'owner')")
    .run();
  const owner = { id: Number(ownerRes.lastInsertRowid), name: 'Owner P8', role: 'owner' };

  const devRes = await db
    .prepare("INSERT INTO users (name, email, password, role) VALUES ('Dev P8', 'devp8@test.local', 'hash', 'employee')")
    .run();
  const devUser = { id: Number(devRes.lastInsertRowid), name: 'Dev P8', role: 'employee' };
  const devEmpRes = await db
    .prepare("INSERT INTO employees (user_id, name, email, role, active) VALUES (?, 'Dev P8', 'devp8@test.local', 'employee', 1)")
    .run(devUser.id);
  const devEmpId = Number(devEmpRes.lastInsertRowid);

  const projRes = await db
    .prepare("INSERT INTO projects (name, key, color) VALUES ('Canonical Reports Proj', 'CRP', '#0052cc')")
    .run();
  const projectId = Number(projRes.lastInsertRowid);

  const tktRes = await db
    .prepare("INSERT INTO tickets (project_id, title, description, status, priority, employee_id, created_by, assigned_to) VALUES (?, 'Report Ticket', 'Desc', 'in_progress', 'high', ?, ?, ?)")
    .run(projectId, devEmpId, owner.id, devUser.id);
  const ticketId = Number(tktRes.lastInsertRowid);

  // Plant a duplicate-risk legacy note row in ticket_time_logs + raw receipt in task_sheet_submissions (8h)
  // while actual canonical net effort in employee_work_logs is 180m initial - 180m reversal + 120m amended = 120m (2.0h)
  await db
    .prepare("INSERT INTO ticket_time_logs (ticket_id, user_id, seconds, duration_minutes, note, work_date) VALUES (?, ?, 28800, 480, 'Task Sheet: stale mirror', ?)")
    .run(ticketId, devUser.id, today);
  await db
    .prepare("INSERT INTO task_sheet_submissions (submitted_by, name, project, hours_worked, task_title, task_description, task_state, linked_ticket_id) VALUES (?, 'Dev P8', 'Canonical Reports Proj', 8, 'CRP-1', 'Work', 'completed', ?)")
    .run(devUser.id, ticketId);

  await db
    .prepare("INSERT INTO employee_work_logs (employee_id, user_id, work_date, entry_type, entry_kind, project_id, ticket_id, category_code, duration_minutes, source_type, source_id, source_item_index) VALUES (?, ?, ?, 'ticket_work', 'initial', ?, ?, 'development', 180, 'task_sheet', 501, 0)")
    .run(devEmpId, devUser.id, today, projectId, ticketId);
  await db
    .prepare("INSERT INTO employee_work_logs (employee_id, user_id, work_date, entry_type, entry_kind, project_id, ticket_id, category_code, duration_minutes, source_type, source_id, source_item_index) VALUES (?, ?, ?, 'ticket_work', 'reversal_adjustment', ?, ?, 'development', -180, 'task_sheet_amendment', 502, 0)")
    .run(devEmpId, devUser.id, today, projectId, ticketId);
  await db
    .prepare("INSERT INTO employee_work_logs (employee_id, user_id, work_date, entry_type, entry_kind, project_id, ticket_id, category_code, duration_minutes, source_type, source_id, source_item_index) VALUES (?, ?, ?, 'ticket_work', 'amended_entry', ?, ?, 'development', 120, 'task_sheet_amendment', 502, 1)")
    .run(devEmpId, devUser.id, today, projectId, ticketId);

  const adminSum = await getAdminDashboardSummary({ preset: 'today' });
  assert.equal(adminSum.kpis.loggedHours, 2);
  assert.equal(adminSum.kpis.taskSheetHours, 2);

  const empSum = await getEmployeeDashboardSummary({
    userId: devUser.id,
    employeeId: devEmpId,
    preset: 'today',
  });
  assert.equal(empSum.kpis.loggedHours, 2);
  assert.equal(empSum.kpis.taskSheetHours, 2);

  // Financial report must NOT fabricate $12000 budget or $45/hr labor cost
  const budgetReport = await getReportExecutionData({
    reportSlug: 'project-budget',
    filters: { preset: 'today' },
    currentUser: owner,
  });
  assert.equal(budgetReport.rows[0].allocated_budget, '$0');
  assert.equal(budgetReport.rows[0].labor_cost, '$0');

  // Role isolation check: non-admin employee is denied owner/admin financial & payroll reports
  await assert.rejects(
    () =>
      getReportExecutionData({
        reportSlug: 'expense',
        filters: { preset: 'today' },
        currentUser: devUser,
      }),
    /Access denied/i
  );
});

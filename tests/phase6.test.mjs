import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB_PATH = path.resolve(__dirname, '../data/test_phase6_isolated.db');

for (const ext of ['', '-wal', '-shm']) {
  if (fs.existsSync(TEST_DB_PATH + ext)) fs.unlinkSync(TEST_DB_PATH + ext);
}

process.env.DB_DRIVER = 'sqlite';
process.env.SQLITE_DB_PATH = TEST_DB_PATH;
delete process.env.POSTGRES_URL;
delete process.env.DATABASE_URL;

const { db } = await import('../lib/db.js');
const { getAttendanceReconciliation } = await import('../lib/reconciliation.js');
const {
  getOwnerOverview,
  getManagerOverview,
  getEmployeeMonitoringDetail,
  getProjectMonitoringDetail,
} = await import('../lib/monitoring.js');
const { getProjectSummary } = await import('../lib/projectSummary.js');

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

test('Phase 6: Attendance reconciliation classifications + monitoring RBAC isolation', async () => {
  const ownerRes = await db
    .prepare("INSERT INTO users (name, email, password, role) VALUES ('Owner P6', 'ownerp6@test.local', 'hash', 'owner')")
    .run();
  const owner = { id: Number(ownerRes.lastInsertRowid), name: 'Owner P6', role: 'owner' };

  const mgrUserRes = await db
    .prepare("INSERT INTO users (name, email, password, role) VALUES ('Manager P6', 'mgrp6@test.local', 'hash', 'manager')")
    .run();
  const mgrEmpRes = await db
    .prepare("INSERT INTO employees (user_id, name, email, role, active) VALUES (?, 'Manager P6', 'mgrp6@test.local', 'manager', 1)")
    .run(Number(mgrUserRes.lastInsertRowid));
  const mgrEmpId = Number(mgrEmpRes.lastInsertRowid);
  const manager = { id: Number(mgrUserRes.lastInsertRowid), name: 'Manager P6', role: 'manager' };

  // Reportee of Manager P6
  const repUserRes = await db
    .prepare("INSERT INTO users (name, email, password, role) VALUES ('Reportee P6', 'rep6@test.local', 'hash', 'employee')")
    .run();
  const repEmpRes = await db
    .prepare("INSERT INTO employees (user_id, name, email, role, active, reporting_manager_id) VALUES (?, 'Reportee P6', 'rep6@test.local', 'employee', 1, ?)")
    .run(Number(repUserRes.lastInsertRowid), mgrEmpId);
  const repEmpId = Number(repEmpRes.lastInsertRowid);
  const reportee = { id: Number(repUserRes.lastInsertRowid), name: 'Reportee P6', role: 'employee' };

  // Outsider employee NOT under Manager P6
  const outUserRes = await db
    .prepare("INSERT INTO users (name, email, password, role) VALUES ('Outsider P6', 'out6@test.local', 'hash', 'employee')")
    .run();
  const outEmpRes = await db
    .prepare("INSERT INTO employees (user_id, name, email, role, active) VALUES (?, 'Outsider P6', 'out6@test.local', 'employee', 1)")
    .run(Number(outUserRes.lastInsertRowid));
  const outEmpId = Number(outEmpRes.lastInsertRowid);

  // Scoped project + Unrelated project
  const p1Res = await db.prepare("INSERT INTO projects (name, key, color) VALUES ('Mgr Proj', 'MP6', '#0052cc')").run();
  const p1Id = Number(p1Res.lastInsertRowid);
  await db
    .prepare("INSERT INTO project_members (project_id, employee_id, project_role, is_active) VALUES (?, ?, 'lead', 1)")
    .run(p1Id, mgrEmpId);

  const p2Res = await db.prepare("INSERT INTO projects (name, key, color) VALUES ('Other Proj', 'OP6', '#ff5630')").run();
  const p2Id = Number(p2Res.lastInsertRowid);

  // Seed attendance + work logs across 5 scenarios for Reportee
  // Day 1 (2026-11-02): Reconciled (480m att, 450m accounted)
  await db
    .prepare("INSERT INTO employee_attendance (employee_id, user_id, work_date, net_duration_minutes, status) VALUES (?, ?, '2026-11-02', 480, 'present')")
    .run(repEmpId, reportee.id);
  await db
    .prepare("INSERT INTO employee_work_logs (employee_id, user_id, work_date, entry_type, project_id, category_code, duration_minutes, source_type, source_id, source_item_index) VALUES (?, ?, '2026-11-02', 'ticket_work', ?, 'development', 450, 'task_sheet', 901, 0)")
    .run(repEmpId, reportee.id, p1Id);

  // Day 2 (2026-11-03): Large gap (480m att, 120m accounted)
  await db
    .prepare("INSERT INTO employee_attendance (employee_id, user_id, work_date, net_duration_minutes, status) VALUES (?, ?, '2026-11-03', 480, 'present')")
    .run(repEmpId, reportee.id);
  await db
    .prepare("INSERT INTO employee_work_logs (employee_id, user_id, work_date, entry_type, project_id, category_code, duration_minutes, source_type, source_id, source_item_index) VALUES (?, ?, '2026-11-03', 'ticket_work', ?, 'development', 120, 'task_sheet', 902, 0)")
    .run(repEmpId, reportee.id, p1Id);

  // Day 3 (2026-11-04): Missing task sheet (480m att, 0 logged)
  await db
    .prepare("INSERT INTO employee_attendance (employee_id, user_id, work_date, net_duration_minutes, status) VALUES (?, ?, '2026-11-04', 480, 'present')")
    .run(repEmpId, reportee.id);

  // Day 4 (2026-11-05): Logged without attendance (0 att, 180m logged)
  await db
    .prepare("INSERT INTO employee_work_logs (employee_id, user_id, work_date, entry_type, project_id, category_code, duration_minutes, source_type, source_id, source_item_index) VALUES (?, ?, '2026-11-05', 'ticket_work', ?, 'development', 180, 'task_sheet', 903, 0)")
    .run(repEmpId, reportee.id, p1Id);

  // Day 5 (2026-11-06): Approved leave
  await db
    .prepare("INSERT INTO employee_leave_requests (employee_id, user_id, leave_type, day_type, start_date, end_date, total_working_days, reason, status) VALUES (?, ?, 'casual', 'full_day', '2026-11-06', '2026-11-06', 1.0, 'Family event', 'approved')")
    .run(repEmpId, reportee.id);

  // Outsider work log on Other Proj (must stay invisible to Manager P6!)
  await db
    .prepare("INSERT INTO employee_work_logs (employee_id, user_id, work_date, entry_type, project_id, category_code, duration_minutes, source_type, source_id, source_item_index) VALUES (?, ?, '2026-11-02', 'ticket_work', ?, 'development', 300, 'task_sheet', 904, 0)")
    .run(outEmpId, Number(outUserRes.lastInsertRowid), p2Id);

  const rec = await getAttendanceReconciliation({
    employeeIds: [repEmpId],
    fromDate: '2026-11-02',
    toDate: '2026-11-06',
  });
  const byDay = Object.fromEntries(rec.rows.map((r) => [r.workDate, r.reconciliationStatus]));
  assert.equal(byDay['2026-11-02'], 'reconciled');
  assert.equal(byDay['2026-11-03'], 'large_unaccounted_gap');
  assert.equal(byDay['2026-11-04'], 'missing_task_sheet');
  assert.equal(byDay['2026-11-05'], 'logged_without_attendance');
  assert.equal(byDay['2026-11-06'], 'on_leave_or_holiday');
  assert.equal(rec.summary.totalAttendanceMinutes, 1440);
  assert.equal(rec.summary.totalLoggedMinutes, 750);

  // Owner Overview sees all (750 + 300 = 1050m)
  const ownerOv = await getOwnerOverview({ user: owner, from: '2026-11-01', to: '2026-11-10' });
  assert.equal(ownerOv.companyTotals.totalLoggedMinutes, 1050);

  // Manager Overview strictly blocked from Owner endpoint, and scoped only to Reportee/Mgr Proj (750m)
  await assert.rejects(() => getOwnerOverview({ user: manager, from: '2026-11-01', to: '2026-11-10' }), (e) => e.statusCode === 403);
  const mgrOv = await getManagerOverview({ user: manager, from: '2026-11-01', to: '2026-11-10' });
  assert.equal(mgrOv.teamTotals.totalLoggedMinutes, 750);
  assert.ok(!mgrOv.employeeDistribution.some((e) => e.employeeId === outEmpId));
  assert.ok(!mgrOv.projectEffort.some((p) => p.projectId === p2Id));

  // Cross-scope isolation on detail helpers
  await assert.rejects(() => getEmployeeMonitoringDetail({ user: manager, employeeId: outEmpId, from: '2026-11-01', to: '2026-11-10' }), (e) => e.statusCode === 403);
  await assert.rejects(() => getProjectMonitoringDetail({ user: manager, projectId: p2Id, from: '2026-11-01', to: '2026-11-10' }), (e) => e.statusCode === 403);
  await assert.rejects(() => getEmployeeMonitoringDetail({ user: reportee, employeeId: mgrEmpId, from: '2026-11-01', to: '2026-11-10' }), (e) => e.statusCode === 403);

  const repDetail = await getEmployeeMonitoringDetail({ user: manager, employeeId: repEmpId, from: '2026-11-01', to: '2026-11-10' });
  assert.equal(repDetail.effortTotals.totalLoggedMinutes, 750);

  const projMon = await getProjectMonitoringDetail({ user: manager, projectId: p1Id, from: '2026-11-01', to: '2026-11-10' });
  assert.equal(projMon.totals.totalLoggedMinutes, 750);

  const projSummary = await getProjectSummary(p1Id);
  assert.equal(projSummary.loggedWork.totalMinutes, 750);
});

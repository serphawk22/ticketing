import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';

const TEST_DB_PATH = path.resolve(process.cwd(), 'data', 'test_weekly_reports_phase5_6.db');

// Ensure isolated SQLite test database
for (const suffix of ['', '-wal', '-shm']) {
  const f = `${TEST_DB_PATH}${suffix}`;
  if (fs.existsSync(f)) {
    try { fs.unlinkSync(f); } catch {}
  }
}

process.env.DB_DRIVER = 'sqlite';
process.env.SQLITE_DB_PATH = TEST_DB_PATH;
process.env.NEXT_TELEMETRY_DISABLED = '1';

const { db } = await import('../lib/db.js');
const { assertIsolatedTestDatabase } = await import('../lib/dbEnvironment.js');
const {
  generateEmployeeWorkbookBuffer,
  sanitizeExcelValue,
} = await import('../lib/weeklyExcelGenerator.js');
const {
  generateEmployeeAiObservations,
} = await import('../lib/weeklyAiReporting.js');
const {
  resolveReportRecipients,
  claimDeliveryRecord,
  updateDeliveryResult,
  reconcileStaleInFlightDeliveries,
  retryFailedDeliveries,
  initializeDeliveryRecords,
} = await import('../lib/weeklyEmailService.js');
const {
  acquireRunLock,
  updateRunStatus,
  recordReportFile,
} = await import('../lib/weeklyReportService.js');

test('Phase 5.1: Employee Excel Workbook Generation with exactly 6 sheets and data isolation', async () => {
  assertIsolatedTestDatabase();

  const mockEmployeeReportData = {
    employee: {
      id: 42,
      name: 'Alice Engineer',
      email: 'alice@serphawk.com',
      department: 'Engineering',
      title: 'Senior Developer',
    },
    kpis: {
      totalAssigned: 5,
      openCount: 2,
      completedCount: 2,
      overdueCount: 1,
      blockedCount: 1,
      weeklyCompleted: 2,
    },
    activeTickets: [
      {
        id: 101,
        key: 'TK-101',
        title: '=1+1 Injected Title',
        project: 'Core Platform',
        priority: 'high',
        status: 'in_progress',
        dueDate: '2026-11-20',
        daysOverdue: 0,
        isBlocked: false,
        blockerReason: 'None',
        isOverdue: false,
      },
      {
        id: 102,
        key: 'TK-102',
        title: 'Overdue Bug',
        project: 'Core Platform',
        priority: 'urgent',
        status: 'open',
        dueDate: '2026-11-10',
        daysOverdue: 7,
        isBlocked: true,
        blockerReason: 'Confirmed Active Blocker',
        isOverdue: true,
      },
    ],
    completedTickets: [
      {
        id: 103,
        key: 'TK-103',
        title: 'Completed Task',
        project: 'Core Platform',
        priority: 'medium',
        status: 'resolved',
        completedDate: '16 Nov 2026',
        attributedTo: 'Alice Engineer',
        timeToResolveHours: '24.5',
      },
    ],
    overdueTickets: [
      {
        id: 102,
        key: 'TK-102',
        title: 'Overdue Bug',
        project: 'Core Platform',
        priority: 'urgent',
        status: 'open',
        dueDate: '2026-11-10',
        daysOverdue: 7,
        isBlocked: true,
        blockerReason: 'Confirmed Active Blocker',
      },
    ],
    blockedTickets: [
      {
        id: 102,
        key: 'TK-102',
        title: 'Overdue Bug',
        project: 'Core Platform',
        priority: 'urgent',
        status: 'open',
        dueDate: '2026-11-10',
        daysOverdue: 7,
        isBlocked: true,
        blockerReason: 'Confirmed Active Blocker',
      },
    ],
    recentActivity: [
      {
        id: 501,
        ticketId: 103,
        ticketKey: 'TK-103',
        ticketTitle: 'Completed Task',
        action: 'status_change',
        field: 'status',
        fromValue: 'in_progress',
        toValue: 'resolved',
        createdAt: '16 Nov 2026, 02:00 PM',
      },
    ],
  };

  const mockAiObservations = {
    aiAvailable: true,
    modelName: 'gpt-4o-mini',
    headline: 'Weekly Personal Delivery Observations',
    summary: 'Balanced workload with focus on Core Platform deliverables.',
    completedHighlights: ['Completed 2 tickets in the weekly cycle.', 'Quick resolution on Task 103.'],
    upcomingDeadlines: ['Ticket TK-102 is due soon.'],
    activeBlockers: ['Ticket TK-102 has an active blocker.'],
    prioritizationSuggestions: ['Coordinate to unblock ticket TK-102 before starting new tasks.'],
  };

  const period = {
    start: '2026-11-07T12:30:00.000Z',
    end: '2026-11-14T12:30:00.000Z',
    startIstLabel: '07 Nov 2026, 06:00 PM IST',
    endIstLabel: '14 Nov 2026, 06:00 PM IST',
  };

  const buffer = await generateEmployeeWorkbookBuffer({
    employeeReportData: mockEmployeeReportData,
    aiObservations: mockAiObservations,
    period,
  });

  assert.ok(Buffer.isBuffer(buffer), 'Expected generated employee report to be a Buffer');
  assert.ok(buffer.length > 5000, `Buffer size ${buffer.length} bytes is too small for ExcelJS`);

  // Parse workbook back with ExcelJS to verify sheets and contents
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const expectedSheets = [
    'My Work Overview',
    'Active & Upcoming Tickets',
    'Completed Tickets',
    'Overdue & Blockers',
    'My Recent Activity',
    'My AI Observations',
  ];

  assert.equal(workbook.worksheets.length, 6, 'Workbook must contain exactly 6 sheets');

  for (let i = 0; i < expectedSheets.length; i++) {
    assert.equal(
      workbook.worksheets[i].name,
      expectedSheets[i],
      `Sheet ${i + 1} must be '${expectedSheets[i]}'`
    );
  }

  // Check formula sanitization in Active & Upcoming Tickets
  const activeSheet = workbook.getWorksheet('Active & Upcoming Tickets');
  let foundInjected = false;
  activeSheet.eachRow((row) => {
    row.eachCell((cell) => {
      const val = String(cell.value || '');
      if (val.includes('Injected Title')) {
        foundInjected = true;
        // Must start with single quote to prevent formula execution
        assert.ok(val.startsWith("'="), `Formula value must be neutralized with leading quote: ${val}`);
      }
    });
  });
  assert.ok(foundInjected, 'Sanitized injected title must be present in sheet');
});

test('Phase 5.2: Employee Workbook generation with zero assignments renders cleanly without error', async () => {
  assertIsolatedTestDatabase();

  const zeroReportData = {
    employee: {
      id: 99,
      name: 'Bob Newcomer',
      email: 'bob@serphawk.com',
      department: 'QA',
      title: 'Junior QA',
    },
    metrics: {
      totalAssigned: 0,
      open: 0,
      inProgress: 0,
      resolved: 0,
      closed: 0,
      overdue: 0,
      blocked: 0,
      weeklyCompleted: 0,
    },
    tickets: [],
    completedTickets: [],
    overdueAndBlockedTickets: [],
    recentActivity: [],
  };

  const buffer = await generateEmployeeWorkbookBuffer({
    employeeReportData: zeroReportData,
    aiObservations: {
      workloadSummary: 'No active ticket assignments in this reporting cycle.',
      productivityHighlights: [],
      activeAttentionItems: [],
      focusRecommendations: ['Check in with your lead regarding upcoming project sprint tasks.'],
    },
    period: {
      startIstLabel: '07 Nov 2026, 06:00 PM IST',
      endIstLabel: '14 Nov 2026, 06:00 PM IST',
    },
  });

  assert.ok(Buffer.isBuffer(buffer), 'Should generate workbook buffer for zero-assignment employee');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  assert.equal(workbook.worksheets.length, 6);

  const overviewSheet = workbook.getWorksheet('My Work Overview');
  assert.ok(overviewSheet.rowCount >= 4, 'Overview sheet should have headers and rows');
});

test('Phase 5.3: Grounded Employee AI Observations offline fallback', async () => {
  assertIsolatedTestDatabase();

  const empData = {
    employee: { id: 1, name: 'Dev One' },
    kpis: {
      totalAssigned: 4,
      openCount: 1,
      completedCount: 2,
      overdueCount: 1,
      blockedCount: 0,
      weeklyCompleted: 1,
    },
    activeTickets: [
      { id: 201, key: 'TK-201', title: 'Fix Auth bug', status: 'in_progress', dueDate: '2026-11-12', daysOverdue: 2, isOverdue: true },
    ],
    completedTickets: [
      { id: 202, key: 'TK-202', title: 'Refactor DB client', completedDate: '15 Nov 2026' },
    ],
    overdueTickets: [
      { id: 201, key: 'TK-201', title: 'Fix Auth bug', daysOverdue: 2 },
    ],
    blockedTickets: [],
    recentActivity: [],
  };

  // Run with offline fallback (no API key in test environment)
  const obs = await generateEmployeeAiObservations({
    employeeReportData: empData,
    period: { startIstLabel: 'Start', endIstLabel: 'End' },
  });

  assert.ok(obs, 'AI observations object should be returned');
  assert.ok(typeof obs.summary === 'string' && obs.summary.length > 0);
  assert.ok(typeof obs.headline === 'string' && obs.headline.length > 0);
  assert.ok(Array.isArray(obs.completedHighlights));
  assert.ok(Array.isArray(obs.upcomingDeadlines));
  assert.ok(Array.isArray(obs.prioritizationSuggestions));
  assert.ok(obs.prioritizationSuggestions.length > 0);
});

test('Phase 6.1: Recipient Resolution respects eligibility and segregates shared emails', async () => {
  assertIsolatedTestDatabase();

  // Seed test users and employees
  await db.prepare('DELETE FROM weekly_report_deliveries').run();
  await db.prepare('DELETE FROM weekly_report_files').run();
  await db.prepare('DELETE FROM weekly_report_runs').run();

  // Create management user with email test.lead@example.com
  await db.prepare("DELETE FROM users WHERE email IN ('test.lead@example.com', 'admin.only@example.com', 'bad.email')").run();
  await db.prepare("DELETE FROM employees WHERE email IN ('test.lead@example.com', 'dev.only@example.com', 'bad.email')").run();

  await db.prepare(`
    INSERT INTO users (name, email, password, role)
    VALUES ('Lead User', 'test.lead@example.com', 'hash', 'admin')
  `).run();

  await db.prepare(`
    INSERT INTO users (name, email, password, role)
    VALUES ('Admin Only', 'admin.only@example.com', 'hash', 'owner')
  `).run();

  // Employee with SAME email as management user ('test.lead@example.com')
  const empRes1 = await db.prepare(`
    INSERT INTO employees (name, email, role, title, department, active)
    VALUES ('Lead User', 'test.lead@example.com', 'developer', 'Lead Dev', 'Engineering', 1)
  `).run();

  // Active employee with unique email
  const empRes2 = await db.prepare(`
    INSERT INTO employees (name, email, role, title, department, active)
    VALUES ('Dev Only', 'dev.only@example.com', 'developer', 'Developer', 'Engineering', 1)
  `).run();

  // Inactive employee (should NOT be included)
  await db.prepare(`
    INSERT INTO employees (name, email, role, title, department, active)
    VALUES ('Inactive Dev', 'inactive@example.com', 'developer', 'Developer', 'Engineering', 0)
  `).run();

  const recipients = await resolveReportRecipients({
    user: { id: 1, role: 'admin' },
    includeEmployees: true,
  });

  assert.ok(recipients.managementRecipients.length >= 2, 'Should resolve at least 2 management users');
  const mgmtEmails = recipients.managementRecipients.map((r) => r.email);
  assert.ok(mgmtEmails.includes('test.lead@example.com'));
  assert.ok(mgmtEmails.includes('admin.only@example.com'));

  assert.ok(recipients.employeeRecipients.length >= 2, 'Should resolve active employees');
  const empEmails = recipients.employeeRecipients.map((r) => r.email);
  assert.ok(empEmails.includes('test.lead@example.com'));
  assert.ok(empEmails.includes('dev.only@example.com'));
  assert.ok(!empEmails.includes('inactive@example.com'), 'Inactive employee must NOT be included');

  // Verify recipient types are cleanly segregated
  const mgmtShared = recipients.managementRecipients.find((r) => r.email === 'test.lead@example.com');
  const empShared = recipients.employeeRecipients.find((r) => r.email === 'test.lead@example.com');

  assert.equal(mgmtShared.recipientType, 'management');
  assert.equal(mgmtShared.employeeId, null);
  assert.equal(empShared.recipientType, 'employee');
  assert.equal(empShared.employeeId, Number(empRes1.lastInsertRowid));
});

test('Phase 6.2: Delivery state machine, atomic claiming, and reconciliation of stale in-flight records', async () => {
  assertIsolatedTestDatabase();

  // Create a test run
  const lock = await acquireRunLock({
    runToken: 'test_phase6_' + Date.now(),
    reportType: 'manual',
    periodType: 'last_7_days',
    periodStart: '2026-11-07 18:00:00',
    periodEnd: '2026-11-14 18:00:00',
    projectScope: 'all',
    requestedBy: 1,
  });
  const run = lock.run;

  // Record a dummy file
  const file = await recordReportFile({
    runId: run.id,
    fileType: 'company_report',
    filename: 'Company_Report.xlsx',
    storageKey: 'reports/weekly/test/company.xlsx',
    fileSizeBytes: 1024,
    status: 'generated',
  });

  // Initialize deliveries
  const recipients = [
    {
      recipientType: 'management',
      email: 'mgmt1@example.com',
      name: 'Mgmt One',
      userId: 1,
      employeeId: null,
      isValid: true,
    },
    {
      recipientType: 'management',
      email: 'bad-email-syntax',
      name: 'Bad Email',
      userId: 2,
      employeeId: null,
      isValid: false,
      skipReason: 'Invalid email syntax',
    },
  ];

  const records = await initializeDeliveryRecords(run.id, recipients, {
    managementFileId: file.id,
  });

  assert.equal(records.length, 2);
  const validRec = records.find((r) => r.recipient_email === 'mgmt1@example.com');
  const invalidRec = records.find((r) => r.recipient_email === 'bad-email-syntax');

  assert.equal(validRec.delivery_status, 'pending');
  assert.equal(invalidRec.delivery_status, 'skipped');

  // Claim record
  const claimed = await claimDeliveryRecord(validRec.id);
  assert.equal(claimed, true, 'First claim must succeed');

  // Second claim on in_flight record must fail (atomic lock)
  const claimedAgain = await claimDeliveryRecord(validRec.id);
  assert.equal(claimedAgain, false, 'Second claim while in_flight must return false');

  // Update result to failed
  await updateDeliveryResult(validRec.id, {
    status: 'failed',
    errorMessage: 'SMTP connection refused',
  });

  const updatedRec = await db.prepare('SELECT * FROM weekly_report_deliveries WHERE id = ?').get(validRec.id);
  assert.equal(updatedRec.delivery_status, 'failed');
  assert.equal(updatedRec.error_message, 'SMTP connection refused');

  // Stale reconciliation test: simulate a record stuck in in_flight with an old last_attempt_at
  const staleInsert = await db.prepare(`
    INSERT INTO weekly_report_deliveries
      (run_id, file_id, recipient_type, recipient_email, delivery_status, last_attempt_at)
    VALUES (?, ?, 'management', 'stale@example.com', 'in_flight', datetime('now', '-20 minutes'))
  `).run(run.id, file.id);

  await reconcileStaleInFlightDeliveries(run.id);

  const staleRec = await db.prepare('SELECT * FROM weekly_report_deliveries WHERE id = ?').get(staleInsert.lastInsertRowid);
  assert.equal(staleRec.delivery_status, 'uncertain', 'Stale in_flight delivery must be marked uncertain');
  assert.ok(staleRec.error_message.includes('timed out in-flight'));
});

test('Phase 6.3: retryFailedDeliveries retries ONLY confirmed failed records and skips accepted/uncertain', async () => {
  assertIsolatedTestDatabase();

  const lock = await acquireRunLock({
    runToken: 'test_phase6_retry_' + Date.now(),
    reportType: 'manual',
    periodType: 'last_7_days',
    periodStart: '2026-11-07 18:00:00',
    periodEnd: '2026-11-14 18:00:00',
    projectScope: 'all',
    requestedBy: 1,
  });
  const run = lock.run;

  const file = await recordReportFile({
    runId: run.id,
    fileType: 'company_report',
    filename: 'Company_Report.xlsx',
    storageKey: 'reports/weekly/test/company.xlsx',
    fileSizeBytes: 1024,
    status: 'generated',
  });

  // Insert 1 accepted, 1 uncertain, 1 failed
  const acc = await db.prepare(`
    INSERT INTO weekly_report_deliveries (run_id, file_id, recipient_type, recipient_email, delivery_status)
    VALUES (?, ?, 'management', 'acc@example.com', 'accepted')
  `).run(run.id, file.id);

  const unc = await db.prepare(`
    INSERT INTO weekly_report_deliveries (run_id, file_id, recipient_type, recipient_email, delivery_status)
    VALUES (?, ?, 'management', 'unc@example.com', 'uncertain')
  `).run(run.id, file.id);

  const fail = await db.prepare(`
    INSERT INTO weekly_report_deliveries (run_id, file_id, recipient_type, recipient_email, delivery_status)
    VALUES (?, ?, 'management', 'fail@example.com', 'failed')
  `).run(run.id, file.id);

  const retryResult = await retryFailedDeliveries(run.id);

  assert.equal(retryResult.retriedCount, 1, 'Only the 1 failed delivery should be retried');

  // Verify accepted and uncertain were untouched
  const accCheck = await db.prepare('SELECT delivery_status FROM weekly_report_deliveries WHERE id = ?').get(acc.lastInsertRowid);
  assert.equal(accCheck.delivery_status, 'accepted');

  const uncCheck = await db.prepare('SELECT delivery_status FROM weekly_report_deliveries WHERE id = ?').get(unc.lastInsertRowid);
  assert.equal(uncCheck.delivery_status, 'uncertain');

  // Verify retry count on run increased
  const runCheck = await db.prepare('SELECT retry_count FROM weekly_report_runs WHERE id = ?').get(run.id);
  assert.equal(runCheck.retry_count, 1);
});

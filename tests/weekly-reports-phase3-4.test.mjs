import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';

const TEST_DB_PATH = path.resolve(process.cwd(), 'data', 'test_weekly_reports_phase3_4.db');

// Ensure isolated test DB cleanup
for (const suffix of ['', '-wal', '-shm']) {
  const f = `${TEST_DB_PATH}${suffix}`;
  if (fs.existsSync(f)) {
    try { fs.unlinkSync(f); } catch {}
  }
}

process.env.DB_DRIVER = 'sqlite';
process.env.SQLITE_DB_PATH = TEST_DB_PATH;
process.env.NEXT_TELEMETRY_DISABLED = '1';

// Disable real AI keys during tests to enforce pure offline testing
delete process.env.OPENAI_API_KEY;
delete process.env.GEMINI_API_KEY;

const { db } = await import('../lib/db.js');
const { assertIsolatedTestDatabase } = await import('../lib/dbEnvironment.js');
const { collectWeeklyReportData } = await import('../lib/weeklyReportService.js');
const {
  validateWeeklyAiInsights,
  buildDatabaseFallbackInsights,
  generateWeeklyAiReportInsights,
} = await import('../lib/weeklyAiReporting.js');
const {
  sanitizeExcelValue,
  generateCompanyWorkbookBuffer,
} = await import('../lib/weeklyExcelGenerator.js');

test.before(() => {
  assertIsolatedTestDatabase('weekly-reports-phase3-4-test');
});

test.after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    const f = `${TEST_DB_PATH}${suffix}`;
    if (fs.existsSync(f)) {
      try { fs.unlinkSync(f); } catch {}
    }
  }
});

test('Phase 3.1: Formula-injection sanitization guards against executable formulas', () => {
  // Test dangerous leading formula characters
  assert.equal(sanitizeExcelValue('=SUM(A1:A10)'), "'=SUM(A1:A10)");
  assert.equal(sanitizeExcelValue('+12345'), "'+12345");
  assert.equal(sanitizeExcelValue('-2+3'), "'-2+3");
  assert.equal(sanitizeExcelValue('@HYPERLINK("http://attacker.com")'), "'@HYPERLINK(\"http://attacker.com\")");
  assert.equal(sanitizeExcelValue('\tCMD'), "'\tCMD");
  assert.equal(sanitizeExcelValue('\rEVIL'), "'\rEVIL");

  // Safe text remains untouched
  assert.equal(sanitizeExcelValue('Normal Ticket Title'), 'Normal Ticket Title');
  assert.equal(sanitizeExcelValue('[PROJ-101] Fix bug'), '[PROJ-101] Fix bug');

  // Primitives preserved without conversion to strings
  assert.equal(sanitizeExcelValue(42), 42);
  assert.equal(sanitizeExcelValue(0), 0);
  assert.equal(sanitizeExcelValue(false), false);
  assert.equal(sanitizeExcelValue(true), true);
  assert.equal(sanitizeExcelValue(null), '');
  assert.equal(sanitizeExcelValue(undefined), '');

  const now = new Date();
  assert.equal(sanitizeExcelValue(now), now);
});

test('Phase 4.1: AI response validation and normalization schema', () => {
  const sampleRaw = {
    headline: '  High Delivery Velocity in Sprint 44  ',
    executiveSummary: '  Team delivered 12 features across 3 projects with zero blockers.  ',
    keyObservations: [' Feature A launched ', ' QA completed in record time '],
    deliveryRisks: [' Ticket [PROJ-5] is slightly delayed '],
    projectBottlenecks: [' Code review turnaround in Project Alpha '],
    blockerPatterns: [' No systemic blockers '],
    groundedRecommendations: [' Focus on regression testing for release '],
    referencedTicketIds: [' [PROJ-5] ', ' [PROJ-9] '],
  };

  const validated = validateWeeklyAiInsights(sampleRaw, 'gpt-4o-mini');
  assert.equal(validated.aiAvailable, true);
  assert.equal(validated.modelName, 'gpt-4o-mini');
  assert.equal(validated.headline, 'High Delivery Velocity in Sprint 44');
  assert.equal(validated.executiveSummary, 'Team delivered 12 features across 3 projects with zero blockers.');
  assert.deepEqual(validated.keyObservations, ['Feature A launched', 'QA completed in record time']);
  assert.deepEqual(validated.deliveryRisks, ['Ticket [PROJ-5] is slightly delayed']);
  assert.deepEqual(validated.referencedTicketIds, ['[PROJ-5]', '[PROJ-9]']);
});

test('Phase 4.2: AI malformed response handling and safe fallback', () => {
  // Invalid inputs throw cleanly inside validator
  assert.throws(() => validateWeeklyAiInsights(null), /valid JSON object/);
  assert.throws(() => validateWeeklyAiInsights('invalid string'), /valid JSON object/);

  // Incomplete object receives safe defaults
  const incomplete = validateWeeklyAiInsights({}, 'test-model');
  assert.equal(incomplete.aiAvailable, true);
  assert.equal(incomplete.headline, 'Executive Weekly Performance Review');
  assert.ok(incomplete.keyObservations.length > 0);
  assert.ok(incomplete.deliveryRisks.length > 0);
});

test('Phase 4.3: Offline database fallback insights generation when AI is unavailable', async () => {
  const mockReportData = {
    period: {
      startIstLabel: '2026-11-07 18:00 IST',
      endIstLabel: '2026-11-14 18:00 IST',
      timezone: 'Asia/Kolkata',
    },
    executiveSummary: {
      companyKPIs: {
        totalCumulativeTickets: 25,
        totalOpenTickets: 10,
        totalClosedTickets: 15,
        completionPercentage: 60,
        totalOverdueTickets: 2,
        totalBlockedTickets: 1,
        totalProjects: 2,
        totalEmployees: 4,
      },
      weeklyActivityKPIs: {
        weeklyCreatedCount: 5,
        weeklyCompletedCount: 4,
        weeklyReopenedCount: 1,
        weeklyUpdatedCount: 8,
        weeklyReassignedCount: 0,
      },
    },
    projectSummary: [],
    employeeSummary: [],
    completeTicketRegister: [],
    blockersAndOverdue: [
      { key: '[PROJ-1]', isOverdue: true, isBlocked: false },
      { key: '[PROJ-2]', isOverdue: true, isBlocked: true },
    ],
    weeklyActivity: [],
    employeeReports: new Map(),
  };

  // When no API keys are in process.env, generateWeeklyAiReportInsights must return database fallback safely
  const insights = await generateWeeklyAiReportInsights(mockReportData);

  assert.equal(insights.aiAvailable, false);
  assert.ok(insights.headline.includes('Database Metrics'));
  assert.ok(insights.executiveSummary.includes('AI analysis is currently unavailable'));
  assert.ok(insights.keyObservations.some((o) => o.includes('Total active tickets in scope: 25')));
  assert.ok(insights.keyObservations.some((o) => o.includes('60%')));
  assert.ok(insights.deliveryRisks.some((r) => r.includes('[PROJ-1]')));
  assert.ok(insights.referencedTicketIds.includes('[PROJ-1]'));
});

test('Phase 3.2: Complete Company Excel Workbook Generation with 7 sheets and verified content', async () => {
  // Create test fixtures in DB
  let adminUser = await db.prepare("SELECT * FROM users WHERE role IN ('owner', 'admin') LIMIT 1").get();
  if (!adminUser) {
    const res = await db.prepare("INSERT INTO users (name, email, password, role) VALUES ('Admin', 'admin@test.com', 'pass', 'admin')").run();
    adminUser = await db.prepare("SELECT * FROM users WHERE id = ?").get(res.lastInsertRowid);
  }

  const proj = await db.prepare("INSERT INTO projects (key, name, description, color) VALUES ('EX', 'Excel Project', 'Testing ExcelJS', '#0c66e4')").run();
  const empA = await db.prepare("INSERT INTO employees (name, email, role, department, title, active) VALUES ('Alice Eng', 'alice@test.com', 'developer', 'Core', 'Lead', 1)").run();
  const empZero = await db.prepare("INSERT INTO employees (name, email, role, department, title, active) VALUES ('Zero Assignment', 'zero@test.com', 'developer', 'Ops', 'Support', 1)").run();

  // Create ticket with malicious formula injection title to verify workbook sanitization
  await db.prepare(`
    INSERT INTO tickets (title, description, status, priority, type, created_by, employee_id, project_id, due_date, created_at, updated_at)
    VALUES ('=CMD|"/c calc"!A1', 'Formula injection payload', 'open', 'urgent', 'bug', ?, ?, ?, '2026-11-01', '2026-11-12T10:00:00.000Z', '2026-11-12T10:00:00.000Z')
  `).run(adminUser.id, empA.lastInsertRowid, proj.lastInsertRowid);

  // Collect report data
  const reportData = await collectWeeklyReportData({
    user: adminUser,
    periodType: 'last_7_days',
  });

  const aiInsights = buildDatabaseFallbackInsights(reportData, 'Testing Offline Fallback');

  // Generate Excel Buffer
  const buffer = await generateCompanyWorkbookBuffer({ reportData, aiInsights });

  assert.ok(Buffer.isBuffer(buffer), 'Result must be a Node.js Buffer');
  assert.ok(buffer.length > 2000, `Buffer size should be reasonable (${buffer.length} bytes)`);

  // Reload workbook using ExcelJS to verify file integrity and valid XML structure
  const reloaded = new ExcelJS.Workbook();
  await reloaded.xlsx.load(buffer);

  // 1. Verify exact 7 sheets
  assert.equal(reloaded.worksheets.length, 7, 'Must have exactly 7 worksheets');

  const expectedSheetNames = [
    'Executive Summary',
    'Project Summary',
    'Employee Summary',
    'Complete Ticket Register',
    'Blockers & Overdue',
    'AI Insights',
    'Weekly Activity',
  ];
  const actualSheetNames = reloaded.worksheets.map((ws) => ws.name);
  assert.deepEqual(actualSheetNames, expectedSheetNames, 'All 7 sheet names must match exactly');

  // 2. Verify Sheet 1: Executive Summary
  const wsExec = reloaded.getWorksheet('Executive Summary');
  assert.ok(wsExec.getCell('A1').value.includes('COMPANY WEEKLY AI TICKET REPORT'));

  // 3. Verify Sheet 3: Employee Summary includes zero-assignment employee
  const wsEmp = reloaded.getWorksheet('Employee Summary');
  let foundZeroAssignment = false;
  wsEmp.eachRow((row) => {
    if (row.getCell(1).value === 'Zero Assignment') {
      foundZeroAssignment = true;
      assert.equal(row.getCell(5).value, 0, 'Total assigned must be 0');
      assert.equal(row.getCell(11).value, 'Available / Zero Assignment');
    }
  });
  assert.ok(foundZeroAssignment, 'Employee with zero assignments must be included on Employee Summary sheet');

  // 4. Verify Sheet 4: Complete Ticket Register has sanitized formula injection
  const wsRegister = reloaded.getWorksheet('Complete Ticket Register');
  let foundInjectedTicket = false;
  wsRegister.eachRow((row) => {
    const titleVal = String(row.getCell(2).value || '');
    if (titleVal.includes('calc')) {
      foundInjectedTicket = true;
      assert.ok(titleVal.startsWith("'="), `Title must be escaped with leading apostrophe, got: ${titleVal}`);
    }
  });
  assert.ok(foundInjectedTicket, 'Malicious formula title must be present and neutralized with leading apostrophe');

  // 5. Verify Sheet 6: AI Insights contains fallback status and grounded content
  const wsAi = reloaded.getWorksheet('AI Insights');
  assert.ok(wsAi.getCell('A1').value.includes('AI EXECUTIVE ANALYSIS'));
  assert.ok(wsAi.getCell('A2').value.includes('Unavailable (Database Fallback Active)'));

  // 6. Verify autofilters on data sheets
  assert.ok(reloaded.getWorksheet('Project Summary').autoFilter, 'Project Summary must have autofilter');
  assert.ok(reloaded.getWorksheet('Employee Summary').autoFilter, 'Employee Summary must have autofilter');
  assert.ok(reloaded.getWorksheet('Complete Ticket Register').autoFilter, 'Ticket Register must have autofilter');
});

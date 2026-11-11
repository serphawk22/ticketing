import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB_PATH = path.resolve(__dirname, '../data/test_phase5_isolated.db');

for (const ext of ['', '-wal', '-shm']) {
  if (fs.existsSync(TEST_DB_PATH + ext)) fs.unlinkSync(TEST_DB_PATH + ext);
}

process.env.DB_DRIVER = 'sqlite';
process.env.SQLITE_DB_PATH = TEST_DB_PATH;
delete process.env.POSTGRES_URL;
delete process.env.DATABASE_URL;

const { db } = await import('../lib/db.js');
const { createSubmission } = await import('../lib/taskSheet.js');
const {
  issueTaskSheetToken,
  listTaskSheetTokens,
  revokeTaskSheetToken,
  exchangeTaskSheetToken,
  validateTaskSheetCookieSession,
} = await import('../lib/taskSheetTokens.js');
const {
  recordTaskSheetWorkLogsTx,
  amendTaskSheetSubmission,
  mapLegacyAnonymousSubmission,
  listUnmappedLegacySubmissions,
} = await import('../lib/workLedger.js');
const { checkRateLimit, resetRateLimiter } = await import('../lib/rateLimiter.js');

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

test('Phase 5: Token hash-only storage, exchange, CSRF check, immediate revocation & rate limiter', async () => {
  resetRateLimiter();

  const adminRes = await db
    .prepare("INSERT INTO users (name, email, password, role) VALUES ('Admin P5', 'adminp5@test.local', 'hash', 'admin')")
    .run();
  const adminActor = { id: Number(adminRes.lastInsertRowid), name: 'Admin P5', role: 'admin' };

  const empUserRes = await db
    .prepare("INSERT INTO users (name, email, password, role) VALUES ('Emp P5', 'empp5@test.local', 'hash', 'employee')")
    .run();
  const empUserId = Number(empUserRes.lastInsertRowid);

  const empRes = await db
    .prepare("INSERT INTO employees (user_id, name, email, role, active) VALUES (?, 'Emp P5', 'empp5@test.local', 'employee', 1)")
    .run(empUserId);
  const empId = Number(empRes.lastInsertRowid);

  const issued = await issueTaskSheetToken({
    employeeId: empId,
    expiresInDays: 14,
    issuedBy: adminActor,
  });
  assert.ok(issued.rawToken.length >= 32);

  // Verify database does NOT store plaintext token
  const rawDbRow = await db
    .prepare('SELECT token_hash, token_hint FROM employee_task_sheet_tokens WHERE id = ?')
    .get(issued.tokenRecord.id);
  assert.notEqual(rawDbRow.token_hash, issued.rawToken);
  assert.equal(rawDbRow.token_hint, issued.rawToken.slice(-6));

  const listed = await listTaskSheetTokens();
  assert.ok(listed.some((r) => r.id === issued.tokenRecord.id && r.token_hash === undefined));

  // Exchange URL token for cookie session + CSRF secret
  const exchanged = await exchangeTaskSheetToken({ rawToken: issued.rawToken, ipPrefix: '127.0.0.1' });
  assert.ok(exchanged && exchanged.sessionSecret && exchanged.csrfSecret);
  assert.equal(exchanged.employee.id, empId);

  // CSRF validation
  const badCsrf = await validateTaskSheetCookieSession({
    sessionCookieValue: exchanged.sessionSecret,
    csrfToken: 'wrong-csrf',
    requireCsrf: true,
  });
  assert.equal(badCsrf.csrfInvalid, true);

  const goodSession = await validateTaskSheetCookieSession({
    sessionCookieValue: exchanged.sessionSecret,
    csrfToken: exchanged.csrfSecret,
    requireCsrf: true,
  });
  assert.equal(goodSession.csrfInvalid, false);
  assert.equal(goodSession.employee.id, empId);

  // Instant revocation invalidates active cookie session AND raw token
  await revokeTaskSheetToken({ tokenId: issued.tokenRecord.id, actor: adminActor });
  const afterRevokeSession = await validateTaskSheetCookieSession({
    sessionCookieValue: exchanged.sessionSecret,
    csrfToken: exchanged.csrfSecret,
    requireCsrf: true,
  });
  assert.equal(afterRevokeSession, null);

  const afterRevokeExchange = await exchangeTaskSheetToken({ rawToken: issued.rawToken, ipPrefix: '127.0.0.1' });
  assert.equal(afterRevokeExchange, null);

  // Rate limiter check
  for (let i = 0; i < 3; i++) {
    assert.equal(checkRateLimit('p5-rl', { limit: 3, windowMs: 60_000 }).allowed, true);
  }
  const blocked = checkRateLimit('p5-rl', { limit: 3, windowMs: 60_000 });
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds >= 1);
});

test('Phase 5: Canonical ledger write, <48h self-correction, >48h lock, admin adjustment & legacy mapping', async () => {
  const adminRes = await db
    .prepare("INSERT INTO users (name, email, password, role) VALUES ('Admin Ledger', 'adminledger@test.local', 'hash', 'admin')")
    .run();
  const adminActor = { id: Number(adminRes.lastInsertRowid), name: 'Admin Ledger', role: 'admin' };

  const empUserRes = await db
    .prepare("INSERT INTO users (name, email, password, role) VALUES ('Dev Ledger', 'devledger@test.local', 'hash', 'employee')")
    .run();
  const devUser = { id: Number(empUserRes.lastInsertRowid), name: 'Dev Ledger', role: 'employee' };

  const empRes = await db
    .prepare("INSERT INTO employees (user_id, name, email, role, active) VALUES (?, 'Dev Ledger', 'devledger@test.local', 'employee', 1)")
    .run(devUser.id);
  const empId = Number(empRes.lastInsertRowid);

  const projRes = await db
    .prepare("INSERT INTO projects (name, key, color) VALUES ('Ledger Project', 'LDP', '#0052cc')")
    .run();
  const projectId = Number(projRes.lastInsertRowid);

  const tktRes = await db
    .prepare("INSERT INTO tickets (project_id, title, description, status, priority, employee_id, created_by, assigned_to) VALUES (?, 'Ticket 1', 'Test desc', 'in_progress', 'medium', ?, ?, ?)")
    .run(projectId, empId, adminActor.id, devUser.id);
  const ticketId = Number(tktRes.lastInsertRowid);

  // 1. Record Task Sheet submission + multi-item ledger (3h ticket work + 1h company meeting)
  const sub = await db.transaction(async (tx) => {
    const s = await createSubmission({
      submittedBy: devUser.id,
      name: 'Dev Ledger',
      project: 'Ledger Project',
      hoursWorked: 4,
      taskTitle: 'LDP-1',
      taskDescription: 'Worked on backend and team standup',
      taskState: 'completed',
      linkedTicketId: ticketId,
      executor: tx,
    });
    await recordTaskSheetWorkLogsTx(tx, {
      submissionId: s.id,
      employeeId: empId,
      userId: devUser.id,
      workDate: '2026-11-10',
      payload: {
        hoursWorked: 4,
        selectedTickets: [{ id: ticketId, minutes: 180, workState: 'completed', categoryCode: 'development' }],
        otherActivitiesEntries: [{ categoryCode: 'meeting', minutes: 60, description: 'Sprint review' }],
      },
    });
    return s;
  });

  const sum1 = await db
    .prepare('SELECT COALESCE(SUM(duration_minutes), 0) AS total FROM employee_work_logs WHERE employee_id = ?')
    .get(empId);
  assert.equal(sum1.total, 240);

  // 2. Self-correction within 48h updates ledger cleanly (change to 2h ticket + 30m meeting = 150m)
  const amendRes = await amendTaskSheetSubmission({
    submissionId: sub.id,
    reason: 'Corrected meeting duration from 60m to 30m',
    actor: devUser,
    employeeActorId: empId,
    amendedPayload: {
      workDate: '2026-11-10',
      hoursWorked: 2.5,
      selectedTickets: [{ id: ticketId, minutes: 120, workState: 'completed', categoryCode: 'development' }],
      otherActivitiesEntries: [{ categoryCode: 'meeting', minutes: 30, description: 'Short sprint sync' }],
    },
    idempotencyKey: 'amend-key-1',
  });
  assert.equal(amendRes.idempotent, false);

  // Duplicate retry returns idempotent without duplicating adjustment rows
  const amendDup = await amendTaskSheetSubmission({
    submissionId: sub.id,
    reason: 'Corrected meeting duration from 60m to 30m',
    actor: devUser,
    employeeActorId: empId,
    amendedPayload: {
      workDate: '2026-11-10',
      hoursWorked: 2.5,
    },
    idempotencyKey: 'amend-key-1',
  });
  assert.equal(amendDup.idempotent, true);

  const sum2 = await db
    .prepare('SELECT COALESCE(SUM(duration_minutes), 0) AS total FROM employee_work_logs WHERE employee_id = ?')
    .get(empId);
  assert.equal(sum2.total, 150);

  // Original raw submission remains untouched
  const rawSub = await db.prepare('SELECT hours_worked FROM task_sheet_submissions WHERE id = ?').get(sub.id);
  assert.equal(rawSub.hours_worked, 4);

  // 3. Backdate submission >48h ago and verify employee self-correction is blocked (403) while Admin adjustment succeeds
  await db
    .prepare("UPDATE task_sheet_submissions SET created_at = datetime('now', '-72 hours') WHERE id = ?")
    .run(sub.id);

  await assert.rejects(
    () =>
      amendTaskSheetSubmission({
        submissionId: sub.id,
        reason: 'Late edit attempt by employee',
        actor: devUser,
        employeeActorId: empId,
        amendedPayload: { workDate: '2026-11-10', hoursWorked: 5 },
      }),
    (err) => err.statusCode === 403
  );

  await amendTaskSheetSubmission({
    submissionId: sub.id,
    reason: 'Admin verified actual logged time was 3 hours on ticket',
    actor: adminActor,
    amendedPayload: {
      workDate: '2026-11-10',
      hoursWorked: 3,
      selectedTickets: [{ id: ticketId, minutes: 180, workState: 'completed', categoryCode: 'development' }],
    },
  });

  const sum3 = await db
    .prepare('SELECT COALESCE(SUM(duration_minutes), 0) AS total FROM employee_work_logs WHERE employee_id = ?')
    .get(empId);
  assert.equal(sum3.total, 180);

  // 4. Legacy anonymous submission preserved + retrospect admin mapping
  const legacySub = await createSubmission({
    submittedBy: null,
    name: 'Dev Ledger Legacy',
    project: 'Ledger Project',
    hoursWorked: 2,
    taskTitle: 'Legacy Task',
    taskDescription: 'Submitted before token enforcement',
    taskState: 'completed',
    linkedTicketId: ticketId,
  });

  const unmappedBefore = await listUnmappedLegacySubmissions();
  assert.ok(unmappedBefore.some((r) => r.id === legacySub.id));

  await mapLegacyAnonymousSubmission({
    submissionId: legacySub.id,
    employeeId: empId,
    reason: 'Verified via attendance log for Nov 10',
    actor: adminActor,
  });

  const unmappedAfter = await listUnmappedLegacySubmissions();
  assert.equal(unmappedAfter.some((r) => r.id === legacySub.id), false);

  // Original anonymous submission submitted_by stays NULL permanently
  const rawLegacy = await db.prepare('SELECT submitted_by FROM task_sheet_submissions WHERE id = ?').get(legacySub.id);
  assert.equal(rawLegacy.submitted_by, null);

  // Total employee effort = 180 (amended) + 120 (mapped legacy) = 300 minutes
  const sumFinal = await db
    .prepare('SELECT COALESCE(SUM(duration_minutes), 0) AS total FROM employee_work_logs WHERE employee_id = ?')
    .get(empId);
  assert.equal(sumFinal.total, 300);
});

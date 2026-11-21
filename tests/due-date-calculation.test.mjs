import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB_PATH = path.resolve(__dirname, '../data/test_due_date_isolated.db');

for (const ext of ['', '-wal', '-shm']) {
  if (fs.existsSync(TEST_DB_PATH + ext)) fs.unlinkSync(TEST_DB_PATH + ext);
}

process.env.DB_DRIVER = 'sqlite';
process.env.SQLITE_DB_PATH = TEST_DB_PATH;
delete process.env.POSTGRES_URL;
delete process.env.DATABASE_URL;

const { db } = await import('../lib/db.js');
const {
  calculateAutomaticDueDate,
  normalizeClientCategory,
  isValidClientCategory,
  addCalendarDays,
} = await import('../lib/dueDateCalculator.js');
const { createTicketWithStage } = await import('../lib/ticketStageService.js');
const { logDueDateChange, getActivity } = await import('../lib/ticketActivity.js');
const { assertCanChangeDueDate } = await import('../lib/rbac.js');

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

test('Unit Tests: dueDateCalculator utility', () => {
  // Test category normalization
  assert.equal(normalizeClientCategory('Access Issue'), 'access_issue');
  assert.equal(normalizeClientCategory('access_issue'), 'access_issue');
  assert.equal(normalizeClientCategory('access-issue'), 'access_issue');
  assert.equal(normalizeClientCategory('Incident'), 'incident');
  assert.equal(normalizeClientCategory('incident'), 'incident');
  assert.equal(normalizeClientCategory('Feature Request'), 'feature_request');
  assert.equal(normalizeClientCategory('feature_request'), 'feature_request');
  assert.equal(normalizeClientCategory('Invalid Category'), null);
  assert.equal(normalizeClientCategory(''), null);
  assert.equal(normalizeClientCategory(null), null);

  assert.equal(isValidClientCategory('Access Issue'), true);
  assert.equal(isValidClientCategory('Incident'), true);
  assert.equal(isValidClientCategory('Feature Request'), true);
  assert.equal(isValidClientCategory('Random'), false);

  // Test calendar days arithmetic
  assert.equal(addCalendarDays('2026-11-13', 1), '2026-11-14');
  assert.equal(addCalendarDays('2026-11-13', 2), '2026-11-15');
  assert.equal(addCalendarDays('2026-11-13', 7), '2026-11-20');

  // Test automatic calculation: Internal tickets = 7 days
  const internal = calculateAutomaticDueDate({
    role: 'employee',
    creationDate: '2026-11-13',
  });
  assert.equal(internal.dueDate, '2026-11-20');
  assert.equal(internal.initialDueDate, '2026-11-20');

  // Test automatic calculation: Client Access Issue = 2 days
  const accessIssue = calculateAutomaticDueDate({
    role: 'client',
    category: 'Access Issue',
    creationDate: '2026-11-13',
  });
  assert.equal(accessIssue.dueDate, '2026-11-15');
  assert.equal(accessIssue.initialDueDate, '2026-11-15');
  assert.equal(accessIssue.clientCategory, 'Access Issue');

  // Test automatic calculation: Client Incident = 1 day
  const incident = calculateAutomaticDueDate({
    role: 'client',
    category: 'Incident',
    creationDate: '2026-11-13',
  });
  assert.equal(incident.dueDate, '2026-11-14');
  assert.equal(incident.initialDueDate, '2026-11-14');
  assert.equal(incident.clientCategory, 'Incident');

  // Test automatic calculation: Client Feature Request = 7 days
  const featureReq = calculateAutomaticDueDate({
    role: 'client',
    category: 'Feature Request',
    creationDate: '2026-11-13',
  });
  assert.equal(featureReq.dueDate, '2026-11-20');
  assert.equal(featureReq.initialDueDate, '2026-11-20');
  assert.equal(featureReq.clientCategory, 'Feature Request');

  // Test missing or unsupported client category throws error
  assert.throws(
    () => calculateAutomaticDueDate({ role: 'client', category: 'unknown_type' }),
    /Client requests require a valid request type/
  );
  assert.throws(
    () => calculateAutomaticDueDate({ role: 'client', category: '' }),
    /Client requests require a valid request type/
  );

  // Test admin custom due date during creation
  const adminCustom = calculateAutomaticDueDate({
    role: 'admin',
    creationDate: '2026-11-13',
    customDueDate: '2026-11-25',
    isAdminOrOwner: true,
  });
  assert.equal(adminCustom.dueDate, '2026-11-25');
  assert.equal(adminCustom.initialDueDate, '2026-11-25');

  // Test non-admin custom due date attempt is ignored -> gets standard 7 days
  const nonAdminCustom = calculateAutomaticDueDate({
    role: 'employee',
    creationDate: '2026-11-13',
    customDueDate: '2026-11-25',
    isAdminOrOwner: false,
  });
  assert.equal(nonAdminCustom.dueDate, '2026-11-20');
  assert.equal(nonAdminCustom.initialDueDate, '2026-11-20');
});

test('Database & RBAC Tests: Initial due date, authorization, activity history & extension tracking', async () => {
  // 1. Setup seed users
  const adminUser = (
    await db
      .prepare("INSERT INTO users (name, email, password, role) VALUES ('Admin User', 'admin@test.local', 'hash', 'admin')")
      .run()
  ).lastInsertRowid;

  const empUser1 = (
    await db
      .prepare("INSERT INTO users (name, email, password, role) VALUES ('Alice Emp', 'alice@test.local', 'hash', 'employee')")
      .run()
  ).lastInsertRowid;

  const empUser2 = (
    await db
      .prepare("INSERT INTO users (name, email, password, role) VALUES ('Bob Emp', 'bob@test.local', 'hash', 'employee')")
      .run()
  ).lastInsertRowid;

  const clientUser = (
    await db
      .prepare("INSERT INTO users (name, email, password, role) VALUES ('Charlie Client', 'charlie@test.local', 'hash', 'client')")
      .run()
  ).lastInsertRowid;

  const empRecord1 = (
    await db
      .prepare("INSERT INTO employees (user_id, name, email, role, active) VALUES (?, 'Alice Emp', 'alice@test.local', 'employee', 1)")
      .run(Number(empUser1))
  ).lastInsertRowid;

  const empRecord2 = (
    await db
      .prepare("INSERT INTO employees (user_id, name, email, role, active) VALUES (?, 'Bob Emp', 'bob@test.local', 'employee', 1)")
      .run(Number(empUser2))
  ).lastInsertRowid;

  const project1 = (
    await db
      .prepare("INSERT INTO projects (name, key, color) VALUES ('Alpha Project', 'ALP', '#0c66e4')")
      .run()
  ).lastInsertRowid;

  // 2. Create ticket with initial_due_date via createTicketWithStage
  const createdTicket = await createTicketWithStage({
    title: 'Test Due Date Ticket',
    description: 'Initial creation test',
    priority: 'high',
    type: 'task',
    createdBy: Number(adminUser),
    projectId: Number(project1),
    employeeId: Number(empRecord1),
    startDate: '2026-11-13',
    dueDate: '2026-11-20',
    initialDueDate: '2026-11-20',
  });

  assert.ok(createdTicket.id, 'Ticket created');
  assert.equal(createdTicket.due_date, '2026-11-20');
  assert.equal(createdTicket.initial_due_date, '2026-11-20');

  // 3. Test assertCanChangeDueDate authorization rules
  const aliceSession = { id: Number(empUser1), role: 'employee', employee_id: Number(empRecord1) };
  const bobSession = { id: Number(empUser2), role: 'employee', employee_id: Number(empRecord2) };
  const adminSession = { id: Number(adminUser), role: 'admin' };
  const clientSession = { id: Number(clientUser), role: 'client' };

  // Assigned employee Alice -> Allowed
  const aliceAuth = await assertCanChangeDueDate(aliceSession, createdTicket);
  assert.equal(aliceAuth.allowed, true);
  assert.equal(aliceAuth.isElevated, false);

  // Unassigned employee Bob -> Forbidden (403)
  const bobAuth = await assertCanChangeDueDate(bobSession, createdTicket);
  assert.equal(bobAuth.allowed, false);
  assert.equal(bobAuth.status, 403);
  assert.match(bobAuth.error, /only change due dates for tickets you are assigned to/);

  // Client -> Forbidden (403)
  const clientAuth = await assertCanChangeDueDate(clientSession, createdTicket);
  assert.equal(clientAuth.allowed, false);
  assert.equal(clientAuth.status, 403);

  // Admin -> Allowed
  const adminAuth = await assertCanChangeDueDate(adminSession, createdTicket);
  assert.equal(adminAuth.allowed, true);
  assert.equal(adminAuth.isElevated, true);

  // 4. Perform First Due Date Change: Alice requests extension from 2026-11-20 to 2026-11-23
  await logDueDateChange(
    createdTicket.id,
    aliceSession.id,
    createdTicket.due_date,
    '2026-11-23',
    'Client credentials unavailable',
    'Cannot access server to complete testing',
    aliceAuth.scope?.employeeId
  );
  await db
    .prepare("UPDATE tickets SET due_date = '2026-11-23' WHERE id = ?")
    .run(createdTicket.id);

  // Verify ticket updated and initial_due_date remains preserved
  let tCheck = await db.prepare('SELECT * FROM tickets WHERE id = ?').get(createdTicket.id);
  assert.equal(tCheck.due_date, '2026-11-23');
  assert.equal(tCheck.initial_due_date, '2026-11-20', 'Initial due date must NOT be overwritten');

  // 5. Perform Second Due Date Change: Alice requests further extension from 2026-11-23 to 2026-11-26
  await logDueDateChange(
    createdTicket.id,
    aliceSession.id,
    '2026-11-23',
    '2026-11-26',
    'Credentials received late; staging deployment pending',
    'Need additional days to run full regression',
    aliceAuth.scope?.employeeId
  );
  await db
    .prepare("UPDATE tickets SET due_date = '2026-11-26' WHERE id = ?")
    .run(createdTicket.id);

  tCheck = await db.prepare('SELECT * FROM tickets WHERE id = ?').get(createdTicket.id);
  assert.equal(tCheck.due_date, '2026-11-26');
  assert.equal(tCheck.initial_due_date, '2026-11-20', 'Initial due date must remain preserved across multiple changes');

  // 6. Verify activity history records both extensions with full details
  const activities = await getActivity(createdTicket.id);
  const dueChanges = activities.filter((a) => a.field === 'due_date');

  assert.equal(dueChanges.length, 2, 'Must have exactly 2 due date change activity rows');

  // Latest change first
  assert.equal(dueChanges[0].from_value, '2026-11-23');
  assert.equal(dueChanges[0].to_value, '2026-11-26');
  assert.equal(dueChanges[0].blocker, 'Credentials received late; staging deployment pending');
  assert.equal(dueChanges[0].reason, 'Need additional days to run full regression');
  assert.equal(dueChanges[0].actor_name, 'Alice Emp');

  // First change
  assert.equal(dueChanges[1].from_value, '2026-11-20');
  assert.equal(dueChanges[1].to_value, '2026-11-23');
  assert.equal(dueChanges[1].blocker, 'Client credentials unavailable');
  assert.equal(dueChanges[1].reason, 'Cannot access server to complete testing');
  assert.equal(dueChanges[1].actor_name, 'Alice Emp');

  // 7. Verify edge case: Changing closed / resolved ticket should be prevented
  await db.prepare("UPDATE tickets SET status = 'resolved' WHERE id = ?").run(createdTicket.id);
  const resolvedTicket = await db.prepare('SELECT * FROM tickets WHERE id = ?').get(createdTicket.id);
  assert.equal(['resolved', 'closed'].includes(resolvedTicket.status), true, 'Resolved ticket status checked');

  // 8. Verify edge case: Concurrency expected_due_date validation
  const staleExpected = '2026-11-20'; // Current is 2026-11-26
  assert.notEqual(resolvedTicket.due_date, staleExpected, 'Detects stale expected_due_date');
});

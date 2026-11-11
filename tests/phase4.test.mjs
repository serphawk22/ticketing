import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB_PATH = path.resolve(__dirname, '../data/test_phase4_isolated.db');

for (const ext of ['', '-wal', '-shm']) {
  if (fs.existsSync(TEST_DB_PATH + ext)) fs.unlinkSync(TEST_DB_PATH + ext);
}

process.env.DB_DRIVER = 'sqlite';
process.env.SQLITE_DB_PATH = TEST_DB_PATH;
delete process.env.POSTGRES_URL;
delete process.env.DATABASE_URL;

const { db } = await import('../lib/db.js');
const {
  createTicketWithStage,
  transitionTicketStatus,
  syncStageOnArchiveState,
  applyStageCorrection,
  getTicketTimeAudit,
} = await import('../lib/ticketStageService.js');

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

test('Phase 4: Create -> Transition -> Backward Reopen -> Idempotency -> Archive -> Immutable Correction', async () => {
  const uRes = await db
    .prepare("INSERT INTO users (name, email, password, role) VALUES ('Admin P4', 'adminp4@test.local', 'hash', 'admin')")
    .run();
  const actor = { id: Number(uRes.lastInsertRowid), name: 'Admin P4', role: 'admin' };

  const devRes = await db
    .prepare("INSERT INTO users (name, email, password, role) VALUES ('Dev P4', 'devp4@test.local', 'hash', 'employee')")
    .run();
  const devUser = { id: Number(devRes.lastInsertRowid), name: 'Dev P4', role: 'employee' };

  const pRes = await db
    .prepare("INSERT INTO projects (key, name, color) VALUES ('STG', 'Stage Proj', '#0c66e4')")
    .run();
  const projectId = Number(pRes.lastInsertRowid);

  // 1. Create ticket opens seq=1 ('open', exit_at IS NULL)
  const created = await createTicketWithStage({
    title: 'Stage Test Ticket',
    description: 'Testing stage audit transitions',
    createdBy: actor.id,
    projectId,
    source: 'create',
  });
  assert.equal(created.status, 'open');

  let stages = await db
    .prepare('SELECT * FROM ticket_stage_history WHERE ticket_id = ? ORDER BY transition_seq ASC')
    .all(created.id);
  assert.equal(stages.length, 1);
  assert.equal(stages[0].to_status, 'open');
  assert.equal(stages[0].exit_at, null);
  assert.equal(stages[0].is_reopen, 0);

  // Reject invalid stage (e.g., code_review does not exist)
  await assert.rejects(
    () =>
      transitionTicketStatus({
        ticketId: created.id,
        toStatus: 'code_review',
        actor,
        source: 'board',
      }),
    /Invalid or inactive workflow stage/
  );

  // 2. Forward transitions: open -> in_progress -> resolved -> closed
  const r1 = await transitionTicketStatus({
    ticketId: created.id,
    toStatus: 'in_progress',
    actor,
    source: 'board',
    idempotencyKey: 'tx-key-1',
  });
  assert.equal(r1.transitioned, true);
  assert.equal(r1.ticket.status, 'in_progress');

  // Replay with same idempotencyKey MUST be no-op
  const r1Dup = await transitionTicketStatus({
    ticketId: created.id,
    toStatus: 'in_progress',
    actor,
    source: 'board',
    idempotencyKey: 'tx-key-1',
  });
  assert.equal(r1Dup.idempotent, true);

  await transitionTicketStatus({ ticketId: created.id, toStatus: 'resolved', actor, source: 'list' });
  await transitionTicketStatus({ ticketId: created.id, toStatus: 'closed', actor, source: 'detail' });

  // 3. Reopen: closed -> in_progress (backward transition => is_reopen = 1)
  await transitionTicketStatus({ ticketId: created.id, toStatus: 'in_progress', actor, source: 'task_sheet' });

  stages = await db
    .prepare('SELECT * FROM ticket_stage_history WHERE ticket_id = ? ORDER BY transition_seq ASC')
    .all(created.id);
  assert.equal(stages.length, 5);
  assert.equal(stages[4].from_status, 'closed');
  assert.equal(stages[4].to_status, 'in_progress');
  assert.equal(stages[4].is_reopen, 1);
  assert.equal(stages[4].exit_at, null);

  // 4. Archive closes the single open stage once
  await db.prepare('UPDATE tickets SET archived = 1 WHERE id = ?').run(created.id);
  await syncStageOnArchiveState({ ticketId: created.id, archived: 1, actor });
  stages = await db
    .prepare('SELECT * FROM ticket_stage_history WHERE ticket_id = ? ORDER BY transition_seq ASC')
    .all(created.id);
  assert.notEqual(stages[4].exit_at, null);

  // Original closed row must remain immutable via DB trigger
  await assert.rejects(
    () => db.prepare("UPDATE ticket_stage_history SET to_status = 'closed' WHERE id = ?").run(stages[0].id),
    /immutable/
  );

  // 5. Non-admin correction rejected; Admin correction appends to ticket_stage_corrections without modifying original
  await assert.rejects(
    () =>
      applyStageCorrection({
        ticketId: created.id,
        stageHistoryId: stages[1].id,
        correctedEntryAt: '2026-10-26T03:30:00Z',
        correctedExitAt: '2026-10-26T05:30:00Z',
        reason: 'Dev should not correct',
        actor: devUser,
      }),
    /Forbidden/
  );

  const correction = await applyStageCorrection({
    ticketId: created.id,
    stageHistoryId: stages[1].id,
    correctedEntryAt: '2026-10-26T03:30:00Z', // Mon 09:00 IST
    correctedExitAt: '2026-10-26T05:30:00Z',  // Mon 11:00 IST -> 2h = 7200s
    correctedToStatus: 'in_progress',
    reason: 'Team actually started work at 9 AM Monday IST',
    actor,
  });
  assert.equal(correction.recalculated_calendar_seconds, 7200);
  assert.equal(correction.recalculated_business_seconds, 7200);

  // Verify original stage row was NOT mutated, while effective time audit reflects correction
  const rawStage1 = await db.prepare('SELECT * FROM ticket_stage_history WHERE id = ?').get(stages[1].id);
  assert.equal(rawStage1.entry_at, stages[1].entry_at);

  const audit = await getTicketTimeAudit(created.id);
  assert.equal(audit.corrections.length, 1);
  assert.equal(audit.totals.reopenCount, 1);
  const correctedRow = audit.timeline.find((r) => r.id === stages[1].id);
  assert.equal(correctedRow.has_correction, true);
  assert.equal(correctedRow.effective_business_seconds, 7200);
  assert.equal(correctedRow.entry_at, stages[1].entry_at); // original intact
});

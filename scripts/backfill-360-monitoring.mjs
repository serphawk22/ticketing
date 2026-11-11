import { db } from '../lib/db.js';
import { assertMigrationContextOnly } from '../lib/dbEnvironment.js';
import { calculateBusinessSeconds, toKolkata } from '../lib/businessHours.js';

const PROVISIONAL_BASELINE_UTC_MS = Date.parse('2026-10-24T00:00:00+05:30');
const VALID_STAGE_SET = new Set(['open', 'in_progress', 'resolved', 'closed']);

function parseUtcMs(str) {
  if (!str) return null;
  const iso = str.includes('T') ? str : str.replace(' ', 'T') + (str.endsWith('Z') ? '' : 'Z');
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

function resolveBackfillPrecision(entryAtStr, exitAtStr) {
  const entryMs = parseUtcMs(entryAtStr);
  const exitMs = exitAtStr ? parseUtcMs(exitAtStr) : Date.now();
  if (entryMs == null || exitMs == null) return 'estimated_pre_schedule';
  if (exitMs < PROVISIONAL_BASELINE_UTC_MS) return 'estimated_pre_schedule';
  if (entryMs >= PROVISIONAL_BASELINE_UTC_MS) return 'provisional_baseline';
  return 'mixed_estimated';
}

function toIstDate(tsStr) {
  const ms = parseUtcMs(tsStr);
  if (ms == null) return null;
  return toKolkata(new Date(ms)).toISOString().slice(0, 10);
}

async function runBackfill() {
  const commit = process.argv.includes('--commit');
  const env = assertMigrationContextOnly('scripts/backfill-360-monitoring.mjs');

  console.log(`[backfill-360] Active Target: ${env.dialect} -> ${env.target}`);
  console.log(`[backfill-360] Mode: ${commit ? 'COMMIT BACKFILL (--commit)' : 'DRY-RUN PREVIEW'}`);

  const baselineSchedule = await db
    .prepare(
      `SELECT id, effective_from, effective_date_status
       FROM business_schedule_history
       WHERE test_run_id IS NULL
       ORDER BY id ASC LIMIT 1`
    )
    .get();

  const tickets = await db
    .prepare('SELECT id, project_id, status, created_by, created_at, archived, archived_at, archived_by FROM tickets ORDER BY id ASC')
    .all();

  const validTicketIds = new Set(tickets.map((t) => Number(t.id)));
  const existingStageTickets = new Set(
    (await db.prepare('SELECT DISTINCT ticket_id FROM ticket_stage_history').all()).map((r) => r.ticket_id)
  );

  const stageRowsToInsert = [];
  for (const t of tickets) {
    if (existingStageTickets.has(t.id)) continue;

    const activities = await db
      .prepare(
        `SELECT id, actor_id, from_value, to_value, created_at
         FROM ticket_activity
         WHERE ticket_id = ? AND field = 'status'
         ORDER BY created_at ASC, id ASC`
      )
      .all(t.id);

    // Infer initial stage from first status change's from_value, fallback to ticket's current status if zero status transitions exist.
    const initialStatus =
      activities.length > 0 && VALID_STAGE_SET.has(activities[0].from_value)
        ? activities[0].from_value
        : VALID_STAGE_SET.has(t.status)
          ? t.status
          : 'open';

    const transitions = [];
    let currentStatus = initialStatus;
    let currentEntryAt = t.created_at;
    let currentActor = t.created_by;
    let seq = 1;
    let seenTerminalOrResolved = false;

    for (const act of activities) {
      const targetStatus = VALID_STAGE_SET.has(act.to_value) ? act.to_value : currentStatus;
      if (targetStatus === currentStatus) continue;

      const startMs = parseUtcMs(currentEntryAt);
      const endMs = parseUtcMs(act.created_at);
      const calSec = startMs != null && endMs != null ? Math.max(0, Math.floor((endMs - startMs) / 1000)) : 0;
      const bizSec = startMs != null && endMs != null && endMs > startMs
        ? calculateBusinessSeconds(new Date(startMs), new Date(endMs))
        : 0;
      const precision = resolveBackfillPrecision(currentEntryAt, act.created_at);

      transitions.push({
        ticket_id: t.id,
        project_id: t.project_id,
        transition_seq: seq++,
        from_status: transitions.length === 0 ? null : transitions[transitions.length - 1].to_status,
        to_status: currentStatus,
        changed_by: currentActor,
        source: 'backfill',
        entry_at: currentEntryAt,
        exit_at: act.created_at,
        calendar_seconds: calSec,
        business_seconds: bizSec,
        schedule_version_id: precision === 'estimated_pre_schedule' ? null : baselineSchedule?.id ?? null,
        duration_precision: precision,
        is_reopen: seenTerminalOrResolved && (currentStatus === 'open' || currentStatus === 'in_progress') ? 1 : 0,
        idempotency_key: `backfill:t:${t.id}:seq:${seq - 1}`,
      });

      if (currentStatus === 'resolved' || currentStatus === 'closed') {
        seenTerminalOrResolved = true;
      }
      currentStatus = targetStatus;
      currentEntryAt = act.created_at;
      currentActor = act.actor_id || t.created_by;
    }

    // Current/final stage (open unless ticket was already archived)
    const isArchived = Number(t.archived) === 1;
    const finalExitAt = isArchived ? (t.archived_at || currentEntryAt) : null;
    let finalCal = null;
    let finalBiz = null;
    if (finalExitAt) {
      const sMs = parseUtcMs(currentEntryAt);
      const eMs = parseUtcMs(finalExitAt);
      finalCal = sMs != null && eMs != null ? Math.max(0, Math.floor((eMs - sMs) / 1000)) : 0;
      finalBiz = sMs != null && eMs != null && eMs > sMs ? calculateBusinessSeconds(new Date(sMs), new Date(eMs)) : 0;
    }
    const finalPrecision = resolveBackfillPrecision(currentEntryAt, finalExitAt);

    transitions.push({
      ticket_id: t.id,
      project_id: t.project_id,
      transition_seq: seq,
      from_status: transitions.length === 0 ? null : transitions[transitions.length - 1].to_status,
      to_status: currentStatus,
      changed_by: currentActor,
      source: 'backfill',
      entry_at: currentEntryAt,
      exit_at: finalExitAt,
      calendar_seconds: finalCal,
      business_seconds: finalBiz,
      schedule_version_id: finalPrecision === 'estimated_pre_schedule' ? null : baselineSchedule?.id ?? null,
      duration_precision: finalPrecision,
      is_reopen: seenTerminalOrResolved && (currentStatus === 'open' || currentStatus === 'in_progress') ? 1 : 0,
      idempotency_key: `backfill:t:${t.id}:seq:${seq}`,
    });

    stageRowsToInsert.push(...transitions);
  }

  // Task Sheet & Non-Task-Sheet Ticket Time Logs -> canonical employee_work_logs
  const employees = await db.prepare('SELECT id, user_id FROM employees').all();
  const empByUserId = new Map(employees.filter((e) => e.user_id).map((e) => [e.user_id, e.id]));
  const projects = await db.prepare('SELECT id, name FROM projects').all();
  const projectByName = new Map(projects.map((p) => [p.name.toLowerCase(), p.id]));

  const sheets = await db
    .prepare('SELECT * FROM task_sheet_submissions ORDER BY id ASC')
    .all();

  const sheetUpdates = [];
  const workLogsToInsert = [];
  let legacyAnonymousCount = 0;

  for (const s of sheets) {
    const workDate = s.work_date || toIstDate(s.created_at) || '2026-10-06';
    if (!s.submitted_by) {
      // Strictly preserve anonymous records untouched for manual Admin verification!
      legacyAnonymousCount += 1;
      sheetUpdates.push({
        id: s.id,
        work_date: workDate,
        employee_id: null,
        submission_auth_mode: 'legacy_anonymous',
      });
      continue;
    }

    const empId = s.employee_id || empByUserId.get(s.submitted_by) || null;
    sheetUpdates.push({
      id: s.id,
      work_date: workDate,
      employee_id: empId,
      submission_auth_mode: 'session',
    });

    if (!empId) continue;

    let parsedTickets = [];
    try {
      if (s.tickets_detail) {
        const arr = JSON.parse(s.tickets_detail);
        if (Array.isArray(arr)) parsedTickets = arr;
      }
    } catch {}

    const totalMinutes = Math.max(0, Math.round(Number(s.hours_worked || 0) * 60));
    if (parsedTickets.length > 0) {
      const perTicketBase = Math.floor(totalMinutes / parsedTickets.length);
      let remainder = totalMinutes - perTicketBase * parsedTickets.length;
      parsedTickets.forEach((pt, idx) => {
        const mins = perTicketBase + (remainder > 0 ? (remainder--, 1) : 0);
        workLogsToInsert.push({
          employee_id: empId,
          user_id: s.submitted_by,
          work_date: workDate,
          entry_type: 'ticket_work',
          entry_kind: 'initial',
          project_id: projectByName.get(String(s.project || '').toLowerCase()) || null,
          ticket_id: Number.isInteger(Number(pt.id)) && validTicketIds.has(Number(pt.id)) ? Number(pt.id) : null,
          category_code: 'development',
          duration_minutes: Math.min(mins, 1440),
          work_description: `${s.task_title}: ${s.task_description}`.slice(0, 1000),
          completed_work: pt.workState === 'completed' ? s.task_description : '',
          pending_work: pt.workState === 'not_completed' ? s.task_description : '',
          blocker_text: pt.blocker || s.blocker || '',
          task_state: s.task_state,
          source_type: 'backfill',
          source_id: s.id,
          source_item_index: idx,
        });
      });
    } else {
      workLogsToInsert.push({
        employee_id: empId,
        user_id: s.submitted_by,
        work_date: workDate,
        entry_type: s.linked_ticket_id ? 'ticket_work' : 'company_activity',
        entry_kind: 'initial',
        project_id: projectByName.get(String(s.project || '').toLowerCase()) || null,
        ticket_id: s.linked_ticket_id && validTicketIds.has(Number(s.linked_ticket_id)) ? Number(s.linked_ticket_id) : null,
        category_code: s.linked_ticket_id ? 'development' : 'other_company_work',
        duration_minutes: Math.min(totalMinutes, 1440),
        work_description: `${s.task_title}: ${s.task_description}`.slice(0, 1000),
        completed_work: s.task_state === 'completed' ? s.task_description : '',
        pending_work: s.task_state === 'not_completed' ? s.task_description : '',
        blocker_text: s.blocker || '',
        task_state: s.task_state,
        source_type: 'backfill',
        source_id: s.id,
        source_item_index: 0,
      });
    }
  }

  // Standalone manual ticket_time_logs ONLY (strictly exclude 'Task Sheet:%' to avoid double counting)
  const manualLogs = await db
    .prepare(
      `SELECT l.*, t.project_id
       FROM ticket_time_logs l
       LEFT JOIN tickets t ON t.id = l.ticket_id
       WHERE COALESCE(l.note, '') NOT LIKE 'Task Sheet:%'
       ORDER BY l.id ASC`
    )
    .all();

  for (const ml of manualLogs) {
    const empId = ml.employee_id || empByUserId.get(ml.user_id) || null;
    if (!empId) continue;
    const mins = Math.min(
      Math.max(0, ml.duration_minutes != null ? Number(ml.duration_minutes) : Math.round(Number(ml.seconds || 0) / 60)),
      1440
    );
    workLogsToInsert.push({
      employee_id: empId,
      user_id: ml.user_id,
      work_date: ml.work_date || toIstDate(ml.created_at) || '2026-10-12',
      entry_type: 'ticket_work',
      entry_kind: 'initial',
      project_id: ml.project_id || null,
      ticket_id: ml.ticket_id,
      category_code: ml.work_category || 'development',
      duration_minutes: mins,
      work_description: ml.note || '',
      completed_work: '',
      pending_work: '',
      blocker_text: '',
      task_state: null,
      source_type: 'manual_ticket_log',
      source_id: ml.id,
      source_item_index: 0,
    });
  }

  console.log(
    '[backfill-360] Planned counts:',
    JSON.stringify({
      stageHistoryRows: stageRowsToInsert.length,
      sheetMetadataUpdates: sheetUpdates.length,
      legacyAnonymousPreservedUnmapped: legacyAnonymousCount,
      canonicalWorkLogsToInsert: workLogsToInsert.length,
    })
  );

  if (!commit) {
    console.log('[backfill-360] Dry-run complete. Zero data modified.');
    return;
  }

  await db.transaction(async (tx) => {
    const STAGE_CHUNK = 40;
    for (let i = 0; i < stageRowsToInsert.length; i += STAGE_CHUNK) {
      const chunk = stageRowsToInsert.slice(i, i + STAGE_CHUNK);
      const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
      const args = chunk.flatMap((r) => [
        r.ticket_id,
        r.project_id,
        r.transition_seq,
        r.from_status,
        r.to_status,
        r.changed_by,
        r.source,
        r.entry_at,
        r.exit_at,
        r.calendar_seconds,
        r.business_seconds,
        r.schedule_version_id,
        r.duration_precision,
        r.is_reopen,
        r.idempotency_key,
      ]);
      await tx
        .prepare(
          `INSERT OR IGNORE INTO ticket_stage_history
            (ticket_id, project_id, transition_seq, from_status, to_status, changed_by, source,
             entry_at, exit_at, calendar_seconds, business_seconds, schedule_version_id,
             duration_precision, is_reopen, idempotency_key)
           VALUES ${placeholders}`
        )
        .run(args);
    }

    for (const u of sheetUpdates) {
      await tx
        .prepare(
          `UPDATE task_sheet_submissions
           SET work_date = COALESCE(work_date, ?),
               employee_id = COALESCE(employee_id, ?),
               submission_auth_mode = ?
           WHERE id = ?`
        )
        .run(u.work_date, u.employee_id, u.submission_auth_mode, u.id);
    }

    const LOG_CHUNK = 40;
    for (let i = 0; i < workLogsToInsert.length; i += LOG_CHUNK) {
      const chunk = workLogsToInsert.slice(i, i + LOG_CHUNK);
      const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
      const args = chunk.flatMap((w) => [
        w.employee_id,
        w.user_id,
        w.work_date,
        w.entry_type,
        w.entry_kind,
        w.project_id,
        w.ticket_id,
        w.category_code,
        w.duration_minutes,
        w.work_description,
        w.completed_work,
        w.pending_work,
        w.blocker_text,
        w.task_state,
        w.source_type,
        w.source_id,
        w.source_item_index,
      ]);
      await tx
        .prepare(
          `INSERT OR IGNORE INTO employee_work_logs
            (employee_id, user_id, work_date, entry_type, entry_kind, project_id, ticket_id,
             category_code, duration_minutes, work_description, completed_work, pending_work,
             blocker_text, task_state, source_type, source_id, source_item_index)
           VALUES ${placeholders}`
        )
        .run(args);
    }
  });

  console.log('[backfill-360] Backfill committed cleanly without modifying tickets.updated_at or legacy anonymous rows.');
}

runBackfill().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});

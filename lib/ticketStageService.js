import { db } from './db.js';
import { calculateDurationsBetween, parseUtcDate } from './businessHours.js';
import { loadScheduleContext } from './businessScheduleService.js';
import { isAdminOrOwner } from './rbac.js';

export const VALID_TICKET_STATUSES = ['open', 'in_progress', 'resolved', 'closed'];

function nowUtcIso() {
  return new Date().toISOString();
}

async function lockTicketRow(tx, ticketId) {
  const sql = tx.dialect === 'postgres'
    ? 'SELECT * FROM tickets WHERE id = ? FOR UPDATE'
    : 'SELECT * FROM tickets WHERE id = ?';
  return tx.prepare(sql).get(Number(ticketId));
}

async function loadScheduleContextTx(tx, workspaceId = null) {
  const schedules = await tx
    .prepare(
      workspaceId != null
        ? 'SELECT * FROM business_schedule_history WHERE workspace_id = ? OR workspace_id IS NULL ORDER BY effective_from ASC, id ASC'
        : 'SELECT * FROM business_schedule_history WHERE workspace_id IS NULL ORDER BY effective_from ASC, id ASC'
    )
    .all(...(workspaceId != null ? [Number(workspaceId)] : []));

  const holidays = await tx
    .prepare(
      workspaceId != null
        ? 'SELECT * FROM company_holidays WHERE workspace_id = ? OR workspace_id IS NULL ORDER BY holiday_date ASC'
        : 'SELECT * FROM company_holidays ORDER BY holiday_date ASC'
    )
    .all(...(workspaceId != null ? [Number(workspaceId)] : []));

  return { schedules, holidays };
}

async function resolveProjectWorkspaceTx(tx, projectId) {
  if (!projectId) return null;
  const p = await tx.prepare('SELECT workspace_id FROM projects WHERE id = ?').get(Number(projectId));
  return p?.workspace_id ?? null;
}

/**
 * Atomically creates a ticket alongside its initial `open` stage row in `ticket_stage_history`.
 */
export async function createTicketWithStage({
  title,
  description,
  priority = 'medium',
  type = 'task',
  createdBy,
  projectId = null,
  employeeId = null,
  parentId = null,
  startDate = null,
  dueDate = null,
  labels = '',
  category = '',
  source = 'create',
  idempotencyKey = null,
}) {
  const entryAt = nowUtcIso();

  return db.transaction(async (tx) => {
    const info = await tx
      .prepare(
        `INSERT INTO tickets (title, description, status, priority, type, created_by, project_id, employee_id, parent_id, start_date, due_date, labels, category)
         VALUES (?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        String(title).trim(),
        String(description).trim(),
        priority,
        type,
        Number(createdBy),
        projectId ? Number(projectId) : null,
        employeeId ? Number(employeeId) : null,
        parentId ? Number(parentId) : null,
        startDate || null,
        dueDate || null,
        String(labels || '').trim(),
        String(category || '').trim()
      );

    const ticketId = Number(info.lastInsertRowid);
    const workspaceId = await resolveProjectWorkspaceTx(tx, projectId);
    const { schedules } = await loadScheduleContextTx(tx, workspaceId);
    const activeSched = schedules.length > 0 ? schedules[schedules.length - 1] : null;
    const precision = activeSched?.effective_date_status === 'owner_confirmed' ? 'verified' : 'provisional_baseline';

    await tx
      .prepare(
        `INSERT INTO ticket_stage_history (
          ticket_id, project_id, transition_seq, from_status, to_status,
          changed_by, source, entry_at, exit_at, schedule_version_id, duration_precision, is_reopen, idempotency_key
        ) VALUES (?, ?, 1, NULL, 'open', ?, ?, ?, NULL, ?, ?, 0, ?)`
      )
      .run(
        ticketId,
        projectId ? Number(projectId) : null,
        createdBy ? Number(createdBy) : null,
        source,
        entryAt,
        activeSched?.id ?? null,
        precision,
        idempotencyKey || null
      );

    return tx.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);
  });
}

/**
 * Atomically transitions a ticket between workflow stages inside a database transaction:
 * 1. Locks the ticket row (`FOR UPDATE` in Postgres / `BEGIN IMMEDIATE` in SQLite).
 * 2. Deduplicates replay calls via `idempotency_key`.
 * 3. Closes the currently active stage (`WHERE id = ? AND exit_at IS NULL`) strictly once.
 * 4. Opens the new stage visit and flags `is_reopen = 1` on backward transitions out of `resolved`/`closed`.
 */
export async function transitionTicketStatus({
  ticketId,
  toStatus,
  actor,
  source = 'board',
  idempotencyKey = null,
  extraUpdates = {},
  expectedCurrentStatus = null,
}) {
  const numId = Number(ticketId);
  const nowIso = nowUtcIso();

  return db.transaction(async (tx) => {
    const validStage = await tx
      .prepare('SELECT code, is_active FROM workflow_stages WHERE code = ?')
      .get(toStatus);
    if (!validStage || !validStage.is_active) {
      throw new Error(`Invalid or inactive workflow stage: "${toStatus}".`);
    }

    if (idempotencyKey) {
      const existingByKey = await tx
        .prepare('SELECT * FROM ticket_stage_history WHERE idempotency_key = ?')
        .get(idempotencyKey);
      if (existingByKey) {
        const currentTicket = await tx.prepare('SELECT * FROM tickets WHERE id = ?').get(numId);
        return { idempotent: true, ticket: currentTicket, stageRow: existingByKey };
      }
    }

    const ticket = await lockTicketRow(tx, numId);
    if (!ticket) {
      throw new Error('Ticket not found.');
    }

    if (expectedCurrentStatus && ticket.status !== expectedCurrentStatus) {
      const conflictErr = new Error(
        `Ticket status changed concurrently (expected "${expectedCurrentStatus}", found "${ticket.status}").`
      );
      conflictErr.statusCode = 409;
      throw conflictErr;
    }

    const workspaceId = await resolveProjectWorkspaceTx(tx, ticket.project_id);
    const schedContext = await loadScheduleContextTx(tx, workspaceId);

    const extraKeys = Object.keys(extraUpdates).filter((k) => k !== 'status');
    const isStatusChanging = ticket.status !== toStatus;

    let openStage = await tx
      .prepare('SELECT * FROM ticket_stage_history WHERE ticket_id = ? AND exit_at IS NULL')
      .get(numId);

    const seqRow = await tx
      .prepare('SELECT COALESCE(MAX(transition_seq), 0) AS max_seq FROM ticket_stage_history WHERE ticket_id = ?')
      .get(numId);
    let nextSeq = Number(seqRow?.max_seq || 0) + 1;

    if (isStatusChanging) {
      // Backfill safety guard if a legacy/seeded ticket had no open stage row yet
      if (!openStage) {
        const fallbackEntry = ticket.created_at || nowIso;
        const durations = calculateDurationsBetween(fallbackEntry, nowIso, schedContext);
        await tx
          .prepare(
            `INSERT INTO ticket_stage_history (
              ticket_id, project_id, transition_seq, from_status, to_status,
              changed_by, source, entry_at, exit_at, calendar_seconds, business_seconds,
              schedule_version_id, duration_precision, is_reopen
            ) VALUES (?, ?, ?, NULL, ?, ?, 'backfill', ?, ?, ?, ?, ?, ?, 0)`
          )
          .run(
            numId,
            ticket.project_id || null,
            nextSeq,
            ticket.status,
            ticket.created_by || null,
            fallbackEntry,
            nowIso,
            durations.calendarSeconds,
            durations.businessSeconds,
            durations.scheduleVersionId,
            durations.precision
          );
        nextSeq += 1;
      } else {
        const durations = calculateDurationsBetween(openStage.entry_at, nowIso, schedContext);
        const closeRes = await tx
          .prepare(
            `UPDATE ticket_stage_history
             SET exit_at = ?, calendar_seconds = ?, business_seconds = ?,
                 schedule_version_id = ?, duration_precision = ?
             WHERE id = ? AND exit_at IS NULL`
          )
          .run(
            nowIso,
            durations.calendarSeconds,
            durations.businessSeconds,
            durations.scheduleVersionId,
            durations.precision,
            openStage.id
          );
        if (closeRes.rowCount !== 1) {
          const raceErr = new Error('Stage transition conflict: active stage was already closed.');
          raceErr.statusCode = 409;
          throw raceErr;
        }
      }

      const isReopen =
        ['resolved', 'closed'].includes(ticket.status) &&
        ['open', 'in_progress'].includes(toStatus)
          ? 1
          : 0;
      const latestSched = schedContext.schedules.length > 0
        ? schedContext.schedules[schedContext.schedules.length - 1]
        : null;
      const activePrecision =
        latestSched?.effective_date_status === 'owner_confirmed' ? 'verified' : 'provisional_baseline';

      await tx
        .prepare(
          `INSERT INTO ticket_stage_history (
            ticket_id, project_id, transition_seq, from_status, to_status,
            changed_by, source, entry_at, exit_at, schedule_version_id, duration_precision, is_reopen, idempotency_key
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`
        )
        .run(
          numId,
          ticket.project_id || null,
          nextSeq,
          ticket.status,
          toStatus,
          actor?.id || null,
          source,
          nowIso,
          latestSched?.id ?? null,
          activePrecision,
          isReopen,
          idempotencyKey || null
        );
    }

    const updateFields = [];
    const updateValues = [];
    if (isStatusChanging) {
      updateFields.push('status = ?');
      updateValues.push(toStatus);
    }
    for (const k of extraKeys) {
      updateFields.push(`${k} = ?`);
      updateValues.push(extraUpdates[k]);
    }
    if (updateFields.length > 0) {
      updateFields.push("updated_at = datetime('now')");
      updateValues.push(numId);
      await tx
        .prepare(`UPDATE tickets SET ${updateFields.join(', ')} WHERE id = ?`)
        .run(updateValues);
    }

    const updatedTicket = await tx.prepare('SELECT * FROM tickets WHERE id = ?').get(numId);
    const currentStage = await tx
      .prepare('SELECT * FROM ticket_stage_history WHERE ticket_id = ? AND exit_at IS NULL')
      .get(numId);

    return {
      idempotent: false,
      transitioned: isStatusChanging,
      fromStatus: ticket.status,
      toStatus,
      ticket: updatedTicket,
      stageRow: currentStage,
    };
  });
}

/**
 * Handles stage lifecycle on soft archival or unarchival.
 * Closing an active stage once on archival ensures archived tickets stop ticking;
 * restoring from archive opens a fresh visit if none is open.
 */
export async function syncStageOnArchiveState({ ticketId, archived, actor }) {
  const numId = Number(ticketId);
  const nowIso = nowUtcIso();

  return db.transaction(async (tx) => {
    const ticket = await lockTicketRow(tx, numId);
    if (!ticket) return null;

    const workspaceId = await resolveProjectWorkspaceTx(tx, ticket.project_id);
    const schedContext = await loadScheduleContextTx(tx, workspaceId);

    const openStage = await tx
      .prepare('SELECT * FROM ticket_stage_history WHERE ticket_id = ? AND exit_at IS NULL')
      .get(numId);

    if (Number(archived) === 1 && openStage) {
      const durations = calculateDurationsBetween(openStage.entry_at, nowIso, schedContext);
      await tx
        .prepare(
          `UPDATE ticket_stage_history
           SET exit_at = ?, calendar_seconds = ?, business_seconds = ?,
               schedule_version_id = ?, duration_precision = ?
           WHERE id = ? AND exit_at IS NULL`
        )
        .run(
          nowIso,
          durations.calendarSeconds,
          durations.businessSeconds,
          durations.scheduleVersionId,
          durations.precision,
          openStage.id
        );
      return { closedStageId: openStage.id };
    }

    if (Number(archived) === 0 && !openStage) {
      const seqRow = await tx
        .prepare('SELECT COALESCE(MAX(transition_seq), 0) AS max_seq FROM ticket_stage_history WHERE ticket_id = ?')
        .get(numId);
      const nextSeq = Number(seqRow?.max_seq || 0) + 1;
      const latestSched = schedContext.schedules.length > 0
        ? schedContext.schedules[schedContext.schedules.length - 1]
        : null;
      const precision =
        latestSched?.effective_date_status === 'owner_confirmed' ? 'verified' : 'provisional_baseline';

      await tx
        .prepare(
          `INSERT INTO ticket_stage_history (
            ticket_id, project_id, transition_seq, from_status, to_status,
            changed_by, source, entry_at, exit_at, schedule_version_id, duration_precision, is_reopen
          ) VALUES (?, ?, ?, NULL, ?, ?, 'archive', ?, NULL, ?, ?, 0)`
        )
        .run(
          numId,
          ticket.project_id || null,
          nextSeq,
          ticket.status,
          actor?.id || null,
          nowIso,
          latestSched?.id ?? null,
          precision
        );
      return { reopened: true };
    }

    return { unchanged: true };
  });
}

/**
 * Records an immutable correction in `ticket_stage_corrections` without ever
 * mutating the historical original row in `ticket_stage_history`.
 */
export async function applyStageCorrection({
  ticketId,
  stageHistoryId,
  correctedEntryAt = null,
  correctedExitAt = null,
  correctedToStatus = null,
  reason,
  actor,
}) {
  if (!isAdminOrOwner(actor)) {
    throw new Error('Forbidden: Only Business Owners or Administrators can submit stage corrections.');
  }

  const cleanReason = String(reason || '').trim();
  if (cleanReason.length < 5) {
    throw new Error('A mandatory correction reason of at least 5 characters is required.');
  }

  const numTicketId = Number(ticketId);
  const numStageId = Number(stageHistoryId);
  if (!Number.isInteger(numTicketId) || !Number.isInteger(numStageId)) {
    throw new Error('Valid ticketId and stageHistoryId are required.');
  }

  return db.transaction(async (tx) => {
    const original = await tx
      .prepare('SELECT * FROM ticket_stage_history WHERE id = ? AND ticket_id = ?')
      .get(numStageId, numTicketId);
    if (!original) {
      throw new Error('Stage history record not found for this ticket.');
    }

    const nextEntryStr = correctedEntryAt ? String(correctedEntryAt).trim() : original.entry_at;
    const nextExitStr = correctedExitAt !== undefined && correctedExitAt !== null && String(correctedExitAt).trim() !== ''
      ? String(correctedExitAt).trim()
      : original.exit_at;
    const nextStatus = correctedToStatus ? String(correctedToStatus).trim() : original.to_status;

    const validStage = await tx.prepare('SELECT code FROM workflow_stages WHERE code = ?').get(nextStatus);
    if (!validStage) {
      throw new Error(`Invalid corrected stage status "${nextStatus}".`);
    }

    const parsedEntry = parseUtcDate(nextEntryStr);
    if (!parsedEntry) {
      throw new Error('Invalid corrected_entry_at timestamp.');
    }

    let parsedExit = null;
    if (nextExitStr) {
      parsedExit = parseUtcDate(nextExitStr);
      if (!parsedExit) {
        throw new Error('Invalid corrected_exit_at timestamp.');
      }
      if (parsedExit.getTime() <= parsedEntry.getTime()) {
        throw new Error('corrected_exit_at must be strictly after corrected_entry_at.');
      }
    }

    const workspaceId = await resolveProjectWorkspaceTx(tx, original.project_id);
    const schedContext = await loadScheduleContextTx(tx, workspaceId);

    const calc = parsedExit
      ? calculateDurationsBetween(parsedEntry, parsedExit, schedContext)
      : { calendarSeconds: null, businessSeconds: null, scheduleVersionId: null, precision: 'verified' };

    const seqRow = await tx
      .prepare('SELECT COALESCE(MAX(correction_seq), 0) AS max_seq FROM ticket_stage_corrections WHERE stage_history_id = ?')
      .get(original.id);
    const nextCorrectionSeq = Number(seqRow?.max_seq || 0) + 1;

    const inserted = await tx
      .prepare(
        `INSERT INTO ticket_stage_corrections (
          stage_history_id, ticket_id, correction_seq,
          original_from_status, original_to_status, original_entry_at, original_exit_at,
          original_calendar_seconds, original_business_seconds,
          corrected_to_status, corrected_entry_at, corrected_exit_at,
          recalculated_calendar_seconds, recalculated_business_seconds,
          schedule_version_id, duration_precision, reason, corrected_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        original.id,
        numTicketId,
        nextCorrectionSeq,
        original.from_status,
        original.to_status,
        original.entry_at,
        original.exit_at,
        original.calendar_seconds,
        original.business_seconds,
        nextStatus,
        parsedEntry.toISOString(),
        parsedExit ? parsedExit.toISOString() : null,
        calc.calendarSeconds,
        calc.businessSeconds,
        calc.scheduleVersionId ?? original.schedule_version_id ?? null,
        calc.precision || 'verified',
        cleanReason,
        actor?.id || null
      );

    await tx
      .prepare(
        `INSERT INTO audit_logs (actor_id, actor_name, action, entity_type, entity_id, details)
         VALUES (?, ?, 'ticket_stage_corrected', 'ticket', ?, ?)`
      )
      .run(
        actor?.id || null,
        actor?.name || actor?.email || 'Admin',
        String(numTicketId),
        JSON.stringify({
          stageHistoryId: original.id,
          correctionId: inserted.lastInsertRowid,
          reason: cleanReason,
          correctedEntryAt: parsedEntry.toISOString(),
          correctedExitAt: parsedExit ? parsedExit.toISOString() : null,
          correctedToStatus: nextStatus,
        })
      );

    return tx.prepare('SELECT * FROM ticket_stage_corrections WHERE id = ?').get(inserted.lastInsertRowid);
  });
}

/**
 * Computes effective timeline audit for a ticket by overlaying append-only
 * `ticket_stage_corrections` on top of immutable `ticket_stage_history` rows,
 * computing live durations for any open visit, and reading canonical effort from `employee_work_logs`.
 */
export async function getTicketTimeAudit(ticketId, { nowIso = null } = {}) {
  const numId = Number(ticketId);
  const ticket = await db
    .prepare(
      `SELECT t.*, p.key AS project_key, p.name AS project_name, p.workspace_id
       FROM tickets t
       LEFT JOIN projects p ON p.id = t.project_id
       WHERE t.id = ?`
    )
    .get(numId);

  if (!ticket) return null;

  const evalNow = nowIso || nowUtcIso();
  const schedContext = await loadScheduleContext(ticket.workspace_id ?? null);

  const historyRows = await db
    .prepare(
      `SELECT tsh.*, u.name AS changed_by_name, ws.label AS to_stage_label
       FROM ticket_stage_history tsh
       LEFT JOIN users u ON u.id = tsh.changed_by
       LEFT JOIN workflow_stages ws ON ws.code = tsh.to_status
       WHERE tsh.ticket_id = ?
       ORDER BY tsh.transition_seq ASC, tsh.id ASC`
    )
    .all(numId);

  const corrections = await db
    .prepare(
      `SELECT tsc.*, u.name AS corrected_by_name
       FROM ticket_stage_corrections tsc
       LEFT JOIN users u ON u.id = tsc.corrected_by
       WHERE tsc.ticket_id = ?
       ORDER BY tsc.corrected_at ASC, tsc.id ASC`
    )
    .all(numId);

  const latestCorrectionByStage = new Map();
  for (const c of corrections) {
    latestCorrectionByStage.set(Number(c.stage_history_id), c);
  }

  const stageTotals = {
    open: { calendarSeconds: 0, businessSeconds: 0, visits: 0 },
    in_progress: { calendarSeconds: 0, businessSeconds: 0, visits: 0 },
    resolved: { calendarSeconds: 0, businessSeconds: 0, visits: 0 },
    closed: { calendarSeconds: 0, businessSeconds: 0, visits: 0 },
  };

  let reopenCount = 0;
  let totalCalendarSeconds = 0;
  let totalBusinessSeconds = 0;
  const precisionsSeen = new Set();

  const effectiveTimeline = historyRows.map((row) => {
    const correction = latestCorrectionByStage.get(Number(row.id)) || null;
    const effectiveEntry = correction?.corrected_entry_at || row.entry_at;
    const effectiveExit = correction ? correction.corrected_exit_at : row.exit_at;
    const effectiveStatus = correction?.corrected_to_status || row.to_status;

    const endRef = effectiveExit || evalNow;
    const calc = calculateDurationsBetween(effectiveEntry, endRef, schedContext);

    const calSec = effectiveExit && correction?.recalculated_calendar_seconds != null
      ? Number(correction.recalculated_calendar_seconds)
      : (!correction && row.exit_at && row.calendar_seconds != null
          ? Number(row.calendar_seconds)
          : calc.calendarSeconds);

    const bizSec = effectiveExit && correction?.recalculated_business_seconds != null
      ? Number(correction.recalculated_business_seconds)
      : (!correction && row.exit_at && row.business_seconds != null
          ? Number(row.business_seconds)
          : calc.businessSeconds);

    const precision = calc.precision || row.duration_precision || 'provisional_baseline';
    precisionsSeen.add(precision);

    if (Number(row.is_reopen) === 1) reopenCount += 1;
    if (!stageTotals[effectiveStatus]) {
      stageTotals[effectiveStatus] = { calendarSeconds: 0, businessSeconds: 0, visits: 0 };
    }
    stageTotals[effectiveStatus].calendarSeconds += calSec;
    stageTotals[effectiveStatus].businessSeconds += bizSec;
    stageTotals[effectiveStatus].visits += 1;

    totalCalendarSeconds += calSec;
    totalBusinessSeconds += bizSec;

    return {
      ...row,
      is_ongoing: !effectiveExit && Number(ticket.archived || 0) === 0,
      has_correction: Boolean(correction),
      correction,
      effective_to_status: effectiveStatus,
      effective_entry_at: effectiveEntry,
      effective_exit_at: effectiveExit,
      effective_calendar_seconds: calSec,
      effective_business_seconds: bizSec,
      effective_precision: precision,
    };
  });

  // Canonical logged employee work hours exclusively from employee_work_logs
  const workAgg = await db
    .prepare(
      `SELECT COALESCE(SUM(duration_minutes), 0) AS total_minutes,
              COUNT(*) AS entry_count
       FROM employee_work_logs
       WHERE ticket_id = ?`
    )
    .get(numId);

  let overallPrecision = 'provisional_baseline';
  if (precisionsSeen.size > 1) {
    overallPrecision = 'mixed_estimated';
  } else if (precisionsSeen.size === 1) {
    overallPrecision = [...precisionsSeen][0];
  }

  return {
    ticket: {
      id: ticket.id,
      title: ticket.title,
      status: ticket.status,
      project_id: ticket.project_id,
      project_key: ticket.project_key,
      project_name: ticket.project_name,
      created_at: ticket.created_at,
      archived: Boolean(ticket.archived),
    },
    timeline: effectiveTimeline,
    corrections,
    stageTotals,
    totals: {
      calendarSeconds: totalCalendarSeconds,
      businessSeconds: totalBusinessSeconds,
      loggedWorkMinutes: Number(workAgg?.total_minutes || 0),
      workLogEntries: Number(workAgg?.entry_count || 0),
      reopenCount,
      precision: overallPrecision,
    },
  };
}

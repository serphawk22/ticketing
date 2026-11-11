import { db } from './db.js';
import { calculateDurationsBetween, parseTimeToSeconds } from './businessHours.js';

function isIsoDateOnly(val) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(val || '').trim());
}

function dayBefore(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

export async function loadScheduleContext(workspaceId = null) {
  const schedules = await db
    .prepare(
      workspaceId != null
        ? 'SELECT * FROM business_schedule_history WHERE workspace_id = ? OR workspace_id IS NULL ORDER BY effective_from ASC, id ASC'
        : 'SELECT * FROM business_schedule_history WHERE workspace_id IS NULL ORDER BY effective_from ASC, id ASC'
    )
    .all(...(workspaceId != null ? [Number(workspaceId)] : []));

  const holidays = await db
    .prepare(
      workspaceId != null
        ? 'SELECT * FROM company_holidays WHERE workspace_id = ? OR workspace_id IS NULL ORDER BY holiday_date ASC'
        : 'SELECT * FROM company_holidays ORDER BY holiday_date ASC'
    )
    .all(...(workspaceId != null ? [Number(workspaceId)] : []));

  return { schedules, holidays };
}

export async function calculateDurationsWithDb(startUtc, endUtc, { workspaceId = null } = {}) {
  const context = await loadScheduleContext(workspaceId);
  return calculateDurationsBetween(startUtc, endUtc, context);
}

/**
 * Creates a new forward-dated schedule version without destroying historical versions.
 * Closes the immediately preceding open-ended schedule on `dayBefore(effective_from)`.
 */
export async function createScheduleVersion({
  actor,
  workspaceId = null,
  effectiveFrom,
  workStartTime = '09:00',
  workEndTime = '17:00',
  workingDays = [1, 2, 3, 4, 5, 6],
  effectiveDateStatus = 'owner_confirmed',
  reason,
}) {
  const cleanFrom = String(effectiveFrom || '').trim();
  const cleanReason = String(reason || '').trim();
  if (!isIsoDateOnly(cleanFrom)) {
    throw new Error('effective_from must be in YYYY-MM-DD format.');
  }
  if (cleanReason.length < 5) {
    throw new Error('A mandatory reason of at least 5 characters is required.');
  }

  const startSec = parseTimeToSeconds(workStartTime, -1);
  const endSec = parseTimeToSeconds(workEndTime, -1);
  if (startSec < 0 || endSec <= startSec) {
    throw new Error('work_end_time must be strictly after work_start_time (HH:MM).');
  }

  const cleanDays = Array.isArray(workingDays)
    ? workingDays.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    : [];
  if (cleanDays.length === 0) {
    throw new Error('At least one working day (0-6) must be selected.');
  }

  const statusVal = effectiveDateStatus === 'owner_confirmed' ? 'owner_confirmed' : 'provisional_inferred_from_settings';
  const wsId = workspaceId != null ? Number(workspaceId) : null;

  return db.transaction(async (tx) => {
    const existingLatest = await tx
      .prepare(
        wsId != null
          ? 'SELECT * FROM business_schedule_history WHERE workspace_id = ? AND effective_to IS NULL ORDER BY effective_from DESC, id DESC LIMIT 1'
          : 'SELECT * FROM business_schedule_history WHERE workspace_id IS NULL AND effective_to IS NULL ORDER BY effective_from DESC, id DESC LIMIT 1'
      )
      .get(...(wsId != null ? [wsId] : []));

    if (existingLatest) {
      if (cleanFrom <= String(existingLatest.effective_from).slice(0, 10)) {
        throw new Error(
          `New schedule effective_from (${cleanFrom}) must be strictly after the latest schedule effective_from (${existingLatest.effective_from}). Use verify-baseline to amend the initial baseline.`
        );
      }
      await tx
        .prepare('UPDATE business_schedule_history SET effective_to = ? WHERE id = ?')
        .run(dayBefore(cleanFrom), existingLatest.id);
    }

    const res = await tx
      .prepare(
        `INSERT INTO business_schedule_history (
          workspace_id, effective_from, effective_to, work_start_time, work_end_time,
          working_days_json, timezone, effective_date_status, confirmed_by, confirmed_at, reason
        ) VALUES (?, ?, NULL, ?, ?, ?, 'Asia/Kolkata', ?, ?, datetime('now'), ?)`
      )
      .run(
        wsId,
        cleanFrom,
        workStartTime.trim(),
        workEndTime.trim(),
        JSON.stringify([...new Set(cleanDays)].sort((a, b) => a - b)),
        statusVal,
        actor?.id || null,
        cleanReason
      );

    await tx
      .prepare(
        `INSERT INTO audit_logs (actor_id, actor_name, action, entity_type, entity_id, details)
         VALUES (?, ?, 'business_schedule_version_created', 'business_schedule_history', ?, ?)`
      )
      .run(
        actor?.id || null,
        actor?.name || actor?.email || 'Admin',
        String(res.lastInsertRowid),
        JSON.stringify({ effectiveFrom: cleanFrom, workStartTime, workEndTime, workingDays: cleanDays, reason: cleanReason })
      );

    return tx.prepare('SELECT * FROM business_schedule_history WHERE id = ?').get(res.lastInsertRowid);
  });
}

/**
 * Explicit Owner/Admin baseline verification (`owner_confirmed`).
 * Promotes the earliest provisional schedule version to verified baseline or amends its effective date.
 */
export async function verifyBaselineSchedule({
  actor,
  workspaceId = null,
  effectiveFrom,
  workStartTime = null,
  workEndTime = null,
  workingDays = null,
  reason,
}) {
  const cleanFrom = String(effectiveFrom || '').trim();
  const cleanReason = String(reason || '').trim();
  if (!isIsoDateOnly(cleanFrom)) {
    throw new Error('effective_from must be in YYYY-MM-DD format.');
  }
  if (cleanReason.length < 5) {
    throw new Error('A mandatory reason of at least 5 characters is required to verify the baseline schedule.');
  }

  const wsId = workspaceId != null ? Number(workspaceId) : null;

  return db.transaction(async (tx) => {
    const earliest = await tx
      .prepare(
        wsId != null
          ? 'SELECT * FROM business_schedule_history WHERE workspace_id = ? ORDER BY effective_from ASC, id ASC LIMIT 1'
          : 'SELECT * FROM business_schedule_history WHERE workspace_id IS NULL ORDER BY effective_from ASC, id ASC LIMIT 1'
      )
      .get(...(wsId != null ? [wsId] : []));

    if (earliest && earliest.effective_to && cleanFrom > String(earliest.effective_to).slice(0, 10)) {
      throw new Error(`Baseline effective_from (${cleanFrom}) cannot exceed its closing date (${earliest.effective_to}).`);
    }

    if (workStartTime || workEndTime) {
      const startSec = parseTimeToSeconds(workStartTime || earliest?.work_start_time || '09:00', -1);
      const endSec = parseTimeToSeconds(workEndTime || earliest?.work_end_time || '17:00', -1);
      if (startSec < 0 || endSec <= startSec) {
        throw new Error('work_end_time must be strictly after work_start_time (HH:MM).');
      }
    }

    if (earliest) {
      const nextDays = Array.isArray(workingDays) && workingDays.length > 0
        ? JSON.stringify([...new Set(workingDays.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b))
        : earliest.working_days_json;

      await tx
        .prepare(
          `UPDATE business_schedule_history
           SET effective_from = ?,
               work_start_time = ?,
               work_end_time = ?,
               working_days_json = ?,
               effective_date_status = 'owner_confirmed',
               confirmed_by = ?,
               confirmed_at = datetime('now'),
               reason = ?
           WHERE id = ?`
        )
        .run(
          cleanFrom,
          (workStartTime || earliest.work_start_time).trim(),
          (workEndTime || earliest.work_end_time).trim(),
          nextDays,
          actor?.id || null,
          cleanReason,
          earliest.id
        );

      await tx
        .prepare(
          `INSERT INTO audit_logs (actor_id, actor_name, action, entity_type, entity_id, details)
           VALUES (?, ?, 'business_schedule_baseline_verified', 'business_schedule_history', ?, ?)`
        )
        .run(
          actor?.id || null,
          actor?.name || actor?.email || 'Owner',
          String(earliest.id),
          JSON.stringify({ previousFrom: earliest.effective_from, verifiedFrom: cleanFrom, reason: cleanReason })
        );

      return tx.prepare('SELECT * FROM business_schedule_history WHERE id = ?').get(earliest.id);
    }

    const nextDays = Array.isArray(workingDays) && workingDays.length > 0
      ? JSON.stringify([...new Set(workingDays.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b))
      : '[1,2,3,4,5,6]';
    const inserted = await tx
      .prepare(
        `INSERT INTO business_schedule_history (
          workspace_id, effective_from, effective_to, work_start_time, work_end_time,
          working_days_json, timezone, effective_date_status, confirmed_by, confirmed_at, reason
        ) VALUES (?, ?, NULL, ?, ?, ?, 'Asia/Kolkata', 'owner_confirmed', ?, datetime('now'), ?)`
      )
      .run(
        wsId,
        cleanFrom,
        (workStartTime || '09:00').trim(),
        (workEndTime || '17:00').trim(),
        nextDays,
        actor?.id || null,
        cleanReason
      );

    await tx
      .prepare(
        `INSERT INTO audit_logs (actor_id, actor_name, action, entity_type, entity_id, details)
         VALUES (?, ?, 'business_schedule_baseline_verified', 'business_schedule_history', ?, ?)`
      )
      .run(
        actor?.id || null,
        actor?.name || actor?.email || 'Owner',
        String(inserted.lastInsertRowid),
        JSON.stringify({ verifiedFrom: cleanFrom, reason: cleanReason })
      );

    return tx.prepare('SELECT * FROM business_schedule_history WHERE id = ?').get(inserted.lastInsertRowid);
  });
}

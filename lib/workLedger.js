import { db } from './db.js';
import { isAdminOrOwner, normalizeRole } from './rbac.js';
import { toKolkata } from './businessHours.js';

const AMENDMENT_WINDOW_MS = 48 * 3600 * 1000;

export function todayKolkataDate() {
  return toKolkata(new Date()).toISOString().slice(0, 10);
}

export async function getWorkCategories({ activeOnly = true } = {}) {
  return db
    .prepare(
      `SELECT code, label, scope, counts_as_accounted, is_active, sort_order
       FROM work_categories
       ${activeOnly ? 'WHERE is_active = 1' : ''}
       ORDER BY sort_order ASC, label ASC`
    )
    .all();
}

async function resolveValidCategory(tx, code, fallback = 'development') {
  const clean = String(code || '').trim().toLowerCase();
  if (clean) {
    const row = await tx
      .prepare('SELECT code FROM work_categories WHERE code = ? AND is_active = 1')
      .get(clean);
    if (row) return row.code;
  }
  const fb = await tx
    .prepare('SELECT code FROM work_categories WHERE code = ? AND is_active = 1')
    .get(fallback);
  return fb ? fb.code : 'development';
}

/**
 * Normalizes a Task Sheet submission payload into canonical `employee_work_logs` line items:
 * - Ticket work items (ticket_id NOT NULL, entry_type = 'ticket_work')
 * - Company / Non-ticket activities (ticket_id NULL, project_id NULL, entry_type = 'company_activity')
 */
export async function buildCanonicalLedgerItems(tx, payload) {
  const items = [];
  const selectedTickets = Array.isArray(payload.selectedTickets) ? payload.selectedTickets : [];
  const otherActivitiesEntries = Array.isArray(payload.otherActivitiesEntries)
    ? payload.otherActivitiesEntries
    : [];

  const totalHoursMinutes = Math.round(Number(payload.hoursWorked || 0) * 60);

  if (selectedTickets.length > 0) {
    // Determine explicit vs equal-split minutes per ticket
    let explicitSum = 0;
    let missingCount = 0;
    for (const t of selectedTickets) {
      const m = t.minutes != null ? Number(t.minutes) : (t.hours != null ? Math.round(Number(t.hours) * 60) : null);
      if (m != null && Number.isFinite(m) && m > 0) {
        explicitSum += Math.round(m);
      } else {
        missingCount += 1;
      }
    }

    const otherMinutesSum = otherActivitiesEntries.reduce(
      (acc, act) => acc + Math.max(0, Math.round(Number(act.minutes || (act.hours ? act.hours * 60 : 0)))),
      0
    );

    const remainingForMissing = Math.max(0, totalHoursMinutes - explicitSum - otherMinutesSum);
    const defaultPerMissing = missingCount > 0 ? Math.max(1, Math.round(remainingForMissing / missingCount)) : 0;

    for (let i = 0; i < selectedTickets.length; i += 1) {
      const t = selectedTickets[i];
      const tid = Number(t.id);
      if (!Number.isInteger(tid) || tid <= 0) continue;

      const tRow = await tx.prepare('SELECT id, project_id FROM tickets WHERE id = ?').get(tid);
      if (!tRow) continue;

      const rawMin = t.minutes != null ? Number(t.minutes) : (t.hours != null ? Math.round(Number(t.hours) * 60) : null);
      const mins = rawMin != null && Number.isFinite(rawMin) && rawMin > 0
        ? Math.min(1440, Math.round(rawMin))
        : Math.min(1440, defaultPerMissing || Math.max(1, Math.round(totalHoursMinutes / selectedTickets.length)));

      const catCode = await resolveValidCategory(tx, t.categoryCode || t.category_code || payload.categoryCode, 'development');
      const taskState = t.workState === 'not_completed' ? 'not_completed' : 'completed';

      items.push({
        entry_type: 'ticket_work',
        project_id: tRow.project_id || null,
        ticket_id: tRow.id,
        category_code: catCode,
        duration_minutes: mins,
        work_description: String(t.workDescription || t.title || payload.taskDescription || payload.taskTitle || '').trim(),
        completed_work: String(t.completedWork || (taskState === 'completed' ? (t.title || payload.taskDescription || '') : '')).trim(),
        pending_work: String(t.pendingWork || (taskState === 'not_completed' ? (t.title || '') : '')).trim(),
        blocker_text: String(t.blocker || '').trim(),
        task_state: taskState,
      });
    }
  } else if (totalHoursMinutes > 0 && payload.linkedTicketId) {
    const tRow = await tx.prepare('SELECT id, project_id FROM tickets WHERE id = ?').get(Number(payload.linkedTicketId));
    if (tRow) {
      const catCode = await resolveValidCategory(tx, payload.categoryCode, 'development');
      items.push({
        entry_type: 'ticket_work',
        project_id: tRow.project_id || null,
        ticket_id: tRow.id,
        category_code: catCode,
        duration_minutes: Math.min(1440, totalHoursMinutes),
        work_description: String(payload.taskDescription || payload.taskTitle || '').trim(),
        completed_work: payload.taskState === 'completed' ? String(payload.taskDescription || payload.taskTitle || '').trim() : '',
        pending_work: payload.taskState === 'not_completed' ? String(payload.taskTitle || '').trim() : '',
        blocker_text: String(payload.blocker || '').trim(),
        task_state: payload.taskState === 'not_completed' ? 'not_completed' : 'completed',
      });
    }
  } else if (totalHoursMinutes > 0 && otherActivitiesEntries.length === 0) {
    // Unlinked ticket/project work row so total hours still land cleanly in employee_work_logs
    const catCode = await resolveValidCategory(tx, payload.categoryCode, 'development');
    let fallbackProjectId = payload.fallbackProjectId ? Number(payload.fallbackProjectId) : null;
    if (!fallbackProjectId && payload.project) {
      const pRow = await tx.prepare('SELECT id FROM projects WHERE name = ?').get(String(payload.project).trim());
      fallbackProjectId = pRow?.id || null;
    }
    items.push({
      entry_type: 'ticket_work',
      project_id: fallbackProjectId,
      ticket_id: null,
      category_code: catCode,
      duration_minutes: Math.min(1440, totalHoursMinutes),
      work_description: `${String(payload.taskTitle || '').trim()}${payload.taskDescription ? ` — ${String(payload.taskDescription).trim()}` : ''}`.trim(),
      completed_work: payload.taskState === 'completed' ? String(payload.taskDescription || '').trim() : '',
      pending_work: payload.taskState === 'not_completed' ? String(payload.taskTitle || '').trim() : '',
      blocker_text: String(payload.blocker || '').trim(),
      task_state: payload.taskState === 'not_completed' ? 'not_completed' : 'completed',
    });
  }

  for (const act of otherActivitiesEntries) {
    const mins = Math.round(Number(act.minutes ?? (act.hours != null ? Number(act.hours) * 60 : 0)));
    if (!Number.isFinite(mins) || mins <= 0) continue;
    const catCode = await resolveValidCategory(tx, act.categoryCode || act.category_code, 'other_company_work');
    items.push({
      entry_type: 'company_activity',
      project_id: null,
      ticket_id: null,
      category_code: catCode,
      duration_minutes: Math.min(1440, mins),
      work_description: String(act.description || act.work_description || payload.otherActivities || 'Company activity').trim(),
      completed_work: String(act.description || payload.otherActivities || '').trim(),
      pending_work: '',
      blocker_text: '',
      task_state: 'completed',
    });
  }

  const totalInserted = items.reduce((s, item) => s + item.duration_minutes, 0);
  if (totalInserted > 1440) {
    throw new Error('Total daily logged work across all activities cannot exceed 24 hours (1440 minutes).');
  }

  return items;
}

export async function recordTaskSheetWorkLogsTx(tx, {
  submissionId,
  employeeId,
  userId = null,
  workDate,
  payload,
}) {
  const empId = Number(employeeId);
  if (!Number.isInteger(empId) || empId <= 0) {
    throw new Error('Cannot write canonical work log without verified employee_id.');
  }
  const cleanDate = /^\d{4}-\d{2}-\d{2}$/.test(String(workDate || '').trim())
    ? String(workDate).trim()
    : todayKolkataDate();

  const items = await buildCanonicalLedgerItems(tx, payload);
  const insertedIds = [];

  for (let idx = 0; idx < items.length; idx += 1) {
    const it = items[idx];
    const res = await tx
      .prepare(
        `INSERT INTO employee_work_logs (
          employee_id, user_id, work_date, entry_type, entry_kind,
          project_id, ticket_id, category_code, duration_minutes,
          work_description, completed_work, pending_work, blocker_text, task_state,
          source_type, source_id, source_item_index
        ) VALUES (?, ?, ?, ?, 'initial', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'task_sheet', ?, ?)`
      )
      .run(
        empId,
        userId ? Number(userId) : null,
        cleanDate,
        it.entry_type,
        it.project_id,
        it.ticket_id,
        it.category_code,
        it.duration_minutes,
        it.work_description,
        it.completed_work,
        it.pending_work,
        it.blocker_text,
        it.task_state,
        Number(submissionId),
        idx
      );
    insertedIds.push(Number(res.lastInsertRowid));
  }

  return { count: insertedIds.length, items };
}

/**
 * Idempotent amendment of a Task Sheet submission:
 * - Preserves original `task_sheet_submissions` row untouched.
 * - Authorizes Admin/Owner anytime (`admin_adjustment`) or submitting employee within 48h (`self_correction`).
 * - Appends immutable amendment record into `task_sheet_amendments`.
 * - Reverses prior net positive ledger rows cleanly (`reversal_adjustment`) and posts `amended_entry` rows in `employee_work_logs`.
 */
export async function amendTaskSheetSubmission({
  submissionId,
  reason,
  actor,
  employeeActorId = null,
  amendedPayload,
  idempotencyKey = null,
}) {
  const cleanReason = String(reason || '').trim();
  if (cleanReason.length < 5) {
    throw new Error('A mandatory correction reason of at least 5 characters is required.');
  }

  const subId = Number(submissionId);
  if (!Number.isInteger(subId) || subId <= 0) {
    throw new Error('Invalid submissionId.');
  }

  return db.transaction(async (tx) => {
    if (idempotencyKey) {
      const existingByKey = await tx
        .prepare('SELECT * FROM task_sheet_amendments WHERE idempotency_key = ?')
        .get(idempotencyKey);
      if (existingByKey) {
        return { idempotent: true, amendment: existingByKey };
      }
    }

    const sub = await tx
      .prepare('SELECT * FROM task_sheet_submissions WHERE id = ?')
      .get(subId);
    if (!sub) {
      throw new Error('Task sheet submission not found.');
    }

    const isAdmin = isAdminOrOwner(actor);
    let resolvedEmployeeId = employeeActorId ? Number(employeeActorId) : null;

    if (!isAdmin) {
      if (!resolvedEmployeeId && actor?.id) {
        const emp = await tx.prepare('SELECT id FROM employees WHERE user_id = ?').get(Number(actor.id));
        resolvedEmployeeId = emp?.id ? Number(emp.id) : null;
      }
      const isSubmitterUser = actor?.id && sub.submitted_by && Number(sub.submitted_by) === Number(actor.id);
      const ownsLogs = resolvedEmployeeId
        ? Boolean(
            await tx
              .prepare("SELECT 1 AS ok FROM employee_work_logs WHERE source_type = 'task_sheet' AND source_id = ? AND employee_id = ? LIMIT 1")
              .get(subId, resolvedEmployeeId)
          )
        : false;

      if (!isSubmitterUser && !ownsLogs) {
        const err = new Error('Forbidden: You can only amend your own Task Sheet submissions.');
        err.statusCode = 403;
        throw err;
      }

      const createdStr = String(sub.created_at || '').trim();
      const iso = createdStr.endsWith('Z') || /[+-]\d{2}(:?\d{2})?$/.test(createdStr)
        ? createdStr
        : createdStr.replace(' ', 'T') + 'Z';
      const ageMs = Date.now() - new Date(iso).getTime();
      if (ageMs > AMENDMENT_WINDOW_MS) {
        const err = new Error('Self-correction window (48 hours) has expired. Ask an Administrator or Business Owner to record an admin adjustment.');
        err.statusCode = 403;
        throw err;
      }
    }

    // Locate target employee ID from existing logs or linked user
    let targetEmpId = resolvedEmployeeId;
    if (!targetEmpId) {
      const existingLog = await tx
        .prepare("SELECT employee_id, work_date FROM employee_work_logs WHERE source_type = 'task_sheet' AND source_id = ? LIMIT 1")
        .get(subId);
      if (existingLog?.employee_id) {
        targetEmpId = Number(existingLog.employee_id);
      } else if (sub.submitted_by) {
        const emp = await tx.prepare('SELECT id FROM employees WHERE user_id = ?').get(Number(sub.submitted_by));
        targetEmpId = emp?.id ? Number(emp.id) : null;
      }
    }

    if (!targetEmpId) {
      throw new Error('Cannot amend unmapped legacy anonymous submission before assigning an employee via Legacy Mapping.');
    }

    const priorAmendments = await tx
      .prepare('SELECT id, amendment_seq FROM task_sheet_amendments WHERE submission_id = ? ORDER BY amendment_seq ASC')
      .all(subId);
    const nextSeq = priorAmendments.length > 0
      ? Number(priorAmendments[priorAmendments.length - 1].amendment_seq) + 1
      : 1;

    const priorAmendmentIds = priorAmendments.map((a) => Number(a.id));
    let currentLedgerRows = await tx
      .prepare("SELECT * FROM employee_work_logs WHERE source_type = 'task_sheet' AND source_id = ?")
      .all(subId);

    if (priorAmendmentIds.length > 0) {
      const placeholders = priorAmendmentIds.map(() => '?').join(', ');
      const amendRows = await tx
        .prepare(
          `SELECT * FROM employee_work_logs
           WHERE source_type = 'task_sheet_amendment' AND source_id IN (${placeholders})`
        )
        .all(...priorAmendmentIds);
      currentLedgerRows = [...currentLedgerRows, ...amendRows];
    }

    // Group active net balances per tuple so reversals restore zero exact sum
    const netGroups = new Map();
    for (const row of currentLedgerRows) {
      const key = JSON.stringify([
        row.entry_type,
        row.project_id ?? null,
        row.ticket_id ?? null,
        row.category_code,
        row.work_date,
      ]);
      const cur = netGroups.get(key) || {
        entry_type: row.entry_type,
        project_id: row.project_id ?? null,
        ticket_id: row.ticket_id ?? null,
        category_code: row.category_code,
        work_date: row.work_date,
        netMinutes: 0,
      };
      cur.netMinutes += Number(row.duration_minutes || 0);
      netGroups.set(key, cur);
    }

    const workDate = String(
      amendedPayload.workDate ||
        currentLedgerRows[0]?.work_date ||
        toKolkata(new Date(sub.created_at)).toISOString().slice(0, 10)
    ).slice(0, 10);

    const newItems = await buildCanonicalLedgerItems(tx, {
      ...amendedPayload,
      project: amendedPayload.project ?? sub.project,
    });

    const amendmentType = isAdmin ? 'admin_adjustment' : 'self_correction';
    const actorUserId = actor?.id
      ? Number(actor.id)
      : sub.submitted_by
        ? Number(sub.submitted_by)
        : null;
    const actorRole = actor?.role ? normalizeRole(actor.role) : 'employee';

    const amendIns = await tx
      .prepare(
        `INSERT INTO task_sheet_amendments (
          submission_id, amendment_seq, employee_id, work_date,
          amendment_type, reason, original_snapshot_json, amended_payload_json,
          actor_id, actor_role, idempotency_key
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        subId,
        nextSeq,
        targetEmpId,
        workDate,
        amendmentType,
        cleanReason,
        JSON.stringify({ submission: sub, activeLedgerRows: currentLedgerRows }),
        JSON.stringify({ ...amendedPayload, workDate }),
        actorUserId,
        actorRole,
        idempotencyKey || null
      );

    const amendmentId = Number(amendIns.lastInsertRowid);
    let itemIdx = 0;

    // 1. Emit exact signed reversal adjustments for any non-zero net existing bucket
    for (const grp of netGroups.values()) {
      if (grp.netMinutes === 0) continue;
      await tx
        .prepare(
          `INSERT INTO employee_work_logs (
            employee_id, user_id, work_date, entry_type, entry_kind,
            project_id, ticket_id, category_code, duration_minutes,
            work_description, source_type, source_id, source_item_index, amendment_id
          ) VALUES (?, ?, ?, ?, 'reversal_adjustment', ?, ?, ?, ?, ?, 'task_sheet_amendment', ?, ?, ?)`
        )
        .run(
          targetEmpId,
          sub.submitted_by || null,
          grp.work_date,
          grp.entry_type,
          grp.project_id,
          grp.ticket_id,
          grp.category_code,
          -grp.netMinutes,
          `Reversal (${amendmentType}): ${cleanReason}`,
          amendmentId,
          itemIdx,
          amendmentId
        );
      itemIdx += 1;
    }

    // 2. Emit new corrected amended_entry rows
    for (const it of newItems) {
      await tx
        .prepare(
          `INSERT INTO employee_work_logs (
            employee_id, user_id, work_date, entry_type, entry_kind,
            project_id, ticket_id, category_code, duration_minutes,
            work_description, completed_work, pending_work, blocker_text, task_state,
            source_type, source_id, source_item_index, amendment_id
          ) VALUES (?, ?, ?, ?, 'amended_entry', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'task_sheet_amendment', ?, ?, ?)`
        )
        .run(
          targetEmpId,
          sub.submitted_by || null,
          workDate,
          it.entry_type,
          it.project_id,
          it.ticket_id,
          it.category_code,
          it.duration_minutes,
          it.work_description,
          it.completed_work,
          it.pending_work,
          it.blocker_text,
          it.task_state,
          amendmentId,
          itemIdx,
          amendmentId
        );
      itemIdx += 1;
    }

    await tx
      .prepare(
        `INSERT INTO audit_logs (actor_id, actor_name, action, entity_type, entity_id, details)
         VALUES (?, ?, 'task_sheet_amended', 'task_sheet_submission', ?, ?)`
      )
      .run(
        actorUserId,
        actor?.name || actor?.email || 'User',
        String(subId),
        JSON.stringify({ amendmentId, amendmentSeq: nextSeq, amendmentType, reason: cleanReason })
      );

    const amendment = await tx.prepare('SELECT * FROM task_sheet_amendments WHERE id = ?').get(amendmentId);
    return { idempotent: false, amendment };
  });
}

/**
 * Retrospective mapping for legacy `submitted_by IS NULL` submissions by Owner/Admin
 * without modifying original raw submission history (`legacy_anonymous`).
 */
export async function mapLegacyAnonymousSubmission({
  submissionId,
  employeeId,
  reason,
  actor,
  categoryCode = 'development',
}) {
  if (!isAdminOrOwner(actor)) {
    throw new Error('Forbidden: Only Business Owners or Administrators can map legacy Task Sheet submissions.');
  }
  const cleanReason = String(reason || '').trim();
  if (cleanReason.length < 5) {
    throw new Error('A mandatory mapping reason of at least 5 characters is required.');
  }

  const subId = Number(submissionId);
  const empId = Number(employeeId);

  return db.transaction(async (tx) => {
    const sub = await tx.prepare('SELECT * FROM task_sheet_submissions WHERE id = ?').get(subId);
    if (!sub) throw new Error('Task sheet submission not found.');
    if (sub.submitted_by !== null) {
      throw new Error('Submission already has a verified user attribution and is not a legacy anonymous record.');
    }

    const existing = await tx
      .prepare("SELECT id FROM employee_work_logs WHERE source_type = 'admin_legacy_map' AND source_id = ? LIMIT 1")
      .get(subId);
    if (existing) {
      throw new Error('This legacy submission has already been mapped to an employee work log.');
    }

    const emp = await tx.prepare('SELECT id, user_id, name FROM employees WHERE id = ?').get(empId);
    if (!emp) throw new Error('Target employee not found.');

    const createdRaw = String(sub.created_at || '').trim();
    const createdIso = createdRaw.endsWith('Z') || /[+-]\d{2}(:?\d{2})?$/.test(createdRaw)
      ? createdRaw
      : createdRaw.replace(' ', 'T') + 'Z';
    const workDate = toKolkata(new Date(createdIso)).toISOString().slice(0, 10);
    const catCode = await resolveValidCategory(tx, categoryCode, 'development');
    const minutes = Math.min(1440, Math.max(1, Math.round(Number(sub.hours_worked || 0) * 60)));

    let projectId = null;
    if (sub.linked_ticket_id) {
      const t = await tx.prepare('SELECT project_id FROM tickets WHERE id = ?').get(sub.linked_ticket_id);
      projectId = t?.project_id || null;
    }
    if (!projectId && sub.project) {
      const p = await tx.prepare('SELECT id FROM projects WHERE name = ?').get(sub.project);
      projectId = p?.id || null;
    }

    const ins = await tx
      .prepare(
        `INSERT INTO employee_work_logs (
          employee_id, user_id, work_date, entry_type, entry_kind,
          project_id, ticket_id, category_code, duration_minutes,
          work_description, blocker_text, task_state,
          source_type, source_id, source_item_index
        ) VALUES (?, ?, ?, 'ticket_work', 'initial', ?, ?, ?, ?, ?, ?, ?, 'admin_legacy_map', ?, 0)`
      )
      .run(
        emp.id,
        emp.user_id || null,
        workDate,
        projectId,
        sub.linked_ticket_id || null,
        catCode,
        minutes,
        `${sub.task_title || ''} — ${sub.task_description || ''}`.trim(),
        sub.blocker || '',
        sub.task_state === 'not_completed' ? 'not_completed' : 'completed',
        subId
      );

    await tx
      .prepare(
        `INSERT INTO audit_logs (actor_id, actor_name, action, entity_type, entity_id, details)
         VALUES (?, ?, 'legacy_task_sheet_mapped', 'task_sheet_submission', ?, ?)`
      )
      .run(
        actor.id,
        actor.name || actor.email || 'Admin',
        String(subId),
        JSON.stringify({ mappedEmployeeId: emp.id, workLogId: ins.lastInsertRowid, reason: cleanReason })
      );

    return tx.prepare('SELECT * FROM employee_work_logs WHERE id = ?').get(ins.lastInsertRowid);
  });
}

export async function listUnmappedLegacySubmissions() {
  return db
    .prepare(
      `SELECT s.*, p.id AS resolved_project_id
       FROM task_sheet_submissions s
       LEFT JOIN projects p ON p.name = s.project
       WHERE s.submitted_by IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM employee_work_logs ewl
           WHERE ewl.source_type IN ('task_sheet', 'admin_legacy_map', 'backfill')
             AND ewl.source_id = s.id
         )
       ORDER BY s.created_at DESC, s.id DESC`
    )
    .all();
}

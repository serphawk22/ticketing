import { db } from './db.js';
import { updateEmployee } from './employees.js';

export const DEFAULT_EXIT_TASKS = [
  // IT & Access
  { task_name: 'Revoke corporate email and Google Workspace access', category: 'IT' },
  { task_name: 'Revoke GitHub organization & repository permissions', category: 'IT' },
  { task_name: 'Revoke Slack, internal dashboard, and VPN credentials', category: 'IT' },
  // Assets
  { task_name: 'Collect and inspect company laptop, charger, and peripherals', category: 'Assets' },
  { task_name: 'Collect company ID badge and premises access keycard', category: 'Assets' },
  // Department & Work Handover
  { task_name: 'Review and reassign all open tickets & ongoing tasks', category: 'Department' },
  { task_name: 'Complete knowledge transfer documentation and handover sign-off', category: 'Department' },
  // Finance
  { task_name: 'Settle outstanding travel, expense, and reimbursement claims', category: 'Finance' },
  { task_name: 'Calculate final settlement (salary dues, leave encashment, notice adjustment)', category: 'Finance' },
  // HR
  { task_name: 'Conduct formal exit interview and document feedback', category: 'HR' },
  { task_name: 'Issue Relieving Letter, Experience Certificate, and No Objection Certificate (NOC)', category: 'HR' },
];

export const EXIT_STATUSES = [
  'submitted',
  'under_review',
  'approved',
  'in_progress',
  'cleared',
  'completed',
  'rejected',
  'cancelled',
];

/**
 * List exit requests with employee details, clearance summaries, and open liabilities.
 */
export async function getExitRequests({
  workspaceId = null,
  status = null,
  employeeId = null,
} = {}) {
  const conditions = [];
  const params = [];

  if (workspaceId) {
    conditions.push('r.workspace_id = ?');
    params.push(Number(workspaceId));
  }

  if (status) {
    conditions.push('r.status = ?');
    params.push(String(status));
  }

  if (employeeId) {
    conditions.push('r.employee_id = ?');
    params.push(Number(employeeId));
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const sql = `
    SELECT r.*,
           e.name AS employee_name,
           e.email AS employee_email,
           e.active AS employee_active,
           e.employment_status AS employee_status,
           e.department_id,
           d.name AS department_name,
           des.title AS designation_title,
           sub.name AS submitted_by_name,
           app.name AS approved_by_name,
           (SELECT COUNT(*) FROM tickets t WHERE t.employee_id = e.id AND t.status IN ('open', 'in_progress')) AS open_tickets_count,
           (SELECT COUNT(*) FROM asset_allocations al WHERE al.employee_id = e.id AND al.returned_at IS NULL) AS allocated_assets_count,
           (SELECT COUNT(*) FROM exit_checklist_items i WHERE i.exit_request_id = r.id) AS total_tasks,
           (SELECT COUNT(*) FROM exit_checklist_items i WHERE i.exit_request_id = r.id AND i.status = 'completed') AS completed_tasks
    FROM exit_requests r
    JOIN employees e ON e.id = r.employee_id
    LEFT JOIN departments d ON d.id = e.department_id
    LEFT JOIN designations des ON des.id = e.designation_id
    LEFT JOIN users sub ON sub.id = r.submitted_by
    LEFT JOIN users app ON app.id = r.approved_by
    ${whereClause}
    ORDER BY
      CASE r.status
        WHEN 'in_progress' THEN 1
        WHEN 'under_review' THEN 2
        WHEN 'submitted' THEN 3
        WHEN 'approved' THEN 4
        WHEN 'cleared' THEN 5
        WHEN 'completed' THEN 6
        ELSE 7
      END,
      r.created_at DESC
  `;

  return db.prepare(sql).all(...params);
}

/**
 * Get a single exit request by ID with its checklist items, active assets, and open tickets.
 */
export async function getExitRequest(id, workspaceId = null) {
  if (!id) return null;

  const conditions = ['r.id = ?'];
  const params = [Number(id)];

  if (workspaceId) {
    conditions.push('r.workspace_id = ?');
    params.push(Number(workspaceId));
  }

  const sql = `
    SELECT r.*,
           e.name AS employee_name,
           e.email AS employee_email,
           e.active AS employee_active,
           e.employment_status AS employee_status,
           e.department_id,
           d.name AS department_name,
           des.title AS designation_title,
           sub.name AS submitted_by_name,
           app.name AS approved_by_name
    FROM exit_requests r
    JOIN employees e ON e.id = r.employee_id
    LEFT JOIN departments d ON d.id = e.department_id
    LEFT JOIN designations des ON des.id = e.designation_id
    LEFT JOIN users sub ON sub.id = r.submitted_by
    LEFT JOIN users app ON app.id = r.approved_by
    WHERE ${conditions.join(' AND ')}
    LIMIT 1
  `;

  const request = await db.prepare(sql).get(...params);
  if (!request) return null;

  // Retrieve checklist items
  const items = await db
    .prepare(`
      SELECT i.*, u.name AS completed_by_name
      FROM exit_checklist_items i
      LEFT JOIN users u ON u.id = i.completed_by
      WHERE i.exit_request_id = ?
      ORDER BY i.id ASC
    `)
    .all(Number(id));

  // Retrieve unreturned company assets
  const assets = await db
    .prepare(`
      SELECT a.*, al.id AS allocation_id, al.allocated_at, al.issued_condition
      FROM asset_allocations al
      JOIN company_assets a ON a.id = al.asset_id
      WHERE al.employee_id = ? AND al.returned_at IS NULL
    `)
    .all(request.employee_id);

  // Retrieve open tickets assigned to employee
  const openTickets = await db
    .prepare(`
      SELECT t.id, t.title, t.status, t.priority, p.name AS project_name
      FROM tickets t
      LEFT JOIN projects p ON p.id = t.project_id
      WHERE t.employee_id = ? AND t.status IN ('open', 'in_progress')
      ORDER BY t.created_at DESC
    `)
    .all(request.employee_id);

  const totalTasks = items.length;
  const completedTasks = items.filter((i) => i.status === 'completed').length;
  const progressPercent = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  return {
    ...request,
    items,
    assets,
    open_tickets: openTickets,
    total_tasks: totalTasks,
    completed_tasks: completedTasks,
    progress_percent: progressPercent,
  };
}

/**
 * Submit / create an exit request.
 */
export async function createExitRequest({
  workspaceId,
  employeeId,
  resignationDate = null,
  lastWorkingDay = null,
  noticePeriodDays = 30,
  reason = '',
  submittedBy = null,
  customTasks = null,
}) {
  if (!workspaceId) throw new Error('Workspace ID is required.');
  if (!employeeId) throw new Error('Employee ID is required.');

  const emp = await db.prepare('SELECT id, name, active FROM employees WHERE id = ?').get(Number(employeeId));
  if (!emp) throw new Error('Employee not found.');

  // Prevent multiple active exit requests
  const existing = await db
    .prepare("SELECT id FROM exit_requests WHERE employee_id = ? AND status IN ('submitted', 'under_review', 'approved', 'in_clearance')")
    .get(Number(employeeId));
  if (existing) {
    throw new Error('An active exit procedure is already in progress for this employee.');
  }

  const resDate = resignationDate || new Date().toISOString().slice(0, 10);
  let lwd = lastWorkingDay;
  if (!lwd) {
    const d = new Date(resDate);
    d.setDate(d.getDate() + Number(noticePeriodDays || 30));
    lwd = d.toISOString().slice(0, 10);
  }

  const res = await db.prepare(`
    INSERT INTO exit_requests (
      workspace_id, employee_id, resignation_date, last_working_day,
      notice_period_days, reason, status, exit_interview_notes,
      hr_clearance, it_clearance, finance_clearance, noc_status,
      submitted_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'submitted', '', 0, 0, 0, 'pending', ?, datetime('now'), datetime('now'))
  `).run(
    Number(workspaceId),
    Number(employeeId),
    resDate,
    lwd,
    Number(noticePeriodDays || 30),
    String(reason || '').trim(),
    submittedBy ? Number(submittedBy) : null
  );

  const exitRequestId = res.lastInsertRowid;

  // Insert default checklist items
  const tasksToSeed = Array.isArray(customTasks) && customTasks.length > 0 ? customTasks : DEFAULT_EXIT_TASKS;
  for (const t of tasksToSeed) {
    await db.prepare(`
      INSERT INTO exit_checklist_items (
        workspace_id, exit_request_id, task_name, category,
        status, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'pending', '', datetime('now'), datetime('now'))
    `).run(
      Number(workspaceId),
      Number(exitRequestId),
      String(t.task_name || t.name),
      String(t.category || 'Department')
    );
  }

  // Update employee status to notice_period
  await updateEmployee(employeeId, {
    workspaceId,
    employment_status: 'notice_period',
  });

  return getExitRequest(exitRequestId, workspaceId);
}

/**
 * Update exit request metadata, approve, or transition status.
 */
export async function updateExitRequest(
  id,
  {
    workspaceId = null,
    status = null,
    lastWorkingDay = null,
    noticePeriodDays = null,
    reason = null,
    exitInterviewNotes = null,
    approvedBy = null,
  }
) {
  const current = await getExitRequest(id, workspaceId);
  if (!current) throw new Error('Exit request not found.');

  const updates = [];
  const params = [];

  if (status) {
    if (!EXIT_STATUSES.includes(status)) {
      throw new Error(`Invalid status. Allowed: ${EXIT_STATUSES.join(', ')}`);
    }
    updates.push('status = ?');
    params.push(status);

    if (status === 'approved' && approvedBy) {
      updates.push('approved_by = ?');
      params.push(Number(approvedBy));
    }
  }

  if (lastWorkingDay !== undefined && lastWorkingDay !== null) {
    updates.push('last_working_day = ?');
    params.push(lastWorkingDay);
  }

  if (noticePeriodDays !== undefined && noticePeriodDays !== null) {
    updates.push('notice_period_days = ?');
    params.push(Number(noticePeriodDays));
  }

  if (reason !== null) {
    updates.push('reason = ?');
    params.push(String(reason).trim());
  }

  if (exitInterviewNotes !== null) {
    updates.push('exit_interview_notes = ?');
    params.push(String(exitInterviewNotes).trim());
  }

  if (updates.length === 0) return current;

  updates.push("updated_at = datetime('now')");
  params.push(Number(id));

  await db.prepare(`UPDATE exit_requests SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  return getExitRequest(id, workspaceId);
}

/**
 * Update departmental clearance status (HR, IT, Finance).
 * When all 3 are cleared and all assets are returned:
 * - noc_status is set to 'issued'
 * - exit request status is set to 'completed'
 * - employee employment_status is set to 'resigned' and active = 0
 */
export async function updateDepartmentClearance(
  id,
  { workspaceId = null, department, cleared = true, notes = '', updatedBy = null }
) {
  const current = await getExitRequest(id, workspaceId);
  if (!current) throw new Error('Exit request not found.');

  const validDepts = ['hr', 'it', 'finance'];
  if (!validDepts.includes(department)) {
    throw new Error(`Invalid department for clearance. Allowed: ${validDepts.join(', ')}`);
  }

  const column = `${department}_clearance`;
  const val = cleared ? 1 : 0;

  await db.prepare(`
    UPDATE exit_requests
    SET ${column} = ?,
        status = CASE WHEN status = 'submitted' THEN 'in_progress' ELSE status END,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(val, Number(id));

  // Check if all clearances are now satisfied
  const refreshed = await getExitRequest(id, workspaceId);
  const isHrDone = Boolean(refreshed.hr_clearance);
  const isItDone = Boolean(refreshed.it_clearance);
  const isFinDone = Boolean(refreshed.finance_clearance);

  if (isHrDone && isItDone && isFinDone) {
    // Check unreturned assets
    const unreturnedAssets = await db
      .prepare('SELECT COUNT(*) AS c FROM asset_allocations WHERE employee_id = ? AND returned_at IS NULL')
      .get(refreshed.employee_id);

    if (unreturnedAssets.c === 0) {
      // Issue NOC and complete exit
      await db.prepare(`
        UPDATE exit_requests
        SET status = 'completed',
            noc_status = 'approved',
            updated_at = datetime('now')
        WHERE id = ?
      `).run(Number(id));

      // Deactivate employee and set employment_status to resigned
      await updateEmployee(refreshed.employee_id, {
        workspaceId: refreshed.workspace_id,
        employment_status: 'resigned',
        active: 0,
      });
    }
  }

  return getExitRequest(id, workspaceId);
}

/**
 * Reassign all open tickets of an exiting employee to a new employee.
 */
export async function reassignExitEmployeeTickets(exitingEmpId, targetEmpId, workspaceId = null) {
  if (!exitingEmpId || !targetEmpId) throw new Error('Both exiting and target employee IDs are required.');
  if (Number(exitingEmpId) === Number(targetEmpId)) throw new Error('Cannot reassign tickets to the same employee.');

  const targetEmp = await db.prepare('SELECT id, name, active FROM employees WHERE id = ?').get(Number(targetEmpId));
  if (!targetEmp || !targetEmp.active) throw new Error('Target assignee must be an active employee.');

  const res = await db.prepare(`
    UPDATE tickets
    SET employee_id = ?, updated_at = datetime('now')
    WHERE employee_id = ? AND status IN ('open', 'in_progress')
  `).run(Number(targetEmpId), Number(exitingEmpId));

  return { reassigned_count: res.rowCount ?? res.changes ?? 0, target_employee_name: targetEmp.name };
}

/**
 * Update checklist task item.
 */
export async function updateExitChecklistItem(
  itemId,
  { workspaceId = null, status, notes = null, completedBy = null }
) {
  const item = await db.prepare('SELECT * FROM exit_checklist_items WHERE id = ?').get(Number(itemId));
  if (!item) throw new Error('Checklist item not found.');

  const updates = [];
  const params = [];

  if (status) {
    updates.push('status = ?');
    params.push(status);

    if (status === 'completed') {
      updates.push("completed_at = datetime('now')");
      if (completedBy) {
        updates.push('completed_by = ?');
        params.push(Number(completedBy));
      }
    } else {
      updates.push('completed_at = NULL');
      updates.push('completed_by = NULL');
    }
  }

  if (notes !== null) {
    updates.push('notes = ?');
    params.push(String(notes));
  }

  updates.push("updated_at = datetime('now')");
  params.push(Number(itemId));

  await db.prepare(`UPDATE exit_checklist_items SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  return getExitRequest(item.exit_request_id, workspaceId);
}

/**
 * Delete an exit request.
 */
export async function deleteExitRequest(id, workspaceId = null) {
  if (!id) return false;
  const conditions = ['id = ?'];
  const params = [Number(id)];
  if (workspaceId) {
    conditions.push('workspace_id = ?');
    params.push(Number(workspaceId));
  }

  const existing = await db.prepare(`SELECT id, employee_id, workspace_id FROM exit_requests WHERE ${conditions.join(' AND ')}`).get(...params);
  if (!existing) return false;

  await db.prepare('DELETE FROM exit_checklist_items WHERE exit_request_id = ?').run(Number(id));
  await db.prepare('DELETE FROM exit_requests WHERE id = ?').run(Number(id));

  // If employee was in notice_period, revert to active
  const emp = await db.prepare('SELECT id, employment_status FROM employees WHERE id = ?').get(existing.employee_id);
  if (emp && emp.employment_status === 'notice_period') {
    await updateEmployee(existing.employee_id, {
      workspaceId: existing.workspace_id,
      employment_status: 'active',
      active: 1,
    });
  }

  return true;
}

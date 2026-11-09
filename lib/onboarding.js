import { db } from './db.js';

export const DEFAULT_ONBOARDING_TASKS = [
  { task_name: 'Submit signed offer letter and employment agreement', category: 'Documentation' },
  { task_name: 'Upload National ID / Passport and address proof', category: 'Documentation' },
  { task_name: 'Submit Bank Account & Tax Declaration details', category: 'Documentation' },
  { task_name: 'Submit past educational and experience certificates', category: 'Documentation' },
  { task_name: 'Provision SerpHawk corporate email and account credentials', category: 'IT Setup' },
  { task_name: 'Grant GitHub repository and engineering tools access', category: 'IT Setup' },
  { task_name: 'Configure corporate workstation / laptop and peripherals', category: 'Asset Allocation' },
  { task_name: 'Issue Company ID card & premises access credentials', category: 'Asset Allocation' },
  { task_name: 'Conduct SerpHawk company culture and values orientation', category: 'Orientation' },
  { task_name: 'Assign Onboarding Buddy and introduction meeting', category: 'Orientation' },
  { task_name: 'Schedule Manager 1-on-1 and initial 30-day goals setup', category: 'Orientation' },
];

export const ONBOARDING_STATUSES = ['pre_boarding', 'in_progress', 'completed', 'cancelled'];
export const CHECKLIST_STATUSES = ['pending', 'completed', 'skipped'];

/**
 * List onboarding workflows with employee details and progress counts.
 */
export async function getOnboardingWorkflows({
  workspaceId = null,
  status = null,
  employeeId = null,
} = {}) {
  const conditions = [];
  const params = [];

  if (workspaceId) {
    conditions.push('w.workspace_id = ?');
    params.push(Number(workspaceId));
  }

  if (status) {
    conditions.push('w.status = ?');
    params.push(String(status));
  }

  if (employeeId) {
    conditions.push('w.employee_id = ?');
    params.push(Number(employeeId));
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const sql = `
    SELECT w.*,
           e.name AS employee_name,
           e.email AS employee_email,
           e.department_id,
           d.name AS department_name,
           des.title AS designation_title,
           buddy.name AS buddy_name,
           creator.name AS creator_name,
           (SELECT COUNT(*) FROM onboarding_checklist_items i WHERE i.workflow_id = w.id) AS total_tasks,
           (SELECT COUNT(*) FROM onboarding_checklist_items i WHERE i.workflow_id = w.id AND i.status = 'completed') AS completed_tasks,
           (SELECT COUNT(*) FROM onboarding_checklist_items i WHERE i.workflow_id = w.id AND i.status = 'pending') AS pending_tasks
    FROM onboarding_workflows w
    JOIN employees e ON e.id = w.employee_id
    LEFT JOIN departments d ON d.id = e.department_id
    LEFT JOIN designations des ON des.id = e.designation_id
    LEFT JOIN employees buddy ON buddy.id = w.buddy_employee_id
    LEFT JOIN users creator ON creator.id = w.created_by
    ${whereClause}
    ORDER BY
      CASE w.status
        WHEN 'in_progress' THEN 1
        WHEN 'pre_boarding' THEN 2
        WHEN 'completed' THEN 3
        ELSE 4
      END,
      w.created_at DESC
  `;

  const rows = await db.prepare(sql).all(...params);
  return rows.map((r) => {
    const total = Number(r.total_tasks || 0);
    const completed = Number(r.completed_tasks || 0);
    const progressPercent = total > 0 ? Math.round((completed / total) * 100) : 0;
    return {
      ...r,
      total_tasks: total,
      completed_tasks: completed,
      pending_tasks: Number(r.pending_tasks || 0),
      progress_percent: progressPercent,
    };
  });
}

/**
 * Get a single onboarding workflow and all its checklist items.
 */
export async function getOnboardingWorkflow(id, workspaceId = null) {
  if (!id) return null;

  const conditions = ['w.id = ?'];
  const params = [Number(id)];

  if (workspaceId) {
    conditions.push('w.workspace_id = ?');
    params.push(Number(workspaceId));
  }

  const sql = `
    SELECT w.*,
           e.name AS employee_name,
           e.email AS employee_email,
           e.department_id,
           d.name AS department_name,
           des.title AS designation_title,
           buddy.name AS buddy_name,
           creator.name AS creator_name
    FROM onboarding_workflows w
    JOIN employees e ON e.id = w.employee_id
    LEFT JOIN departments d ON d.id = e.department_id
    LEFT JOIN designations des ON des.id = e.designation_id
    LEFT JOIN employees buddy ON buddy.id = w.buddy_employee_id
    LEFT JOIN users creator ON creator.id = w.created_by
    WHERE ${conditions.join(' AND ')}
    LIMIT 1
  `;

  const workflow = await db.prepare(sql).get(...params);
  if (!workflow) return null;

  const itemsSql = `
    SELECT i.*,
           u.name AS completed_by_name
    FROM onboarding_checklist_items i
    LEFT JOIN users u ON u.id = i.completed_by
    WHERE i.workflow_id = ?
    ORDER BY i.id ASC
  `;

  const items = await db.prepare(itemsSql).all(Number(id));
  const total = items.length;
  const completed = items.filter((i) => i.status === 'completed').length;
  const progressPercent = total > 0 ? Math.round((completed / total) * 100) : 0;

  return {
    ...workflow,
    items,
    total_tasks: total,
    completed_tasks: completed,
    pending_tasks: items.filter((i) => i.status === 'pending').length,
    progress_percent: progressPercent,
  };
}

/**
 * Create a new onboarding workflow and initialize default checklist items.
 */
export async function createOnboardingWorkflow({
  workspaceId,
  employeeId,
  targetJoiningDate = null,
  buddyEmployeeId = null,
  createdBy = null,
  customTasks = null,
}) {
  if (!workspaceId) throw new Error('Workspace ID is required.');
  if (!employeeId) throw new Error('Employee ID is required.');

  // Validate employee exists
  const emp = await db.prepare('SELECT id, name, joining_date FROM employees WHERE id = ?').get(Number(employeeId));
  if (!emp) throw new Error('Employee not found.');

  // Check if an open onboarding already exists
  const existing = await db
    .prepare("SELECT id FROM onboarding_workflows WHERE employee_id = ? AND status IN ('pre_boarding', 'in_progress')")
    .get(Number(employeeId));
  if (existing) {
    throw new Error('An active onboarding workflow already exists for this employee.');
  }

  const resolvedDate = targetJoiningDate || emp.joining_date || new Date().toISOString().slice(0, 10);

  const res = await db.prepare(`
    INSERT INTO onboarding_workflows (
      workspace_id, employee_id, target_joining_date,
      buddy_employee_id, status, started_at, created_by,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'pre_boarding', datetime('now'), ?, datetime('now'), datetime('now'))
  `).run(
    Number(workspaceId),
    Number(employeeId),
    resolvedDate,
    buddyEmployeeId ? Number(buddyEmployeeId) : null,
    createdBy ? Number(createdBy) : null
  );

  const workflowId = res.lastInsertRowid;

  // Insert checklist items
  const tasksToSeed = Array.isArray(customTasks) && customTasks.length > 0 ? customTasks : DEFAULT_ONBOARDING_TASKS;

  for (const t of tasksToSeed) {
    await db.prepare(`
      INSERT INTO onboarding_checklist_items (
        workspace_id, workflow_id, task_name, category,
        status, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'pending', '', datetime('now'), datetime('now'))
    `).run(
      Number(workspaceId),
      Number(workflowId),
      String(t.task_name || t.name),
      String(t.category || 'Documentation')
    );
  }

  return getOnboardingWorkflow(workflowId, workspaceId);
}

/**
 * Update onboarding workflow status or details.
 */
export async function updateOnboardingWorkflow(
  id,
  { workspaceId = null, status = null, targetJoiningDate = null, buddyEmployeeId = null }
) {
  const current = await getOnboardingWorkflow(id, workspaceId);
  if (!current) throw new Error('Onboarding workflow not found.');

  const updates = [];
  const params = [];

  if (status) {
    if (!ONBOARDING_STATUSES.includes(status)) {
      throw new Error(`Invalid status. Allowed statuses: ${ONBOARDING_STATUSES.join(', ')}`);
    }
    updates.push('status = ?');
    params.push(status);

    if (status === 'completed' && !current.completed_at) {
      updates.push("completed_at = datetime('now')");
    } else if (status !== 'completed' && current.completed_at) {
      updates.push('completed_at = NULL');
    }
  }

  if (targetJoiningDate !== undefined) {
    updates.push('target_joining_date = ?');
    params.push(targetJoiningDate);
  }

  if (buddyEmployeeId !== undefined) {
    updates.push('buddy_employee_id = ?');
    params.push(buddyEmployeeId ? Number(buddyEmployeeId) : null);
  }

  if (updates.length === 0) return current;

  updates.push("updated_at = datetime('now')");
  params.push(Number(id));

  await db.prepare(`UPDATE onboarding_workflows SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  return getOnboardingWorkflow(id, workspaceId);
}

/**
 * Add a custom task to an onboarding checklist.
 */
export async function addChecklistItem(
  workflowId,
  { workspaceId, taskName, category = 'General', dueDate = null }
) {
  if (!workflowId) throw new Error('Workflow ID is required.');
  if (!taskName || !taskName.trim()) throw new Error('Task name is required.');

  const res = await db.prepare(`
    INSERT INTO onboarding_checklist_items (
      workspace_id, workflow_id, task_name, category,
      status, due_date, notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'pending', ?, '', datetime('now'), datetime('now'))
  `).run(
    Number(workspaceId),
    Number(workflowId),
    String(taskName.trim()),
    String(category || 'General'),
    dueDate || null
  );

  return db.prepare('SELECT * FROM onboarding_checklist_items WHERE id = ?').get(res.lastInsertRowid);
}

/**
 * Update status of an individual checklist item.
 */
export async function updateChecklistItem(
  itemId,
  { workspaceId = null, status, notes = null, completedBy = null }
) {
  if (!itemId) throw new Error('Item ID is required.');
  if (status && !CHECKLIST_STATUSES.includes(status)) {
    throw new Error(`Invalid status. Allowed statuses: ${CHECKLIST_STATUSES.join(', ')}`);
  }

  const item = await db.prepare('SELECT * FROM onboarding_checklist_items WHERE id = ?').get(Number(itemId));
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

  if (notes !== null && notes !== undefined) {
    updates.push('notes = ?');
    params.push(String(notes));
  }

  updates.push("updated_at = datetime('now')");
  params.push(Number(itemId));

  await db.prepare(`UPDATE onboarding_checklist_items SET ${updates.join(', ')} WHERE id = ?`).run(...params);

  // Check if all tasks are completed in the workflow; if so, update workflow status to in_progress or completed
  const remaining = await db
    .prepare("SELECT COUNT(*) AS c FROM onboarding_checklist_items WHERE workflow_id = ? AND status = 'pending'")
    .get(item.workflow_id);

  if (remaining.c === 0) {
    // All tasks completed/skipped -> automatically mark workflow as completed
    await db.prepare("UPDATE onboarding_workflows SET status = 'completed', completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND status != 'completed'").run(item.workflow_id);
  } else {
    // Has some completed tasks -> ensure status is at least 'in_progress'
    await db.prepare("UPDATE onboarding_workflows SET status = 'in_progress', completed_at = NULL, updated_at = datetime('now') WHERE id = ? AND status = 'pre_boarding'").run(item.workflow_id);
  }

  return getOnboardingWorkflow(item.workflow_id, workspaceId);
}

/**
 * Delete a checklist item.
 */
export async function deleteChecklistItem(itemId) {
  if (!itemId) return false;
  await db.prepare('DELETE FROM onboarding_checklist_items WHERE id = ?').run(Number(itemId));
  return true;
}

/**
 * Delete an onboarding workflow and its checklist items.
 */
export async function deleteOnboardingWorkflow(id, workspaceId = null) {
  if (!id) return false;
  const conditions = ['id = ?'];
  const params = [Number(id)];
  if (workspaceId) {
    conditions.push('workspace_id = ?');
    params.push(Number(workspaceId));
  }

  const existing = await db.prepare(`SELECT id FROM onboarding_workflows WHERE ${conditions.join(' AND ')}`).get(...params);
  if (!existing) return false;

  await db.prepare('DELETE FROM onboarding_checklist_items WHERE workflow_id = ?').run(Number(id));
  await db.prepare('DELETE FROM onboarding_workflows WHERE id = ?').run(Number(id));
  return true;
}


import { db } from './db.js';

export const ASSET_CATEGORIES = [
  'Laptop',
  'Desktop',
  'Monitor',
  'Mobile / Tablet',
  'Peripheral',
  'Access Card',
  'Software License',
  'Other',
];

export const ASSET_STATUSES = ['available', 'allocated', 'maintenance', 'retired', 'lost'];
export const ASSET_CONDITIONS = ['new', 'good', 'fair', 'damaged'];

/**
 * List assets with current allocation details and filters.
 */
export async function getAssets({
  workspaceId = null,
  status = null,
  category = null,
  search = null,
} = {}) {
  const conditions = [];
  const params = [];

  if (workspaceId) {
    conditions.push('a.workspace_id = ?');
    params.push(Number(workspaceId));
  }

  if (status) {
    conditions.push('a.status = ?');
    params.push(String(status));
  }

  if (category) {
    conditions.push('a.category = ?');
    params.push(String(category));
  }

  if (search && search.trim()) {
    conditions.push('(a.asset_tag LIKE ? OR a.name LIKE ? OR a.serial_number LIKE ?)');
    const term = `%${search.trim()}%`;
    params.push(term, term, term);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const sql = `
    SELECT a.*,
           al.id AS active_allocation_id,
           al.employee_id AS assigned_employee_id,
           al.allocated_at AS active_allocated_at,
           al.issued_condition AS active_issued_condition,
           e.name AS assigned_employee_name,
           e.email AS assigned_employee_email,
           d.name AS assigned_employee_dept
    FROM company_assets a
    LEFT JOIN asset_allocations al ON al.asset_id = a.id AND al.returned_at IS NULL
    LEFT JOIN employees e ON e.id = al.employee_id
    LEFT JOIN departments d ON d.id = e.department_id
    ${whereClause}
    ORDER BY a.created_at DESC
  `;

  return db.prepare(sql).all(...params);
}

/**
 * Get a single asset by ID with current allocation and full history.
 */
export async function getAsset(id, workspaceId = null) {
  if (!id) return null;

  const conditions = ['a.id = ?'];
  const params = [Number(id)];

  if (workspaceId) {
    conditions.push('a.workspace_id = ?');
    params.push(Number(workspaceId));
  }

  const sql = `
    SELECT a.*,
           al.id AS active_allocation_id,
           al.employee_id AS assigned_employee_id,
           al.allocated_at AS active_allocated_at,
           al.issued_condition AS active_issued_condition,
           al.notes AS active_allocation_notes,
           e.name AS assigned_employee_name,
           e.email AS assigned_employee_email,
           d.name AS assigned_employee_dept
    FROM company_assets a
    LEFT JOIN asset_allocations al ON al.asset_id = a.id AND al.returned_at IS NULL
    LEFT JOIN employees e ON e.id = al.employee_id
    LEFT JOIN departments d ON d.id = e.department_id
    WHERE ${conditions.join(' AND ')}
    LIMIT 1
  `;

  const asset = await db.prepare(sql).get(...params);
  if (!asset) return null;

  // Retrieve full history
  const historySql = `
    SELECT al.*,
           e.name AS employee_name,
           e.email AS employee_email,
           alloc_by.name AS allocated_by_name,
           ret_to.name AS returned_to_name
    FROM asset_allocations al
    JOIN employees e ON e.id = al.employee_id
    LEFT JOIN users alloc_by ON alloc_by.id = al.allocated_by
    LEFT JOIN users ret_to ON ret_to.id = al.returned_to
    WHERE al.asset_id = ?
    ORDER BY al.allocated_at DESC
  `;

  const history = await db.prepare(historySql).all(Number(id));
  return { ...asset, history };
}

/**
 * Create a new company asset.
 */
export async function createAsset({
  workspaceId,
  assetTag,
  name,
  category = 'Laptop',
  serialNumber = '',
  condition = 'new',
  status = 'available',
  purchaseDate = null,
  notes = '',
}) {
  if (!workspaceId) throw new Error('Workspace ID is required.');
  if (!assetTag || !assetTag.trim()) throw new Error('Asset tag is required.');
  if (!name || !name.trim()) throw new Error('Asset name is required.');

  // Validate duplicate tag in workspace
  const existing = await db
    .prepare('SELECT id FROM company_assets WHERE workspace_id = ? AND asset_tag = ?')
    .get(Number(workspaceId), assetTag.trim().toUpperCase());
  if (existing) {
    throw new Error(`Asset with tag "${assetTag.trim().toUpperCase()}" already exists in this workspace.`);
  }

  const res = await db.prepare(`
    INSERT INTO company_assets (
      workspace_id, asset_tag, name, category,
      serial_number, condition, status, purchase_date,
      notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `).run(
    Number(workspaceId),
    assetTag.trim().toUpperCase(),
    name.trim(),
    String(category || 'Laptop'),
    String(serialNumber ? serialNumber.trim() : ''),
    String(condition || 'new'),
    String(status || 'available'),
    purchaseDate || null,
    String(notes ? notes.trim() : '')
  );

  return getAsset(res.lastInsertRowid, workspaceId);
}

/**
 * Update asset details.
 */
export async function updateAsset(
  id,
  {
    workspaceId = null,
    assetTag = null,
    name = null,
    category = null,
    serialNumber = null,
    condition = null,
    status = null,
    purchaseDate = null,
    notes = null,
  }
) {
  const current = await getAsset(id, workspaceId);
  if (!current) throw new Error('Asset not found.');

  const updates = [];
  const params = [];

  if (assetTag && assetTag.trim().toUpperCase() !== current.asset_tag) {
    const dup = await db
      .prepare('SELECT id FROM company_assets WHERE workspace_id = ? AND asset_tag = ? AND id != ?')
      .get(current.workspace_id, assetTag.trim().toUpperCase(), Number(id));
    if (dup) {
      throw new Error(`Asset with tag "${assetTag.trim().toUpperCase()}" already exists.`);
    }
    updates.push('asset_tag = ?');
    params.push(assetTag.trim().toUpperCase());
  }

  if (name !== null) {
    if (!name.trim()) throw new Error('Asset name cannot be empty.');
    updates.push('name = ?');
    params.push(name.trim());
  }

  if (category !== null) {
    updates.push('category = ?');
    params.push(category);
  }

  if (serialNumber !== null) {
    updates.push('serial_number = ?');
    params.push(String(serialNumber).trim());
  }

  if (condition !== null) {
    if (!ASSET_CONDITIONS.includes(condition)) {
      throw new Error(`Invalid condition. Allowed: ${ASSET_CONDITIONS.join(', ')}`);
    }
    updates.push('condition = ?');
    params.push(condition);
  }

  if (status !== null) {
    if (!ASSET_STATUSES.includes(status)) {
      throw new Error(`Invalid status. Allowed: ${ASSET_STATUSES.join(', ')}`);
    }
    // Prevent marking available if still actively allocated
    if (status === 'available' && current.assigned_employee_id) {
      throw new Error('Cannot set status to available while asset is actively allocated. Return the asset first.');
    }
    updates.push('status = ?');
    params.push(status);
  }

  if (purchaseDate !== undefined) {
    updates.push('purchase_date = ?');
    params.push(purchaseDate || null);
  }

  if (notes !== null) {
    updates.push('notes = ?');
    params.push(String(notes));
  }

  if (updates.length === 0) return current;

  updates.push("updated_at = datetime('now')");
  params.push(Number(id));

  await db.prepare(`UPDATE company_assets SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  return getAsset(id, workspaceId);
}

/**
 * Allocate an asset to an employee.
 */
export async function allocateAsset({
  workspaceId,
  assetId,
  employeeId,
  allocatedAt = null,
  condition = null,
  notes = '',
  allocatedBy = null,
}) {
  if (!assetId) throw new Error('Asset ID is required.');
  if (!employeeId) throw new Error('Employee ID is required.');

  const asset = await getAsset(assetId, workspaceId);
  if (!asset) throw new Error('Asset not found.');

  if (asset.status === 'allocated' || asset.active_allocation_id) {
    throw new Error(`Asset is already allocated to ${asset.assigned_employee_name || 'an employee'}.`);
  }
  if (['retired', 'lost'].includes(asset.status)) {
    throw new Error(`Cannot allocate an asset with status "${asset.status}".`);
  }

  const emp = await db.prepare('SELECT id, name, active FROM employees WHERE id = ?').get(Number(employeeId));
  if (!emp) throw new Error('Employee not found.');
  if (!emp.active) throw new Error('Cannot allocate assets to an inactive employee.');

  const allocDate = allocatedAt || new Date().toISOString().slice(0, 10);
  const allocCondition = condition || asset.condition || 'good';

  const res = await db.prepare(`
    INSERT INTO asset_allocations (
      workspace_id, asset_id, employee_id, allocated_at,
      issued_condition, returned_condition, allocated_by,
      notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, '', ?, ?, datetime('now'), datetime('now'))
  `).run(
    Number(workspaceId || asset.workspace_id),
    Number(assetId),
    Number(employeeId),
    allocDate,
    allocCondition,
    allocatedBy ? Number(allocatedBy) : null,
    String(notes || '')
  );

  // Update asset status and condition
  await db.prepare(`
    UPDATE company_assets
    SET status = 'allocated', condition = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(allocCondition, Number(assetId));

  return getAsset(assetId, workspaceId);
}

/**
 * Return an asset from an employee.
 */
export async function returnAsset({
  workspaceId = null,
  assetId,
  returnedAt = null,
  condition = null,
  notes = '',
  returnedTo = null,
}) {
  if (!assetId) throw new Error('Asset ID is required.');

  const asset = await getAsset(assetId, workspaceId);
  if (!asset) throw new Error('Asset not found.');

  const activeAlloc = await db
    .prepare('SELECT * FROM asset_allocations WHERE asset_id = ? AND returned_at IS NULL')
    .get(Number(assetId));

  if (!activeAlloc) {
    throw new Error('This asset is not currently allocated to any employee.');
  }

  const retDate = returnedAt || new Date().toISOString().slice(0, 10);
  const retCondition = condition || asset.condition || 'good';
  const newAssetStatus = retCondition === 'damaged' ? 'maintenance' : 'available';

  const updatedNotes = notes
    ? activeAlloc.notes
      ? `${activeAlloc.notes}\n[Return]: ${notes}`
      : `[Return]: ${notes}`
    : activeAlloc.notes;

  await db.prepare(`
    UPDATE asset_allocations
    SET returned_at = ?,
        returned_condition = ?,
        returned_to = ?,
        notes = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(
    retDate,
    retCondition,
    returnedTo ? Number(returnedTo) : null,
    updatedNotes,
    activeAlloc.id
  );

  // Update asset status
  await db.prepare(`
    UPDATE company_assets
    SET status = ?, condition = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(newAssetStatus, retCondition, Number(assetId));

  return getAsset(assetId, workspaceId);
}

/**
 * Retrieve all currently allocated assets for a specific employee.
 */
export async function getEmployeeAssets(employeeId, workspaceId = null) {
  if (!employeeId) return [];

  const conditions = ['al.employee_id = ?', 'al.returned_at IS NULL'];
  const params = [Number(employeeId)];

  if (workspaceId) {
    conditions.push('a.workspace_id = ?');
    params.push(Number(workspaceId));
  }

  const sql = `
    SELECT a.*,
           al.id AS allocation_id,
           al.allocated_at,
           al.issued_condition,
           al.notes AS allocation_notes
    FROM asset_allocations al
    JOIN company_assets a ON a.id = al.asset_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY al.allocated_at DESC
  `;

  return db.prepare(sql).all(...params);
}

/**
 * Delete an asset (safe delete guard: blocks deletion if actively allocated).
 */
export async function deleteAsset(id, workspaceId = null) {
  const asset = await getAsset(id, workspaceId);
  if (!asset) return false;

  if (asset.assigned_employee_id || asset.status === 'allocated') {
    throw new Error(`Cannot delete asset "${asset.asset_tag}": it is currently allocated to ${asset.assigned_employee_name}. Please return the asset first.`);
  }

  // Delete past allocations and asset
  await db.prepare('DELETE FROM asset_allocations WHERE asset_id = ?').run(Number(id));
  await db.prepare('DELETE FROM company_assets WHERE id = ?').run(Number(id));
  return true;
}


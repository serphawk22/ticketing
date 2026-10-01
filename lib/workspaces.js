import { db } from './db';

const WORKSPACES_SELECT = `
  SELECT w.*,
    (SELECT COUNT(*) FROM projects p WHERE p.workspace_id = w.id) AS project_count
  FROM workspaces w
`;

const WORKSPACES_ORDER = ' ORDER BY w.name COLLATE NOCASE';

export async function getAllWorkspaces() {
  return db.prepare(`${WORKSPACES_SELECT}${WORKSPACES_ORDER}`).all();
}

export async function getWorkspace(id) {
  return db
    .prepare(`${WORKSPACES_SELECT} WHERE w.id = ?${WORKSPACES_ORDER}`)
    .get(Number(id));
}

export async function getWorkspaceByKey(key) {
  return db.prepare('SELECT * FROM workspaces WHERE key = ?').get(key);
}

export async function workspaceExists(id) {
  if (!id) return false;
  return Boolean(
    await db.prepare('SELECT 1 AS ok FROM workspaces WHERE id = ?').get(Number(id))
  );
}

export async function createWorkspace({ key, name, description = '', color }) {
  const info = await db
    .prepare(
      'INSERT INTO workspaces (key, name, description, color) VALUES (?, ?, ?, ?)'
    )
    .run(key, name, description, color);

  return getWorkspace(info.lastInsertRowid);
}

export async function updateWorkspace(id, { name, description, color }) {
  await db
    .prepare(
      `UPDATE workspaces
       SET name = ?, description = ?, color = ?
       WHERE id = ?`
    )
    .run(name, description, color, Number(id));

  return getWorkspace(id);
}

// Deleting a workspace leaves its projects in place with no workspace, the same
// way deleting a project leaves its tickets in place. A workspace is a grouping
// label, so removing one should not take the projects with it.
export async function deleteWorkspace(id) {
  const workspaceId = Number(id);
  const detachedInfo = await db
    .prepare('UPDATE projects SET workspace_id = NULL WHERE workspace_id = ?')
    .run(workspaceId);

  await db.prepare('DELETE FROM workspaces WHERE id = ?').run(workspaceId);

  return detachedInfo.rowCount;
}

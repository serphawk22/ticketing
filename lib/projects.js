import { db } from './db';

const PROJECTS_SELECT = `
  SELECT p.*,
    (SELECT COUNT(*) FROM tickets t WHERE t.project_id = p.id) AS ticket_count,
    (SELECT COUNT(*) FROM tickets t
      WHERE t.project_id = p.id AND t.status IN ('open', 'in_progress')) AS open_count
  FROM projects p
`;

const PROJECTS_ORDER = ' ORDER BY p.name COLLATE NOCASE';

export async function getAllProjects() {
  return db.prepare(`${PROJECTS_SELECT}${PROJECTS_ORDER}`).all();
}

export async function getProject(id) {
  return db
    .prepare(`${PROJECTS_SELECT} WHERE p.id = ?${PROJECTS_ORDER}`)
    .get(Number(id));
}

export async function getProjectByKey(key) {
  return db.prepare('SELECT * FROM projects WHERE key = ?').get(key);
}

export async function projectExists(id) {
  if (!id) return false;
  return Boolean(
    await db.prepare('SELECT 1 AS ok FROM projects WHERE id = ?').get(Number(id))
  );
}

export async function createProject({ key, name, description = '', color }) {
  const info = await db
    .prepare(
      'INSERT INTO projects (key, name, description, color) VALUES (?, ?, ?, ?)'
    )
    .run(key, name, description, color);

  return getProject(info.lastInsertRowid);
}

export async function updateProject(id, { name, description, color }) {
  await db.prepare(
    `UPDATE projects
     SET name = ?, description = ?, color = ?
     WHERE id = ?`
  ).run(name, description, color, Number(id));

  return getProject(id);
}

export async function deleteProject(id) {
  const projectId = Number(id);
  const detachedInfo = await db
    .prepare('UPDATE tickets SET project_id = NULL WHERE project_id = ?')
    .run(projectId);

  await db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);

  return detachedInfo.rowsAffected ?? detachedInfo.changes;
}

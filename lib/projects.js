import { db } from './db';

// github_token is deliberately omitted. Callers that need it use
// getProjectGithubAuth, which is server-only.
const PROJECTS_SELECT = `
  SELECT p.id, p.key, p.name, p.description, p.color, p.workspace_id, p.client_id,
    p.github_repo, p.created_at,
    CASE WHEN TRIM(COALESCE(p.github_token, '')) = '' THEN 0 ELSE 1 END AS github_token_set,
    u.name AS client_name,
    u.email AS client_email,
    (SELECT COUNT(*) FROM tickets t WHERE t.project_id = p.id) AS ticket_count,
    (SELECT COUNT(*) FROM tickets t
      WHERE t.project_id = p.id AND t.status IN ('open', 'in_progress')) AS open_count
  FROM projects p
  LEFT JOIN users u ON u.id = p.client_id
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
  return db.prepare(`${PROJECTS_SELECT} WHERE p.key = ?`).get(key);
}

/** Server-only. Includes the raw token; never return this from an API route. */
export async function getProjectGithubAuth(id) {
  return db
    .prepare('SELECT github_repo, github_token FROM projects WHERE id = ?')
    .get(Number(id));
}

export async function projectExists(id) {
  if (!id) return false;
  return Boolean(
    await db.prepare('SELECT 1 AS ok FROM projects WHERE id = ?').get(Number(id))
  );
}

export async function clientExists(id) {
  if (!id) return false;
  return Boolean(
    await db
      .prepare('SELECT 1 AS ok FROM users WHERE id = ? AND role = ?')
      .get(Number(id), 'client')
  );
}

export async function createProject({
  key,
  name,
  description = '',
  color,
  workspace_id = null,
  client_id = null,
  github_repo = '',
  github_token = '',
}) {
  const info = await db
    .prepare(
      `INSERT INTO projects
        (key, name, description, color, workspace_id, client_id, github_repo, github_token)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      key,
      name,
      description,
      color,
      workspace_id,
      client_id,
      github_repo || '',
      github_token || ''
    );

  return getProject(info.lastInsertRowid);
}

export async function updateProject(
  id,
  { name, description, color, workspace_id, client_id, github_repo, github_token }
) {
  await db.prepare(
    `UPDATE projects
     SET name = ?, description = ?, color = ?, workspace_id = ?, client_id = ?,
         github_repo = ?, github_token = ?
     WHERE id = ?`
  ).run(
    name,
    description,
    color,
    workspace_id,
    client_id,
    github_repo == null ? '' : String(github_repo),
    github_token == null ? '' : String(github_token),
    Number(id)
  );

  return getProject(id);
}

export async function deleteProject(id) {
  const projectId = Number(id);
  const detachedInfo = await db
    .prepare('UPDATE tickets SET project_id = NULL WHERE project_id = ?')
    .run(projectId);

  await db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);

  return detachedInfo.rowCount;
}

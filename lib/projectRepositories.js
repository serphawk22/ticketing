import { db } from './db.js';
import { parseOwnerRepo } from './github.js';

/**
 * Normalizes an owner/repo pair or string.
 */
export function normalizeRepoIdentifier(input) {
  if (!input) return null;
  let str = '';
  if (typeof input === 'string') {
    str = input;
  } else if (typeof input === 'object' && input.owner && input.repo) {
    str = `${input.owner}/${input.repo}`;
  } else {
    return null;
  }
  const parsed = parseOwnerRepo(str);
  if (!parsed) return null;
  return {
    owner: parsed.owner.toLowerCase(),
    repo: parsed.repo.toLowerCase(),
    fullName: `${parsed.owner.toLowerCase()}/${parsed.repo.toLowerCase()}`,
  };
}

/**
 * Retrieves all repositories belonging to a project.
 */
export async function getProjectRepositories(projectId, { activeOnly = false } = {}) {
  if (!projectId) return [];

  const query = `
    SELECT pr.*,
      (SELECT COUNT(*) FROM tickets t WHERE t.repository_id = pr.id) AS ticket_count
    FROM project_repositories pr
    WHERE pr.project_id = ?
      ${activeOnly ? 'AND pr.is_active = 1' : ''}
    ORDER BY pr.is_active DESC, pr.github_owner ASC, pr.github_repo ASC
  `;

  return db.prepare(query).all(Number(projectId));
}

/**
 * Retrieves a single repository by its ID.
 */
export async function getRepositoryById(id) {
  if (!id) return null;
  return db
    .prepare(
      `SELECT pr.*,
        (SELECT COUNT(*) FROM tickets t WHERE t.repository_id = pr.id) AS ticket_count
       FROM project_repositories pr
       WHERE pr.id = ?`
    )
    .get(Number(id));
}

/**
 * Finds a repository within a project by owner and repo name (case-insensitive).
 */
export async function findProjectRepository(projectId, owner, repo) {
  if (!projectId || !owner || !repo) return null;
  return db
    .prepare(
      `SELECT * FROM project_repositories
       WHERE project_id = ?
         AND LOWER(github_owner) = LOWER(?)
         AND LOWER(github_repo) = LOWER(?)`
    )
    .get(Number(projectId), String(owner).trim(), String(repo).trim());
}

/**
 * Creates a new project repository.
 */
export async function createProjectRepository({
  projectId,
  owner,
  repo,
  repositoryUrl = null,
  verificationStatus = 'verified',
  createdBy = null,
}) {
  const norm = normalizeRepoIdentifier({ owner, repo });
  if (!norm) {
    const err = new Error('Invalid repository format. Expected "owner/repo".');
    err.code = 'INVALID_FORMAT';
    throw err;
  }

  const existing = await findProjectRepository(projectId, norm.owner, norm.repo);
  if (existing) {
    const err = new Error(`Repository "${norm.fullName}" already exists in this project.`);
    err.code = 'DUPLICATE_REPOSITORY';
    err.repository = existing;
    throw err;
  }

  const url = repositoryUrl || `https://github.com/${norm.fullName}`;

  const info = await db
    .prepare(
      `INSERT INTO project_repositories (
        project_id, github_owner, github_repo, repository_url, is_active, verification_status, created_by
      ) VALUES (?, ?, ?, ?, 1, ?, ?)`
    )
    .run(
      Number(projectId),
      norm.owner,
      norm.repo,
      url,
      verificationStatus || 'verified',
      createdBy ? Number(createdBy) : null
    );

  const inserted = await getRepositoryById(info.lastInsertRowid);

  // Sync projects.github_repo if it is empty or null
  try {
    const project = await db.prepare('SELECT github_repo FROM projects WHERE id = ?').get(Number(projectId));
    if (project && (!project.github_repo || project.github_repo.trim() === '')) {
      await db.prepare('UPDATE projects SET github_repo = ? WHERE id = ?').run(norm.fullName, Number(projectId));
    }
  } catch {
    // Non-critical back-compat sync
  }

  return inserted;
}

/**
 * Updates a project repository's active flag or verification status.
 */
export async function updateProjectRepository(id, { isActive, verificationStatus }) {
  const current = await getRepositoryById(id);
  if (!current) {
    const err = new Error('Repository not found.');
    err.code = 'NOT_FOUND';
    throw err;
  }

  const sets = ["updated_at = datetime('now')"];
  const params = [];

  if (isActive !== undefined) {
    sets.push('is_active = ?');
    params.push(isActive ? 1 : 0);
  }

  if (verificationStatus !== undefined) {
    sets.push('verification_status = ?');
    params.push(String(verificationStatus).trim());
  }

  params.push(Number(id));

  await db.prepare(`UPDATE project_repositories SET ${sets.join(', ')} WHERE id = ?`).run(...params);

  return getRepositoryById(id);
}

/**
 * Deletes a repository only if it is not referenced by any ticket.
 * If tickets reference it, throws REFERENCED_BY_TICKETS so caller can prompt for deactivation instead.
 */
export async function deleteProjectRepository(id) {
  const current = await getRepositoryById(id);
  if (!current) {
    const err = new Error('Repository not found.');
    err.code = 'NOT_FOUND';
    throw err;
  }

  const refCheck = await db
    .prepare('SELECT COUNT(*) AS count FROM tickets WHERE repository_id = ?')
    .get(Number(id));

  const count = Number(refCheck?.count || 0);
  if (count > 0) {
    const err = new Error(
      `Cannot delete repository because it is referenced by ${count} ticket${count === 1 ? '' : 's'}. Deactivate it instead.`
    );
    err.code = 'REFERENCED_BY_TICKETS';
    err.ticketCount = count;
    throw err;
  }

  await db.prepare('DELETE FROM project_repositories WHERE id = ?').run(Number(id));
  return { success: true, deletedId: Number(id) };
}

/**
 * Validates a repository for a ticket under a project.
 */
export async function validateTicketRepository({ projectId, repositoryId }) {
  if (!projectId) {
    return null;
  }

  if (!repositoryId) {
    const err = new Error('Please select a GitHub repository for this ticket.');
    err.code = 'REPOSITORY_REQUIRED';
    throw err;
  }

  const repo = await getRepositoryById(repositoryId);
  if (!repo) {
    const err = new Error('Selected GitHub repository does not exist.');
    err.code = 'REPOSITORY_NOT_FOUND';
    throw err;
  }

  if (Number(repo.project_id) !== Number(projectId)) {
    const err = new Error('Selected repository does not belong to the selected project.');
    err.code = 'REPOSITORY_PROJECT_MISMATCH';
    throw err;
  }

  if (!repo.is_active) {
    const err = new Error('Selected repository is deactivated and cannot accept new tickets.');
    err.code = 'REPOSITORY_INACTIVE';
    throw err;
  }

  return repo;
}

import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getProject } from '@/lib/projects';
import { isAdminOrOwner, resolveUserScope } from '@/lib/rbac';
import {
  getRepositoryById,
  updateProjectRepository,
  deleteProjectRepository,
} from '@/lib/projectRepositories';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

async function canManageProjectRepos(user, projectId) {
  if (isAdminOrOwner(user)) return true;
  const scope = await resolveUserScope(user);
  if (!scope.isManager || !scope.employeeId) return false;
  const row = await db
    .prepare(
      `SELECT id FROM project_members
       WHERE project_id = ? AND employee_id = ? AND is_active = 1 AND project_role IN ('lead', 'manager')`
    )
    .get(Number(projectId), scope.employeeId);
  return Boolean(row);
}

export async function PATCH(request, { params }) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id, repoId } = await params;
  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  }

  const authorized = await canManageProjectRepos(session.user, project.id);
  if (!authorized) {
    return NextResponse.json(
      { error: 'Only admins, owners, or project managers can update repositories.' },
      { status: 403 }
    );
  }

  const repo = await getRepositoryById(repoId);
  if (!repo || Number(repo.project_id) !== Number(project.id)) {
    return NextResponse.json({ error: 'Repository not found in this project.' }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const updates = {};

  if (body.is_active !== undefined) {
    updates.isActive = Boolean(body.is_active);
  }
  if (body.is_default !== undefined) {
    updates.isDefault = Boolean(body.is_default);
  }
  if (body.verification_status !== undefined) {
    updates.verificationStatus = String(body.verification_status);
  }

  const updated = await updateProjectRepository(repo.id, updates);
  return NextResponse.json({ repository: updated });
}

export async function DELETE(request, { params }) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id, repoId } = await params;
  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  }

  const authorized = await canManageProjectRepos(session.user, project.id);
  if (!authorized) {
    return NextResponse.json(
      { error: 'Only admins, owners, or project managers can delete repositories.' },
      { status: 403 }
    );
  }

  const repo = await getRepositoryById(repoId);
  if (!repo || Number(repo.project_id) !== Number(project.id)) {
    return NextResponse.json({ error: 'Repository not found in this project.' }, { status: 404 });
  }

  try {
    await deleteProjectRepository(repo.id);
    return NextResponse.json({ success: true, message: 'Repository deleted successfully.' });
  } catch (err) {
    if (err.code === 'REFERENCED_BY_TICKETS') {
      return NextResponse.json(
        {
          error: err.message,
          code: 'REFERENCED_BY_TICKETS',
          ticketCount: err.ticketCount,
          suggestion: 'Deactivate the repository instead of deleting it to preserve ticket history.',
        },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}

import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getProject, updateProject, deleteProject, clientExists } from '@/lib/projects';
import { parseGithubRepos, parseOwnerRepo } from '@/lib/github';
import { findProjectRepository, createProjectRepository } from '@/lib/projectRepositories';
import { workspaceExists } from '@/lib/workspaces';
import { isValidProjectColor, normalizeProjectTargetDate } from '@/lib/projectValidation';
import { isAdminOrOwner } from '@/lib/rbac';

function normalizeGithubRepo(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const repos = parseGithubRepos(raw);
  if (!repos.length) return null;
  return repos.join(', ');
}

export async function PATCH(request, { params }) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!isAdminOrOwner(session.user)) {
    return NextResponse.json(
      { error: 'Only Business Owners or Administrators can edit projects.' },
      { status: 403 }
    );
  }

  const { id } = await params;
  const existing = await getProject(id);
  if (!existing) {
    return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  }

  const { name, description, color, workspace_id, client_id, github_repo, target_end_date } =
    await request.json();

  if (name !== undefined && !name?.trim()) {
    return NextResponse.json({ error: 'Project name is required.' }, { status: 400 });
  }

  if (color !== undefined && !isValidProjectColor(color)) {
    return NextResponse.json({ error: 'Project color must be a hex value.' }, { status: 400 });
  }

  let nextTargetEndDate = existing.target_end_date ?? null;
  if (target_end_date !== undefined) {
    const targetDateCheck = normalizeProjectTargetDate(target_end_date);
    if (!targetDateCheck.valid) {
      return NextResponse.json(
        { error: 'Target date must be a valid YYYY-MM-DD date.' },
        { status: 400 }
      );
    }
    nextTargetEndDate = targetDateCheck.value;
  }

  if (workspace_id !== undefined && workspace_id !== null
      && !(await workspaceExists(workspace_id))) {
    return NextResponse.json({ error: 'Workspace not found.' }, { status: 400 });
  }

  if (client_id !== undefined && client_id !== null
      && !(await clientExists(client_id))) {
    return NextResponse.json({ error: 'Client not found.' }, { status: 400 });
  }

  let nextGithubRepo =
    existing.github_repo == null ? '' : String(existing.github_repo);
  if (github_repo !== undefined) {
    const normalized = normalizeGithubRepo(github_repo);
    if (normalized === null) {
      return NextResponse.json(
        { error: 'GitHub repo must look like owner/name (comma-separated for several).' },
        { status: 400 }
      );
    }
    nextGithubRepo = normalized;
  }

  const project = await updateProject(id, {
    name: name === undefined ? existing.name : name.trim(),
    description:
      description === undefined ? existing.description : String(description).trim(),
    color: color === undefined ? existing.color : color,
    workspace_id:
      workspace_id === undefined
        ? existing.workspace_id
        : workspace_id === null
          ? null
          : Number(workspace_id),
    client_id:
      client_id === undefined
        ? existing.client_id
        : client_id === null
          ? null
          : Number(client_id),
    github_repo: nextGithubRepo,
    target_end_date: nextTargetEndDate,
  });

  if (github_repo !== undefined && nextGithubRepo) {
    const repos = nextGithubRepo.split(',').map((s) => s.trim()).filter(Boolean);
    for (const repoStr of repos) {
      try {
        const parsed = parseOwnerRepo(repoStr);
        if (parsed) {
          const exists = await findProjectRepository(id, parsed.owner, parsed.repo);
          if (!exists) {
            await createProjectRepository({
              projectId: id,
              owner: parsed.owner,
              repo: parsed.repo,
              isDefault: 0,
              verificationStatus: 'verified',
              createdBy: session.user.id,
            });
          }
        }
      } catch {}
    }
  }

  return NextResponse.json({ project });
}

export async function DELETE(request, { params }) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!isAdminOrOwner(session.user)) {
    return NextResponse.json(
      { error: 'Only Business Owners or Administrators can delete projects.' },
      { status: 403 }
    );
  }

  const { id } = await params;
  const existing = await getProject(id);
  if (!existing) {
    return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  }

  const detached = await deleteProject(id);

  return NextResponse.json({ deleted: true, detachedTickets: detached });
}

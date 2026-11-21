import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getProject } from '@/lib/projects';
import { isAdminOrOwner, assertCanViewProject, resolveUserScope } from '@/lib/rbac';
import { parseOwnerRepo, verifyRepositoryAccess, isGithubConfigured, githubRequest } from '@/lib/github';
import {
  getProjectRepositories,
  findProjectRepository,
  createProjectRepository,
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

export async function GET(request, { params }) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  }

  const access = await assertCanViewProject(session.user, project.id);
  if (!access.allowed) {
    return NextResponse.json({ error: access.error }, { status: access.status || 403 });
  }

  const searchParams = new URL(request.url).searchParams;
  const includeInactive =
    searchParams.get('includeInactive') === '1' ||
    searchParams.get('includeInactive') === 'true' ||
    searchParams.get('all') === '1';

  let repositories = await getProjectRepositories(project.id, {
    activeOnly: !includeInactive,
  });

  // If no repositories are configured in project_repositories yet, but the project
  // has a legacy github_repo string configured, ensure it is added.
  if (repositories.length === 0 && project.github_repo) {
    try {
      const parsed = parseOwnerRepo(project.github_repo);
      if (parsed) {
        await createProjectRepository({
          projectId: project.id,
          owner: parsed.owner,
          repo: parsed.repo,
          verificationStatus: 'verified',
          createdBy: session.user.id,
        }).catch(() => {});
        repositories = await getProjectRepositories(project.id, {
          activeOnly: !includeInactive,
        });
      }
    } catch {
      // ignore
    }
  }

  return NextResponse.json({ repositories });
}

export async function POST(request, { params }) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  }

  const authorized = await canManageProjectRepos(session.user, project.id);
  if (!authorized) {
    return NextResponse.json(
      { error: 'Only admins, owners, or project managers can add repositories.' },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const rawRepo = String(body.repo || body.repository || '').trim();
  if (!rawRepo) {
    return NextResponse.json({ error: 'Repository name is required (e.g. owner/repo).' }, { status: 400 });
  }

  const parsed = parseOwnerRepo(rawRepo);
  if (!parsed) {
    return NextResponse.json(
      { error: 'Invalid repository format. Please enter as "owner/repo" or a valid GitHub repository URL.' },
      { status: 400 }
    );
  }

  const existing = await findProjectRepository(project.id, parsed.owner, parsed.repo);
  if (existing) {
    return NextResponse.json(
      { error: `Repository "${parsed.owner}/${parsed.repo}" is already added to this project.` },
      { status: 409 }
    );
  }

  // Verify access with GitHub API outside DB transaction
  let verificationStatus = 'verified';
  let verifiedRepoData = null;
  const skipVerify = Boolean(body.skip_verify);

  if (!skipVerify) {
    try {
      verifiedRepoData = await verifyRepositoryAccess(parsed.owner, parsed.repo);
    } catch (err) {
      if (err.status === 404 || err.code === 'NOT_FOUND') {
        return NextResponse.json(
          { error: `GitHub repository "${parsed.owner}/${parsed.repo}" was not found or is inaccessible with current credentials.` },
          { status: 400 }
        );
      }
      if (err.status === 401 || err.code === 'BAD_CREDENTIALS') {
        return NextResponse.json(
          { error: 'GitHub authentication failed. Please verify the system GITHUB_TOKEN.' },
          { status: 502 }
        );
      }
      if (err.isTransient || err.code === 'OUTAGE' || err.code === 'NETWORK_ERROR') {
        // GitHub API outage / network issue: allow adding with 'unverified' status if requested or flag it
        verificationStatus = 'unverified';
      } else {
        return NextResponse.json(
          { error: `GitHub verification failed: ${err.message}` },
          { status: 400 }
        );
      }
    }
  }

  const repoUrl = verifiedRepoData?.html_url || `https://github.com/${parsed.owner}/${parsed.repo}`;
  const isDefault = Boolean(body.is_default);

  const created = await createProjectRepository({
    projectId: project.id,
    owner: parsed.owner,
    repo: parsed.repo,
    repositoryUrl: repoUrl,
    isDefault: isDefault ? 1 : 0,
    verificationStatus,
    createdBy: session.user.id,
  });

  return NextResponse.json({ repository: created }, { status: 201 });
}

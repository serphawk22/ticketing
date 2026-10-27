import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getAllProjects, createProject, getProjectByKey, clientExists } from '@/lib/projects';
import { isPlausibleGithubToken, parseGithubRepos } from '@/lib/github';
import { workspaceExists } from '@/lib/workspaces';
import { isValidProjectKey, isValidProjectColor } from '@/lib/projectValidation';

function normalizeGithubRepo(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const repos = parseGithubRepos(raw);
  if (!repos.length) {
    return null;
  }
  return repos.join(', ');
}

export async function GET() {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  return NextResponse.json({ projects: await getAllProjects() });
}

export async function POST(request) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (session.user.role !== 'admin') {
    return NextResponse.json(
      { error: 'Only admins can create projects.' },
      { status: 403 }
    );
  }

  const {
    key,
    name,
    description = '',
    color,
    workspace_id = null,
    client_id = null,
    github_repo = '',
    github_token = '',
  } = await request.json();
  const projectKey = String(key ?? '').trim().toUpperCase();
  const normalizedGithubRepo = normalizeGithubRepo(github_repo);
  if (normalizedGithubRepo === null) {
    return NextResponse.json(
      { error: 'GitHub repo must look like owner/name (comma-separated for several).' },
      { status: 400 }
    );
  }
  const nextGithubToken = String(github_token ?? '').trim();
  if (nextGithubToken && !isPlausibleGithubToken(nextGithubToken)) {
    return NextResponse.json(
      { error: 'GitHub token looks invalid. Paste a personal access token.' },
      { status: 400 }
    );
  }

  if (!isValidProjectKey(projectKey)) {
    return NextResponse.json(
      { error: 'Project key must be 2-6 letters or numbers.' },
      { status: 400 }
    );
  }

  if (!name?.trim()) {
    return NextResponse.json({ error: 'Project name is required.' }, { status: 400 });
  }

  if (!isValidProjectColor(color)) {
    return NextResponse.json({ error: 'Project color must be a hex value.' }, { status: 400 });
  }

  if (await getProjectByKey(projectKey)) {
    return NextResponse.json(
      { error: `Project key ${projectKey} is already in use.` },
      { status: 409 }
    );
  }

  if (workspace_id != null && !(await workspaceExists(workspace_id))) {
    return NextResponse.json(
      { error: 'Workspace not found.' },
      { status: 400 }
    );
  }

  if (client_id != null && !(await clientExists(client_id))) {
    return NextResponse.json(
      { error: 'Client not found.' },
      { status: 400 }
    );
  }

  const project = await createProject({
    key: projectKey,
    name: name.trim(),
    description: String(description ?? '').trim(),
    color,
    workspace_id: workspace_id == null ? null : Number(workspace_id),
    client_id: client_id == null ? null : Number(client_id),
    github_repo: normalizedGithubRepo,
    github_token: nextGithubToken,
  });

  return NextResponse.json({ project }, { status: 201 });
}

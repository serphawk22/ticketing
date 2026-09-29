import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getProject } from '@/lib/projects';
import { getProjectSummary } from '@/lib/projectSummary';

export async function GET(request, { params }) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const rawActivity = searchParams.get('activity');
  const limitParam = rawActivity == null || rawActivity === '' ? NaN : Number(rawActivity);
  const activityLimit = Number.isFinite(limitParam)
    ? Math.min(Math.max(limitParam, 0), 50)
    : 8;

  const assigneeId = searchParams.get('assignee');

  const summary = await getProjectSummary(project.id, { activityLimit, assigneeId });

  return NextResponse.json({ project, ...summary });
}

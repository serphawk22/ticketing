import { NextResponse } from 'next/server';
import { fetchTicketGithubActivity } from '@/lib/github';

/**
 * GET /api/github/activity?ticketKey=TM-594&projectId=1
 *
 * Public on purpose: the task sheet is fillable without login, and the
 * activity panel sits on that same form. Only data GitHub returns for the
 * configured token/repos is exposed.
 */
export async function GET(request) {
  const url = new URL(request.url);
  const ticketKey = (url.searchParams.get('ticketKey') || '').trim();
  const projectIdParam = url.searchParams.get('projectId');
  const projectId = projectIdParam ? Number(projectIdParam) : null;

  if (!ticketKey) {
    return NextResponse.json(
      { error: 'ticketKey is required (e.g. TM-594).' },
      { status: 400 }
    );
  }

  try {
    const activity = await fetchTicketGithubActivity(ticketKey, {
      projectId:
        projectId != null && Number.isInteger(projectId) ? projectId : null,
    });
    return NextResponse.json(activity);
  } catch (err) {
    const status =
      err.code === 'bad_key'
        ? 400
        : err.code === 'github_auth'
          ? 502
          : 500;
    return NextResponse.json(
      { error: err.message || 'Failed to load GitHub activity.' },
      { status }
    );
  }
}

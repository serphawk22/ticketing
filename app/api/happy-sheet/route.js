import { NextResponse } from 'next/server';
import { getSession, requireAuth } from '@/lib/auth';
import {
  createHappySubmission,
  listHappyFacets,
  listHappySubmissions,
} from '@/lib/happySheet';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  const session = await getSession();

  const body = await request.json().catch(() => ({}));
  const submittedBy = session ? session.user.id : null;
  const name = String(body.name ?? '').trim();
  const happyOne = String(body.happyOne ?? '').trim();
  const happyOthers = String(body.happyOthers ?? '').trim();

  if (!name) return NextResponse.json({ error: 'Please select your name.' }, { status: 400 });
  if (!happyOne) {
    return NextResponse.json(
      { error: 'Please tell us what made your day happy.' },
      { status: 400 }
    );
  }

  const submission = await createHappySubmission({
    submittedBy,
    name,
    happyOne,
    happyOthers,
  });

  return NextResponse.json({ submission }, { status: 201 });
}

/** Admin-only, matching the task sheet's history. */
export async function GET(request) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (session.user.role !== 'admin') {
    return NextResponse.json(
      { error: 'Only admins can read the happy sheet history.' },
      { status: 403 }
    );
  }

  const params = new URL(request.url).searchParams;
  const submissions = await listHappySubmissions({
    name: params.get('name') || '',
    month: params.get('month') || '',
    from: params.get('from') || '',
    to: params.get('to') || '',
    limit: Number(params.get('limit')) || 500,
  });
  const facets = await listHappyFacets();

  return NextResponse.json({ submissions, ...facets });
}
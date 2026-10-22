import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import {
  getReportSchedules,
  createReportSchedule,
  deleteReportSchedule,
  toggleReportSchedule,
  runDueReportSchedules,
} from '@/lib/reportScheduler';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await requireAuth();
  if (!session || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const schedules = await getReportSchedules();
  return NextResponse.json({ schedules });
}

export async function POST(request) {
  const session = await requireAuth();
  if (!session || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const { action, id, name, reportSlug, sectionSlug, frequency, recipients, filterConfig, format } = body;

  if (action === 'run_now') {
    if (!id) return NextResponse.json({ error: 'Schedule ID required' }, { status: 400 });
    const results = await runDueReportSchedules({ forceRunId: id });
    return NextResponse.json({ success: true, results });
  }

  if (action === 'toggle') {
    if (!id) return NextResponse.json({ error: 'Schedule ID required' }, { status: 400 });
    await toggleReportSchedule(id, Boolean(body.isActive), session.user.id);
    return NextResponse.json({ success: true });
  }

  if (!name || !reportSlug || !recipients) {
    return NextResponse.json(
      { error: 'Name, report slug, and recipient emails are required' },
      { status: 400 }
    );
  }

  const created = await createReportSchedule({
    name,
    reportSlug,
    sectionSlug: sectionSlug || 'general',
    frequency: frequency || 'weekly',
    recipients,
    filterConfig,
    format: format || 'summary',
    userId: session.user.id,
  });

  return NextResponse.json({ success: true, schedule: created }, { status: 201 });
}

export async function DELETE(request) {
  const session = await requireAuth();
  if (!session || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing schedule ID' }, { status: 400 });

  const ok = await deleteReportSchedule(Number(id), session.user.id);
  if (!ok) return NextResponse.json({ error: 'Schedule not found' }, { status: 404 });

  return NextResponse.json({ success: true });
}


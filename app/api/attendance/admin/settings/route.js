import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getAttendanceSettings, updateAttendanceSettings } from '@/lib/attendance';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await requireAuth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const settings = await getAttendanceSettings();
  return NextResponse.json(settings);
}

export async function POST(request) {
  const session = await requireAuth();
  if (!session || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized: Admin access required.' }, { status: 403 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const updated = await updateAttendanceSettings({
      settings: body,
      adminUserId: session.user.id,
    });

    return NextResponse.json({ ok: true, settings: updated });
  } catch (err) {
    return NextResponse.json({ error: err.message || 'Failed to update settings.' }, { status: 400 });
  }
}


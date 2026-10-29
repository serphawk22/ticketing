import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getLeavePolicySettings, updateLeavePolicySettings } from '@/lib/attendance';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const session = await requireAuth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get('workspaceId');
    const settings = await getLeavePolicySettings(workspaceId ? Number(workspaceId) : null);
    return NextResponse.json({ ok: true, settings });
  } catch (err) {
    return NextResponse.json(
      { error: err.message || 'Failed to fetch leave policy settings.' },
      { status: 400 }
    );
  }
}

export async function POST(request) {
  const session = await requireAuth();
  if (!session || session.user.role !== 'admin') {
    return NextResponse.json(
      { error: 'Forbidden: Only authorized administrators can update leave policy settings.' },
      { status: 403 }
    );
  }

  try {
    const body = await request.json().catch(() => ({}));
    const {
      workspaceId = null,
      fiscalYearStartMonth = 4,
      optionalLeaveEnabled = false,
      optionalLeaveDays = 0,
      optionalLeaveRules = '',
      newJoinerProrataMethod = 'none',
    } = body;

    const updated = await updateLeavePolicySettings({
      workspaceId: workspaceId ? Number(workspaceId) : null,
      fiscalYearStartMonth: Number(fiscalYearStartMonth),
      optionalLeaveEnabled: Boolean(optionalLeaveEnabled),
      optionalLeaveDays: Number(optionalLeaveDays),
      optionalLeaveRules: String(optionalLeaveRules),
      newJoinerProrataMethod: String(newJoinerProrataMethod),
      adminUser: session.user,
    });

    return NextResponse.json({ ok: true, settings: updated });
  } catch (err) {
    return NextResponse.json(
      { error: err.message || 'Failed to update leave policy settings.' },
      { status: 400 }
    );
  }
}


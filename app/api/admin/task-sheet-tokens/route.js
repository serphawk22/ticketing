import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { isAdminOrOwner } from '@/lib/rbac';
import { issueTaskSheetToken, listTaskSheetTokens } from '@/lib/taskSheetTokens';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isAdminOrOwner(session.user)) {
    return NextResponse.json(
      { error: 'Forbidden: Only Business Owners or Administrators can manage Task Sheet tokens.' },
      { status: 403 }
    );
  }

  const tokens = await listTaskSheetTokens();
  return NextResponse.json({ tokens });
}

export async function POST(request) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isAdminOrOwner(session.user)) {
    return NextResponse.json(
      { error: 'Forbidden: Only Business Owners or Administrators can issue Task Sheet tokens.' },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => ({}));
  try {
    const issued = await issueTaskSheetToken({
      employeeId: body.employee_id ?? body.employeeId,
      expiresInDays: body.expires_in_days ?? body.expiresInDays ?? 30,
      revokeExisting: Boolean(body.revoke_existing ?? body.revokeExisting),
      issuedBy: session.user,
    });
    const sharePath = `/api/task-sheet/exchange-token?token=${encodeURIComponent(issued.rawToken)}`;
    return NextResponse.json(
      {
        ok: true,
        token: issued.tokenRecord,
        employee: issued.employee,
        sharePath,
      },
      { status: 201 }
    );
  } catch (err) {
    return NextResponse.json({ error: err.message || 'Failed to issue token.' }, { status: 400 });
  }
}

import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { isAdminOrOwner } from '@/lib/rbac';
import { mapLegacyAnonymousSubmission } from '@/lib/workLedger';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isAdminOrOwner(session.user)) {
    return NextResponse.json(
      { error: 'Forbidden: Only Business Owners or Administrators can map legacy Task Sheet submissions.' },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => ({}));
  try {
    const workLog = await mapLegacyAnonymousSubmission({
      submissionId: body.submission_id ?? body.submissionId,
      employeeId: body.employee_id ?? body.employeeId,
      reason: body.reason || '',
      categoryCode: body.category_code ?? body.categoryCode ?? 'development',
      actor: session.user,
    });
    return NextResponse.json({ ok: true, workLog }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err.message || 'Mapping failed.' }, { status: 400 });
  }
}

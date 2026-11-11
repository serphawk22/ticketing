import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { isAdminOrOwner } from '@/lib/rbac';
import { listUnmappedLegacySubmissions } from '@/lib/workLedger';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isAdminOrOwner(session.user)) {
    return NextResponse.json(
      { error: 'Forbidden: Only Business Owners or Administrators can inspect unmapped Task Sheet records.' },
      { status: 403 }
    );
  }

  const submissions = await listUnmappedLegacySubmissions();
  return NextResponse.json({ submissions, count: submissions.length });
}

import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { isAdminOrOwner } from '@/lib/rbac';
import { revokeTaskSheetToken } from '@/lib/taskSheetTokens';

export const dynamic = 'force-dynamic';

export async function POST(request, { params }) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isAdminOrOwner(session.user)) {
    return NextResponse.json(
      { error: 'Forbidden: Only Business Owners or Administrators can revoke Task Sheet tokens.' },
      { status: 403 }
    );
  }

  const { id } = await params;
  try {
    const res = await revokeTaskSheetToken({ tokenId: id, actor: session.user });
    return NextResponse.json(res);
  } catch (err) {
    return NextResponse.json({ error: err.message || 'Failed to revoke token.' }, { status: 400 });
  }
}

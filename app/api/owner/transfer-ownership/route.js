import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { isOwner } from '@/lib/rbac';
import { transferOwnership } from '@/lib/ownerGovernance';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  const session = await requireAuth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!isOwner(session.user)) {
    return NextResponse.json(
      { error: 'Forbidden: Only an active Business Owner can transfer ownership.' },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const targetUserId = body.targetUserId ?? body.target_user_id;
  const demoteActorToAdmin = body.demoteActorToAdmin !== undefined ? Boolean(body.demoteActorToAdmin) : true;
  const reason = body.reason || '';

  try {
    const result = await transferOwnership({
      actor: session.user,
      targetUserId,
      demoteActorToAdmin,
      reason,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json({ error: err.message || 'Ownership transfer failed.' }, { status: 400 });
  }
}

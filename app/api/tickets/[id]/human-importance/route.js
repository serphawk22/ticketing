import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { getTicket } from '@/lib/tickets';
import { logActivity } from '@/lib/ticketActivity';
import {
  normalizeImportanceLevel,
  logHumanImportanceChange,
  getHumanImportanceHistory,
} from '@/lib/ticketAiImportance';

export const dynamic = 'force-dynamic';

export async function PATCH(request, { params }) {
  const session = await requireAuth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Only admin and developer can change human importance
  const canEdit = session.user.role === 'admin' || session.user.role === 'developer';
  if (!canEdit) {
    return NextResponse.json(
      { error: 'Only admins and developers can update human importance.' },
      { status: 403 }
    );
  }

  const { id } = await params;
  const ticketId = Number(id);
  const ticket = await getTicket(ticketId);
  if (!ticket) {
    return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 });
  }

  const body = await request.json();
  const rawImportance = body.human_importance;
  const rawReason = body.reason;

  const cleanImportance = normalizeImportanceLevel(rawImportance);
  if (!cleanImportance) {
    return NextResponse.json(
      { error: 'Invalid human importance. Allowed values: Critical, High, Medium, Low.' },
      { status: 400 }
    );
  }

  const cleanReason = String(rawReason || '').trim();
  if (!cleanReason) {
    return NextResponse.json(
      { error: 'A mandatory reason is required to change human importance.' },
      { status: 400 }
    );
  }

  const oldImportance = ticket.human_importance || null;

  // Update ticket
  await db
    .prepare(
      `UPDATE tickets
       SET human_importance = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
    .run(cleanImportance, ticketId);

  // Record audit history with reason
  await logHumanImportanceChange({
    ticketId,
    oldValue: oldImportance,
    newValue: cleanImportance,
    reason: cleanReason,
    userId: session.user.id,
    userName: session.user.name || 'Authorized User',
  });

  // Record in ticket activity timeline
  await logActivity(
    ticketId,
    session.user.id,
    'human_importance',
    oldImportance ? oldImportance.charAt(0).toUpperCase() + oldImportance.slice(1) : 'None',
    cleanImportance.charAt(0).toUpperCase() + cleanImportance.slice(1)
  );

  const updatedTicket = await getTicket(ticketId);
  const history = await getHumanImportanceHistory(ticketId);

  return NextResponse.json({
    ok: true,
    ticket: updatedTicket,
    history,
  });
}


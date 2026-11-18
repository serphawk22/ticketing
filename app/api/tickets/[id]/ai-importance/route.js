import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getTicket } from '@/lib/tickets';
import {
  analyzeTicketAiImportance,
  getAiImportanceHistory,
  checkAiImportanceIsStale,
} from '@/lib/ticketAiImportance';

export const dynamic = 'force-dynamic';

export async function GET(request, { params }) {
  const session = await requireAuth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const ticketId = Number(id);
  const ticket = await getTicket(ticketId);
  if (!ticket) {
    return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 });
  }

  const history = await getAiImportanceHistory(ticketId, 10);
  const isStale = await checkAiImportanceIsStale(ticket);

  return NextResponse.json({
    ticket,
    history,
    isStale,
  });
}

export async function POST(request, { params }) {
  const session = await requireAuth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Only admin and developer can trigger re-analysis
  const canAnalyze = session.user.role === 'admin' || session.user.role === 'developer';
  if (!canAnalyze) {
    return NextResponse.json(
      { error: 'Only admins and developers can trigger AI re-analysis.' },
      { status: 403 }
    );
  }

  const { id } = await params;
  const ticketId = Number(id);
  const ticket = await getTicket(ticketId);
  if (!ticket) {
    return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 });
  }

  try {
    const aiResult = await analyzeTicketAiImportance({ ticketId, force: true });
    const updatedTicket = await getTicket(ticketId);
    const history = await getAiImportanceHistory(ticketId, 10);
    const isStale = await checkAiImportanceIsStale(updatedTicket);

    return NextResponse.json({
      ok: true,
      ticket: updatedTicket,
      aiResult,
      history,
      isStale,
    });
  } catch (err) {
    console.error(`AI re-analysis route error for ticket #${ticketId}:`, err);
    return NextResponse.json(
      { error: err.message || 'AI re-analysis failed.' },
      { status: 500 }
    );
  }
}


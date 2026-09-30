import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { getTicket } from '@/lib/tickets';
import { getWebLinks } from '@/lib/ticketDetail';

export const dynamic = 'force-dynamic';

// Only http(s). A "javascript:" URL rendered as an anchor is a script
// execution vector, and these links are shown to everyone who opens the ticket.
function safeUrl(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  try {
    const parsed = new URL(text);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? text : null;
  } catch {
    return null;
  }
}

export async function GET(request, { params }) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const ticketId = Number(id);
  if (!await getTicket(ticketId)) {
    return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 });
  }

  return NextResponse.json({ webLinks: await getWebLinks(ticketId) });
}

export async function POST(request, { params }) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const ticketId = Number(id);
  if (!await getTicket(ticketId)) {
    return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 });
  }

  const body = await request.json();
  const url = safeUrl(body.url);
  if (!url) {
    return NextResponse.json(
      { error: 'Enter a valid http or https URL.' },
      { status: 400 }
    );
  }

  // Falls back to the host so a link added with a bare URL still reads as
  // something in the list rather than an empty row.
  const label = String(body.label || '').trim() || new URL(url).hostname;

  const info = await db
    .prepare('INSERT INTO ticket_web_links (ticket_id, url, label) VALUES (?, ?, ?)')
    .run(ticketId, url, label);

  return NextResponse.json(
    { webLinks: await getWebLinks(ticketId), createdId: info.lastInsertRowid },
    { status: 201 }
  );
}

export async function DELETE(request, { params }) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const ticketId = Number(id);
  const linkId = Number(new URL(request.url).searchParams.get('link'));
  if (!Number.isInteger(linkId)) {
    return NextResponse.json({ error: 'Invalid link.' }, { status: 400 });
  }

  const result = await db
    .prepare('DELETE FROM ticket_web_links WHERE id = ? AND ticket_id = ?')
    .run(linkId, ticketId);

  if (!result.rowCount) {
    return NextResponse.json({ error: 'Link not found.' }, { status: 404 });
  }

  return NextResponse.json({ webLinks: await getWebLinks(ticketId) });
}

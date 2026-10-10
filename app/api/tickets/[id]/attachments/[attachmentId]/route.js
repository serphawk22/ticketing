import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { getTicket } from '@/lib/tickets';
import { attachmentOpenUrl, readAttachment, usesRemoteStorage } from '@/lib/storage';

export const dynamic = 'force-dynamic';

export async function GET(_request, { params }) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id, attachmentId } = await params;
  const ticketId = Number(id);
  const fileId = Number(attachmentId);
  if (!await getTicket(ticketId)) {
    return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 });
  }

  const attachment = await db
    .prepare('SELECT * FROM ticket_attachments WHERE id = ? AND ticket_id = ?')
    .get(fileId, ticketId);
  if (!attachment) {
    return NextResponse.json({ error: 'Attachment not found.' }, { status: 404 });
  }

  if (usesRemoteStorage()) {
    const url = await attachmentOpenUrl(attachment);
    return NextResponse.redirect(url);
  }

  let body;
  try {
    body = await readAttachment(attachment.storage_key);
  } catch {
    return NextResponse.json({ error: 'Attachment file is missing.' }, { status: 404 });
  }

  const filename = String(attachment.filename || 'file').replace(/[\r\n"]/g, '') || 'file';
  return new NextResponse(body, {
    headers: {
      'Content-Type': attachment.content_type || 'application/octet-stream',
      'Content-Length': String(body.length),
      'Content-Disposition': `inline; filename="${filename}"`,
      'Cache-Control': 'private, max-age=300',
    },
  });
}

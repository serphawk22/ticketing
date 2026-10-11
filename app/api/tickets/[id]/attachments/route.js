import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { getTicket } from '@/lib/tickets';
import { getAttachments } from '@/lib/ticketDetail';
import {
  attachmentKey,
  attachmentOpenUrl,
  deleteAttachment,
  putAttachment,
  storageAvailable,
} from '@/lib/storage';

export const dynamic = 'force-dynamic';

const MAX_BYTES = 10 * 1024 * 1024;

export async function GET(request, { params }) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const ticketId = Number(id);
  if (!await getTicket(ticketId)) {
    return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 });
  }

  // ?attachment=<id> returns a short-lived link for one file; otherwise the
  // whole list. The bucket is private, so the browser never sees the bytes
  // directly and the storage key is never exposed.
  const wanted = new URL(request.url).searchParams.get('attachment');
  if (wanted) {
    const attachment = await db
      .prepare('SELECT * FROM ticket_attachments WHERE id = ? AND ticket_id = ?')
      .get(Number(wanted), ticketId);
    if (!attachment) {
      return NextResponse.json({ error: 'Attachment not found.' }, { status: 404 });
    }
    try {
      const url = await attachmentOpenUrl(attachment);
      return NextResponse.json({ url, filename: attachment.filename });
    } catch (err) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
  }

  return NextResponse.json({ attachments: await getAttachments(ticketId) });
}

export async function POST(request, { params }) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const ticketId = Number(id);
  if (!await getTicket(ticketId)) {
    return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 });
  }

  if (!storageAvailable()) {
    return NextResponse.json(
      { error: 'Attachment storage is not configured. Run `neon env pull`.' },
      { status: 503 }
    );
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!file || typeof file === 'string') {
    return NextResponse.json({ error: 'No file supplied.' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: 'Attachments are limited to 10 MB.' },
      { status: 400 }
    );
  }

  const key = attachmentKey(ticketId, file.name);
  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    await putAttachment(key, buffer, file.type);
  } catch (err) {
    return NextResponse.json(
      { error: `Upload failed: ${err.message}` },
      { status: 502 }
    );
  }

  await db
    .prepare(
      `INSERT INTO ticket_attachments
         (ticket_id, filename, storage_key, content_type, size_bytes, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(ticketId, file.name, key, file.type || '', file.size, session.user.id);

  return NextResponse.json({ attachments: await getAttachments(ticketId) }, { status: 201 });
}

export async function DELETE(request, { params }) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const ticketId = Number(id);
  const attachmentId = Number(new URL(request.url).searchParams.get('attachment'));
  if (!Number.isInteger(attachmentId)) {
    return NextResponse.json({ error: 'Invalid attachment.' }, { status: 400 });
  }

  const attachment = await db
    .prepare('SELECT * FROM ticket_attachments WHERE id = ? AND ticket_id = ?')
    .get(attachmentId, ticketId);
  if (!attachment) {
    return NextResponse.json({ error: 'Attachment not found.' }, { status: 404 });
  }

  if (attachment.uploaded_by !== session.user.id && session.user.role !== 'admin') {
    return NextResponse.json(
      { error: 'You can only remove your own attachments.' },
      { status: 403 }
    );
  }

  await db.prepare('DELETE FROM ticket_attachments WHERE id = ?').run(attachmentId);
  await deleteAttachment(attachment.storage_key).catch(() => {});

  return NextResponse.json({ attachments: await getAttachments(ticketId) });
}

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { getProjectByKey, createProject } from '@/lib/projects';
import { getAllWorkspaces } from '@/lib/workspaces';
import { getTicket } from '@/lib/tickets';
import { ticketKey } from '@/lib/ticketMeta';
import { logCreated } from '@/lib/ticketActivity';
import { notifyTicketCreated } from '@/lib/notifications';
import { attachmentKey, putAttachment, storageAvailable } from '@/lib/storage';
import { sanitizeAndReencodeImage } from '@/lib/fileSignature';

export const dynamic = 'force-dynamic';

const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024; // 5 MB
const DUPLICATE_WINDOW_SECONDS = 60;

const VALID_PRIORITIES = ['low', 'medium', 'high', 'urgent'];

async function getOrCreateBugProject() {
  let project = await getProjectByKey('BUG');
  if (project) return project;

  // Find or default the workspace
  const workspaces = await getAllWorkspaces();
  let workspace = workspaces.find((w) => w.key === 'GEN') || workspaces[0];

  let workspaceId = workspace ? workspace.id : null;
  if (!workspaceId) {
    const wsInsert = await db
      .prepare(
        'INSERT INTO workspaces (key, name, description, color) VALUES (?, ?, ?, ?)'
      )
      .run('GEN', 'General', 'Default team workspace', '#0c66e4');
    workspaceId = wsInsert.lastInsertRowid;
  }

  project = await createProject({
    key: 'BUG',
    name: 'Bug Reports',
    description: 'Internal bug reports, feedback, and user-reported issues',
    color: '#e5493a',
    workspace_id: workspaceId,
    client_id: null, // Strictly internal, not accessible to client accounts
  });

  return project;
}

export async function POST(request) {
  const session = await requireAuth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Bug reports are team-internal. Client portal handles client requests.
  if (session.user.role === 'client') {
    return NextResponse.json(
      { error: 'Forbidden: Client accounts file requests through the Client Portal.' },
      { status: 403 }
    );
  }

  let title = '';
  let description = '';
  let affectedUrl = '';
  let priority = 'medium';
  let reportType = 'bug';
  let screenshotFile = null;

  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('multipart/form-data')) {
    let formData;
    try {
      formData = await request.formData();
    } catch (err) {
      return NextResponse.json(
        { error: `Could not parse form data: ${err.message}` },
        { status: 400 }
      );
    }

    title = String(formData.get('title') || '').trim();
    description = String(formData.get('description') || '').trim();
    affectedUrl = String(formData.get('affected_url') || '').trim();
    priority = String(formData.get('priority') || 'medium').trim().toLowerCase();
    reportType = String(formData.get('type') || 'bug').trim().toLowerCase();

    const file = formData.get('screenshot');
    if (file && typeof file !== 'string' && file.size > 0) {
      screenshotFile = file;
    }
  } else {
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 });
    }
    title = String(body.title || '').trim();
    description = String(body.description || '').trim();
    affectedUrl = String(body.affected_url || '').trim();
    priority = String(body.priority || 'medium').trim().toLowerCase();
    reportType = String(body.type || 'bug').trim().toLowerCase();
  }

  if (!title) {
    return NextResponse.json({ error: 'A summary or title is required.' }, { status: 400 });
  }

  if (!description) {
    return NextResponse.json({ error: 'Please describe the bug or feedback in detail.' }, { status: 400 });
  }

  if (!VALID_PRIORITIES.includes(priority)) {
    priority = 'medium';
  }

  const bugProject = await getOrCreateBugProject();

  // Validate screenshot upfront BEFORE ticket creation so malformed files fail safely
  let processedScreenshot = null;
  if (screenshotFile) {
    if (screenshotFile.size > MAX_SCREENSHOT_BYTES) {
      return NextResponse.json(
        { error: 'Screenshot is too large. Maximum allowed size is 5 MB.' },
        { status: 400 }
      );
    }

    try {
      const buffer = Buffer.from(await screenshotFile.arrayBuffer());
      processedScreenshot = await sanitizeAndReencodeImage(buffer);
    } catch (err) {
      return NextResponse.json(
        { error: `Screenshot rejected: ${err.message}` },
        { status: 400 }
      );
    }
  }

  // Duplicate Prevention: Check identical submissions from this user within last 60 seconds
  const cutoff = new Date(Date.now() - DUPLICATE_WINDOW_SECONDS * 1000)
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ');

  const recentReports = await db
    .prepare(
      `SELECT t.*, p.key AS project_key
       FROM tickets t
       LEFT JOIN projects p ON p.id = t.project_id
       WHERE t.project_id = ? AND t.created_by = ? AND t.created_at >= ?
       ORDER BY t.id DESC`
    )
    .all(bugProject.id, session.user.id, cutoff);

  const exactDuplicate = recentReports.find((t) => {
    const sameTitle = t.title.trim().toLowerCase() === title.toLowerCase();
    const sameDesc = (t.description || '').includes(description);
    return sameTitle && sameDesc;
  });

  if (exactDuplicate) {
    const key = ticketKey(exactDuplicate);
    return NextResponse.json({
      ok: true,
      duplicate: true,
      ticket: {
        id: exactDuplicate.id,
        key,
        title: exactDuplicate.title,
      },
      message: `This report was already submitted recently and is tracked as ${key}.`,
    });
  }

  // Format the structured ticket description
  const userAgent = request.headers.get('user-agent') || 'Unknown browser';
  const formattedDescription = `### ${reportType === 'feedback' ? 'Feedback / Suggestion' : 'Bug Description'}
${description}

---
**Affected Page**: ${affectedUrl || 'Not specified'}  
**Reporter**: ${session.user.name} (${session.user.email}) [${session.user.role}]  
**Environment**: ${userAgent}  
**Submitted At**: ${new Date().toUTCString()}
`;

  const ticketType = reportType === 'feedback' ? 'story' : 'bug';

  const insertStmt = db.prepare(`
    INSERT INTO tickets (
      title, description, status, priority, type,
      created_by, project_id, labels, category
    ) VALUES (?, ?, 'open', ?, ?, ?, ?, 'bug-report', 'Bug Report')
  `);

  const info = await insertStmt.run(
    title,
    formattedDescription,
    priority,
    ticketType,
    session.user.id,
    bugProject.id
  );

  const ticket = await getTicket(info.lastInsertRowid);
  const key = ticketKey(ticket);

  // Log activity & trigger notifications
  try {
    await logCreated(ticket.id, session.user.id);
    await notifyTicketCreated({
      ticket,
      actorId: session.user.id,
      actorName: session.user.name,
    });
  } catch (err) {
    console.error('Feedback ticket created, but activity/notifications failed:', err);
  }

  // Attach screenshot if provided
  let attachmentError = null;
  if (processedScreenshot) {
    try {
      const filename = `screenshot-${Date.now()}${processedScreenshot.extension}`;
      const storageKey = attachmentKey(ticket.id, filename);

      await putAttachment(storageKey, processedScreenshot.buffer, processedScreenshot.contentType);

      await db
        .prepare(`
          INSERT INTO ticket_attachments (
            ticket_id, filename, storage_key, content_type, size_bytes, uploaded_by
          ) VALUES (?, ?, ?, ?, ?, ?)
        `)
        .run(
          ticket.id,
          filename,
          storageKey,
          processedScreenshot.contentType,
          processedScreenshot.buffer.length,
          session.user.id
        );
    } catch (err) {
      console.error('Failed to store screenshot attachment:', err);
      attachmentError = 'The bug report was recorded, but the screenshot could not be saved.';
    }
  }

  return NextResponse.json(
    {
      ok: true,
      duplicate: false,
      ticket: {
        id: ticket.id,
        key,
        title: ticket.title,
      },
      attachmentWarning: attachmentError,
      message: `Bug report created successfully as ${key}.`,
    },
    { status: 201 }
  );
}


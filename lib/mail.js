import nodemailer from 'nodemailer';
import { db } from './db';
import { PRIORITY_META, STATUS_META } from './ticketMeta';

const SMTP_HOST = process.env.SMTP_HOST || process.env.SMTP_SERVER;
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE = process.env.SMTP_SECURE === 'true';
const SMTP_USER = process.env.SMTP_USER || process.env.OUTLOOK_EMAIL;
const SMTP_PASS = process.env.SMTP_PASS || process.env.OUTLOOK_PASSWORD;
const SMTP_FROM =
  process.env.SMTP_FROM ||
  (process.env.SENDER_EMAIL ? `Ticket Manager <${process.env.SENDER_EMAIL}>` : null) ||
  'Ticket Manager <no-reply@ticket-manager.local>';
const APP_URL = process.env.APP_URL || 'http://localhost:3000';

export function isSmtpConfigured() {
  return Boolean(SMTP_HOST);
}

let transporter = null;

function getTransporter() {
  if (!isSmtpConfigured()) return null;
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    requireTLS: !SMTP_SECURE,
    auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
  });

  return transporter;
}

async function record({ to, toName, subject, text, html, trigger, ticketId, status, error }) {
  const info = await db
    .prepare(
      `INSERT INTO email_outbox
         (to_email, to_name, subject, body_text, body_html, trigger, ticket_id, status, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(to, toName || '', subject, text, html || '', trigger, ticketId || null, status, error || null);

  return db.prepare('SELECT * FROM email_outbox WHERE id = ?').get(info.lastInsertRowid);
}

export async function getOutbox({ limit = 50 } = {}) {
  return db
    .prepare('SELECT * FROM email_outbox ORDER BY id DESC LIMIT ?')
    .all(Number(limit) || 50);
}

function priorityLabel(priority) {
  return PRIORITY_META[priority]?.label || priority;
}

function statusLabel(status) {
  return STATUS_META[status]?.label || status;
}

function buildAssignmentEmail({ ticket, employee, actorName }) {
  const key = `TM-${ticket.id}`;
  const project = ticket.project_name ? `Project: ${ticket.project_name}` : 'No project';

  const subject = `[Ticket Manager] ${key} assigned to you: ${ticket.title}`;

  const text = [
    `Hi ${employee.name},`,
    '',
    `${actorName} assigned you a ticket.`,
    '',
    `${key}: ${ticket.title}`,
    `Priority: ${priorityLabel(ticket.priority)}`,
    `Status: ${statusLabel(ticket.status)}`,
    project,
    '',
    'Description:',
    ticket.description || 'No description provided.',
    '',
    `Open the board: ${APP_URL}/?project=${ticket.project_id || 'all'}`,
  ].join('\n');

  const html = `<p>Hi ${employee.name},</p>
<p>${actorName} assigned you a ticket.</p>
<p><strong>${key}: ${ticket.title}</strong></p>
<ul>
  <li>Priority: ${priorityLabel(ticket.priority)}</li>
  <li>Status: ${statusLabel(ticket.status)}</li>
  <li>${project}</li>
</ul>
<p>${(ticket.description || 'No description provided.').replace(/\n/g, '<br>')}</p>
<p><a href="${APP_URL}/?project=${ticket.project_id || 'all'}">Open the board</a></p>`;

  return { subject, text, html };
}

function buildStatusEmail({ ticket, employee, actorName, status }) {
  const key = `TM-${ticket.id}`;
  const label = statusLabel(status);

  const subject = `[Ticket Manager] ${key} moved to ${label}: ${ticket.title}`;

  const text = [
    `Hi ${employee.name},`,
    '',
    `${actorName} moved ${key} to ${label}.`,
    '',
    `${key}: ${ticket.title}`,
    `Priority: ${priorityLabel(ticket.priority)}`,
    `Status: ${label}`,
    '',
    'Description:',
    ticket.description || 'No description provided.',
    '',
    `Open the board: ${APP_URL}/?project=${ticket.project_id || 'all'}`,
  ].join('\n');

  const html = `<p>Hi ${employee.name},</p>
<p>${actorName} moved <strong>${key}</strong> to ${label}.</p>
<p><strong>${key}: ${ticket.title}</strong></p>
<ul>
  <li>Priority: ${priorityLabel(ticket.priority)}</li>
  <li>Status: ${label}</li>
</ul>
<p><a href="${APP_URL}/?project=${ticket.project_id || 'all'}">Open the board</a></p>`;

  return { subject, text, html };
}

export async function notifyAssignment({ ticket, employee, actorName, trigger = 'assignment' }) {
  if (!employee) return null;

  const { subject, text, html } = buildAssignmentEmail({ ticket, employee, actorName });

  if (!isSmtpConfigured()) {
    console.log(`[mail:outbox] ${subject} -> ${employee.email}`);
    return await record({
      to: employee.email,
      toName: employee.name,
      subject,
      text,
      html,
      trigger,
      ticketId: ticket.id,
      status: 'logged',
    });
  }

  try {
    const info = await getTransporter().sendMail({
      from: SMTP_FROM,
      to: employee.email,
      subject,
      text,
      html,
    });
    return await record({
      to: employee.email,
      toName: employee.name,
      subject,
      text,
      html,
      trigger,
      ticketId: ticket.id,
      status: 'sent',
      error: info?.message || null,
    });
  } catch (error) {
    return await record({
      to: employee.email,
      toName: employee.name,
      subject,
      text,
      html,
      trigger,
      ticketId: ticket.id,
      status: 'failed',
      error: error.message,
    });
  }
}

export async function notifyStatusChange({ ticket, employee, actorName, status }) {
  if (!employee) return null;

  const { subject, text, html } = buildStatusEmail({ ticket, employee, actorName, status });

  if (!isSmtpConfigured()) {
    console.log(`[mail:outbox] ${subject} -> ${employee.email}`);
    return await record({
      to: employee.email,
      toName: employee.name,
      subject,
      text,
      html,
      trigger: 'status',
      ticketId: ticket.id,
      status: 'logged',
    });
  }

  try {
    const info = await getTransporter().sendMail({
      from: SMTP_FROM,
      to: employee.email,
      subject,
      text,
      html,
    });
    return await record({
      to: employee.email,
      toName: employee.name,
      subject,
      text,
      html,
      trigger: 'status',
      ticketId: ticket.id,
      status: 'sent',
      error: info?.message || null,
    });
  } catch (error) {
    return await record({
      to: employee.email,
      toName: employee.name,
      subject,
      text,
      html,
      trigger: 'status',
      ticketId: ticket.id,
      status: 'failed',
      error: error.message,
    });
  }
}

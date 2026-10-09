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

// Employee names and titles are typed by an admin and end up inside HTML mail,
// so anything interpolated into a template is escaped rather than trusted.
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

/**
 * The invite sent when an admin adds someone to the directory.
 *
 * It carries the temporary password the account was created with. That is
 * deliberate: the alternative is an account nobody can sign in to, because the
 * plaintext is only ever known at creation time and is not stored anywhere.
 * The password is therefore labelled as temporary and the account is flagged
 * so the app forces a change before anything else is reachable.
 */
function buildInviteEmail({ employee, tempPassword, actorName }) {
  const name = escapeHtml(employee.name);
  // Clients sign in at their own door and get a portal rather than the team
  // board, so both the wording and the link follow the role.
  const isClient = employee.role === 'client';
  const role = isClient ? 'Client' : employee.role === 'admin' ? 'Admin' : 'Developer';
  const loginUrl = `${APP_URL}${isClient ? '/client/login' : '/login'}`;
  const whatYouCanDo = isClient
    ? 'You will be able to raise a request and follow its progress from your own portal.'
    : "You can now sign in and see the team's work items.";

  const subject = isClient
    ? `[Ticket Manager] ${employee.name}, your client account is ready`
    : `[Ticket Manager] ${employee.name}, you have been added to the team`;

  const text = [
    `Hi ${employee.name},`,
    '',
    `${actorName} added you to Ticket Manager as a ${role.toLowerCase()}.`,
    isClient ? 'From your portal you can raise a request and follow its progress.' : '',
    '',
    'Your temporary password',
    '-------------------',
    tempPassword,
    '',
    'Sign in with this password and you will be asked to set a new one before',
    'you can use Ticket Manager. Please do that straight away: this temporary',
    'password was emailed in plain text, so it should not stay in use.',
    '',
    `Sign in: ${loginUrl}`,
    '',
    'Email: ' + employee.email,
    employee.department ? 'Department: ' + employee.department : null,
    employee.title ? 'Job title: ' + employee.title : null,
  ]
    .filter((line) => line !== null)
    .join('\n');

  const details = [
    `<li>Email: ${escapeHtml(employee.email)}</li>`,
    employee.department ? `<li>Department: ${escapeHtml(employee.department)}</li>` : null,
    employee.title ? `<li>Job title: ${escapeHtml(employee.title)}</li>` : null,
  ].filter(Boolean);

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#172b4d">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
      <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #dfe1e6;border-radius:8px">
        <tr><td style="padding:20px 24px;border-bottom:1px solid #dfe1e6">
          <span style="display:inline-block;width:24px;height:24px;line-height:24px;text-align:center;border-radius:4px;background:#0c66e4;color:#ffffff;font-weight:700;font-size:13px">T</span>
          <span style="margin-left:8px;font-size:16px;font-weight:600;vertical-align:middle">Ticket Manager</span>
        </td></tr>
        <tr><td style="padding:24px">
          <p style="margin:0 0 12px">Hi ${name},</p>
          <p style="margin:0 0 16px">${escapeHtml(actorName)} added you to Ticket Manager as a <strong>${role.toLowerCase()}</strong>. ${whatYouCanDo}</p>
          <div style="margin:0 0 16px;padding:16px;background:#f4f5f7;border-radius:6px">
            <p style="margin:0 0 8px;font-size:12px;color:#626f86;text-transform:uppercase;letter-spacing:.04em">Your temporary password</p>
            <p style="margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:18px;letter-spacing:.04em"><strong>${escapeHtml(tempPassword)}</strong></p>
          </div>
          <p style="margin:0 0 16px;font-size:13px;color:#626f86">You will be asked to set a new password the first time you sign in. Please change it immediately &mdash; this one was sent in plain text and should not stay in use.</p>
          <p style="margin:0 0 20px"><a href="${loginUrl}" style="display:inline-block;padding:10px 18px;background:#0c66e4;color:#ffffff;text-decoration:none;border-radius:4px;font-weight:600">${isClient ? 'Sign in to your client portal' : 'Sign in to Ticket Manager'}</a></p>
          <ul style="margin:0;padding-left:20px;font-size:13px;color:#626f86">${details.join('')}</ul>
        </td></tr>
        <tr><td style="padding:16px 24px;border-top:1px solid #dfe1e6;font-size:12px;color:#8590a2">
          If you were not expecting this, you can ignore it &mdash; the account stays inactive until you sign in.
        </td></tr>
      </table>
    </td></tr></table>
  </body>
</html>`;

  return { subject, text, html };
}

/**
 * Sends the invite and records it in the outbox, exactly like the assignment
 * and status notifications so admins have one place to look.
 *
 * Returns the outbox row. `status` is the honest outcome: 'sent' when SMTP
 * accepted it, 'logged' when no SMTP host is configured (nothing left the
 * machine) and 'failed' when the server rejected it. Callers treat anything
 * other than 'sent' as an invite the employee did not receive.
 */
// Shown to the admin when a send fails, whatever the transport reported.
export const INVITE_SEND_ERROR =
  'The invite email could not be sent. The employee was still added, so use "Resend invite" once mail is working.';

export async function sendEmployeeInvite({ employee, tempPassword, actorName, trigger = 'invite' }) {
  if (!employee || !tempPassword) return null;

  const { subject, text, html } = buildInviteEmail({ employee, tempPassword, actorName });

  // The temporary password is a live credential. It goes to the recipient in the
  // real message, but the copy kept in email_outbox has it replaced: the outbox is
  // a server-side log that admins can read and that gets backed up, and a stored
  // password there would outlive the one forced reset it is meant to survive.
  const REDACTED = '[shown only in the email sent to the recipient]';
  const redact = (value) => value.split(tempPassword).join(REDACTED);
  const outbox = { text: redact(text), html: redact(html) };

  if (!isSmtpConfigured()) {
    console.warn(
      `[mail:invite] SMTP is not configured, invite for ${employee.email} was recorded but not sent`
    );
    return await record({
      to: employee.email,
      toName: employee.name,
      subject,
      text: outbox.text,
      html: outbox.html,
      trigger,
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
      text: outbox.text,
      html: outbox.html,
      trigger,
      status: 'sent',
      error: info?.message || null,
    });
  } catch (error) {
    // The employee record is already saved by the time this runs, so the admin
    // has to be told the account exists but the mail did not go out.
    console.error(`[mail:invite] failed to send invite to ${employee.email}:`, error);
    const stored = await record({
      to: employee.email,
      toName: employee.name,
      subject,
      text: outbox.text,
      html: outbox.html,
      trigger,
      status: 'failed',
      error: error.message,
    });
    // The admin gets an actionable sentence; the transport detail stays in the
    // server log rather than being shown in the UI.
    return { ...stored, error: INVITE_SEND_ERROR };
  }
}

/**
 * The password reset email sent by the "Forgot password" flow on the sign-in
 * screen. Like the invite, it carries the fresh temporary password: resetting
 * to a password the app has to email is the only way an unauthenticated user
 * can ever recover the account, since plaintext passwords are never stored.
 */
function buildPasswordResetEmail({ employee, tempPassword }) {
  const name = escapeHtml(employee.name);
  const isClient = employee.role === 'client';
  const loginUrl = `${APP_URL}${isClient ? '/client/login' : '/login'}`;

  const subject = `[Ticket Manager] Your password has been reset`;

  const text = [
    `Hi ${employee.name},`,
    '',
    'We received a request to reset your Ticket Manager password.',
    '',
    'Your new temporary password',
    '--------------------------',
    tempPassword,
    '',
    'Sign in with this password and you will be asked to set a new one before',
    'you can use Ticket Manager.',
    '',
    'If you did not ask for this reset, contact your administrator straight',
    'away: the previous password for this account has stopped working.',
    '',
    `Sign in: ${loginUrl}`,
    '',
    'Email: ' + employee.email,
  ].join('\n');

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#172b4d">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
      <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #dfe1e6;border-radius:8px">
        <tr><td style="padding:20px 24px;border-bottom:1px solid #dfe1e6">
          <span style="display:inline-block;width:24px;height:24px;line-height:24px;text-align:center;border-radius:4px;background:#0c66e4;color:#ffffff;font-weight:700;font-size:13px">T</span>
          <span style="margin-left:8px;font-size:16px;font-weight:600;vertical-align:middle">Ticket Manager</span>
        </td></tr>
        <tr><td style="padding:24px">
          <p style="margin:0 0 12px">Hi ${name},</p>
          <p style="margin:0 0 16px">We received a request to reset your Ticket Manager password. Here is a fresh temporary password.</p>
          <div style="margin:0 0 16px;padding:16px;background:#f4f5f7;border-radius:6px">
            <p style="margin:0 0 8px;font-size:12px;color:#626f86;text-transform:uppercase;letter-spacing:.04em">Your temporary password</p>
            <p style="margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:18px;letter-spacing:.04em"><strong>${escapeHtml(tempPassword)}</strong></p>
          </div>
          <p style="margin:0 0 16px;font-size:13px;color:#626f86">You will be asked to set a new password the first time you sign in.</p>
          <p style="margin:0 0 20px"><a href="${loginUrl}" style="display:inline-block;padding:10px 18px;background:#0c66e4;color:#ffffff;text-decoration:none;border-radius:4px;font-weight:600">${isClient ? 'Sign in to your client portal' : 'Sign in to Ticket Manager'}</a></p>
        </td></tr>
        <tr><td style="padding:16px 24px;border-top:1px solid #dfe1e6;font-size:12px;color:#8590a2">
          If you did not ask for this, contact your administrator immediately &mdash; the previous password has stopped working.
        </td></tr>
      </table>
    </td></tr></table>
  </body>
</html>`;

  return { subject, text, html };
}

/**
 * Sends the reset email and records it in the outbox like every other
 * notification. Returns the outbox row, with the password redacted from the
 * copy that gets stored, exactly like the invite.
 */
export async function sendPasswordReset({ employee, tempPassword, trigger = 'forgot-password' }) {
  if (!employee || !tempPassword) return null;

  const { subject, text, html } = buildPasswordResetEmail({ employee, tempPassword });

  const REDACTED = '[shown only in the email sent to the recipient]';
  const redact = (value) => value.split(tempPassword).join(REDACTED);
  const outbox = { text: redact(text), html: redact(html) };

  if (!isSmtpConfigured()) {
    console.warn(
      `[mail:reset] SMTP is not configured, reset email for ${employee.email} was recorded but not sent`
    );
    return await record({
      to: employee.email,
      toName: employee.name,
      subject,
      text: outbox.text,
      html: outbox.html,
      trigger,
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
      text: outbox.text,
      html: outbox.html,
      trigger,
      status: 'sent',
      error: info?.message || null,
    });
  } catch (error) {
    console.error(`[mail:reset] failed to send reset email to ${employee.email}:`, error);
    return await record({
      to: employee.email,
      toName: employee.name,
      subject,
      text: outbox.text,
      html: outbox.html,
      trigger,
      status: 'failed',
      error: error.message,
    });
  }
}

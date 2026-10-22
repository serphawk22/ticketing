import nodemailer from 'nodemailer';
import { db } from './db.js';
import { PRIORITY_META, STATUS_META, ticketKey } from './ticketMeta.js';

const SMTP_HOST = process.env.SMTP_HOST || process.env.SMTP_SERVER;
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE = process.env.SMTP_SECURE === 'true';
const SMTP_USER = process.env.SMTP_USER || process.env.OUTLOOK_EMAIL;
const SMTP_PASS = process.env.SMTP_PASS || process.env.OUTLOOK_PASSWORD;
const SMTP_FROM =
  process.env.SMTP_FROM ||
  (process.env.SENDER_EMAIL ? `Ticket Manager <${process.env.SENDER_EMAIL}>` : null) ||
  'Ticket Manager <no-reply@ticket-manager.local>';
// The public origin used in every link we email (View Ticket, the invite
// button). A localhost value -- or none -- would hand recipients a link they
// cannot open, so a real, non-localhost APP_URL always wins; when the app is
// hosted on Vercel, fall back to the deployment's own production domain; and
// only then fall back to localhost for local development.
function resolveAppUrl() {
  const configured = String(process.env.APP_URL || '').trim().replace(/\/+$/, '');
  const isLocal =
    !configured ||
    /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(configured);
  if (!isLocal) return configured;

  const vercelHost =
    process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (vercelHost) return `https://${String(vercelHost).trim().replace(/\/+$/, '')}`;

  return configured || 'http://localhost:3000';
}

const APP_URL = resolveAppUrl();

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

// Point at the gateway route rather than straight at the board. The gateway
// only resolves the key to a ticket once a session exists, so a recipient who
// is not signed in is sent to the login screen and returned to the same ticket
// afterwards. That keeps the link from depending on whoever happens to hold the
// browser session when it is opened.
function ticketViewUrl(ticket) {
  return `${APP_URL}/t/${encodeURIComponent(ticketKey(ticket))}`;
}

function buildAssignmentEmail({ ticket, employee, actorName }) {
  const key = ticketKey(ticket);
  const projectName = ticket.project_name || 'No project';
  const viewUrl = ticketViewUrl(ticket);

  const subject = `[Ticket Manager] ${key} assigned to you: ${ticket.title}`;

  const text = [
    `Hello ${employee.name},`,
    '',
    `${actorName} assigned you a ticket in Ticket Manager.`,
    '',
    'A TICKET HAS BEEN ASSIGNED TO YOU',
    '',
    `Ticket ID:    ${key}`,
    `Title:        ${ticket.title}`,
    `Priority:     ${priorityLabel(ticket.priority)}`,
    `Status:       ${statusLabel(ticket.status)}`,
    `Project:      ${projectName}`,
    `Assigned by:  ${actorName}`,
    `Assigned to:  ${employee.name}`,
    '',
    'Description:',
    ticket.description || 'No description provided.',
    '',
    `View ticket: ${viewUrl}`,
    '',
    'This is an automated notification from Ticket Manager. Please do not reply to this email.',
  ].join('\n');

  const details = [
    ['Ticket ID', key],
    ['Title', ticket.title],
    ['Priority', priorityLabel(ticket.priority)],
    ['Status', statusLabel(ticket.status)],
    ['Project', projectName],
    ['Assigned by', actorName],
    ['Assigned to', employee.name],
  ]
    .map(
      ([label, value]) => `<tr>
      <td style="width:35%;padding:10px 16px;border-bottom:1px solid #ebecf0;font-size:12px;color:#626f86;text-transform:uppercase;letter-spacing:.04em;vertical-align:top">${escapeHtml(label)}</td>
      <td style="width:65%;padding:10px 16px;border-bottom:1px solid #ebecf0;font-size:14px;color:#172b4d">${escapeHtml(value)}</td>
    </tr>`
    )
    .join('');

  const description = (ticket.description || 'No description provided.')
    .split(/\r?\n/)
    .map(escapeHtml)
    .join('<br>');

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#172b4d">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7"><tr><td align="center" style="padding:24px 12px">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#ffffff;border:1px solid #dfe1e6;border-radius:8px">
        <tr>
          <td style="padding:20px 24px;border-bottom:1px solid #dfe1e6;background:#ffffff">
            <span style="display:inline-block;width:24px;height:24px;line-height:24px;text-align:center;border-radius:4px;background:#0c66e4;color:#ffffff;font-weight:700;font-size:13px">T</span>
            <span style="margin-left:8px;font-size:16px;font-weight:600;vertical-align:middle;color:#1b2a4a">Ticket Manager</span>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 24px 24px">
            <h1 style="margin:0 0 20px;font-size:20px;line-height:1.3;color:#1b2a4a">A Ticket Has Been Assigned to You</h1>
            <p style="margin:0 0 6px">Hello ${escapeHtml(employee.name)},</p>
            <p style="margin:0 0 24px">${escapeHtml(actorName)} assigned you a ticket and it is now ready for your attention. You can review the details below and open it directly from Ticket Manager.</p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;border:1px solid #dfe1e6;border-collapse:collapse">${details}</table>
            <p style="margin:0 0 4px;font-size:12px;color:#626f86;text-transform:uppercase;letter-spacing:.04em">Description</p>
            <p style="margin:0 0 24px;font-size:14px;color:#44546f;line-height:1.5">${description}</p>
            <p style="margin:0 0 4px"><a href="${escapeHtml(viewUrl)}" style="display:inline-block;padding:12px 24px;background:#0c66e4;color:#ffffff;text-decoration:none;border-radius:5px;font-weight:600">View Ticket</a></p>
          </td>
        </tr>
        <tr>
          <td style="padding:16px 24px;border-top:1px solid #dfe1e6;font-size:12px;color:#8590a2;background:#f7f8fa">
            This is an automated notification from Ticket Manager. You are receiving it because a work item was assigned to you. Please do not reply to this email.
          </td>
        </tr>
      </table>
    </td></tr></table>
  </body>
</html>`;

  return { subject, text, html };
}

function buildStatusEmail({ ticket, employee, actorName, status }) {
  const key = ticketKey(ticket);
  const label = statusLabel(status);
  const viewUrl = ticketViewUrl(ticket);

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
    `View ticket: ${viewUrl}`,
  ].join('\n');

  const html = `<p>Hi ${escapeHtml(employee.name)},</p>
<p>${escapeHtml(actorName)} moved <strong>${key}</strong> to ${escapeHtml(label)}.</p>
<p><strong>${key}: ${escapeHtml(ticket.title)}</strong></p>
<ul>
  <li>Priority: ${escapeHtml(priorityLabel(ticket.priority))}</li>
  <li>Status: ${escapeHtml(label)}</li>
</ul>
<p><a href="${escapeHtml(viewUrl)}" style="display:inline-block;padding:10px 18px;background:#0c66e4;color:#ffffff;text-decoration:none;border-radius:5px;font-weight:600">View Ticket</a></p>`;

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
 * The email that carries a client's passkey.
 *
 * A client has one passkey, not a password plus a reset screen, so this mail
 * is the whole onboarding: no temporary password, no forced change. The code
 * is the one thing the recipient has to get right, so it sits in its own box
 * in monospace and the portal link that accepts it is a single step away.
 */
function buildClientPasskeyEmail({ client, passkey, actorName }) {
  const name = escapeHtml(client.name);
  const loginUrl = `${APP_URL}/client/login`;

  const subject = `[Ticket Manager] ${client.name}, your client portal passkey`;

  const text = [
    `Hi ${client.name},`,
    '',
    `${actorName} created your client account on Ticket Manager.`,
    'Sign in to your portal with this one passkey -- no email, no password:',
    '',
    'Your passkey',
    '-------------',
    passkey,
    '',
    `Sign in: ${loginUrl}`,
    '',
    'Keep it to yourself: anyone with this passkey can read your requests',
    'and raise new ones as you. The passkey is tied to your account only, so',
    'if it ever leaks, ask an administrator to issue you a new one.',
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
          <p style="margin:0 0 16px">${escapeHtml(actorName)} created your client account on Ticket Manager. Sign in to your portal with this one passkey &mdash; no email, no password:</p>
          <div style="margin:0 0 16px;padding:16px;background:#f4f5f7;border-radius:6px;text-align:center">
            <p style="margin:0 0 8px;font-size:12px;color:#626f86;text-transform:uppercase;letter-spacing:.04em">Your passkey</p>
            <p style="margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:24px;letter-spacing:.08em"><strong>${escapeHtml(passkey)}</strong></p>
          </div>
          <p style="margin:0 0 20px"><a href="${loginUrl}" style="display:inline-block;padding:10px 18px;background:#0c66e4;color:#ffffff;text-decoration:none;border-radius:4px;font-weight:600">Sign in to your client portal</a></p>
          <p style="margin:0 0 16px;font-size:13px;color:#626f86">Keep it to yourself: anyone with this passkey can read your requests and raise new ones as you. It belongs to your account alone, so if it ever leaks, ask an administrator to issue you a new one.</p>
        </td></tr>
        <tr><td style="padding:16px 24px;border-top:1px solid #dfe1e6;font-size:12px;color:#8590a2">
          If you were not expecting this, you can ignore it &mdash; the account stays unused until you sign in.
        </td></tr>
      </table>
    </td></tr></table>
  </body>
</html>`;

  return { subject, text, html };
}

// Shown to the admin when a passkey cannot be delivered, whatever the
// transport reported. The account and passkey itself still exist.
export const PASSKEY_SEND_ERROR =
  'The passkey email could not be sent. The client account was still created, so use "Resend passkey" once mail is working.';

/**
 * Sends a client their passkey and records it in the outbox like every other
 * notification. Same status contract as the invite: 'sent' when SMTP accepted
 * it, 'logged' when no SMTP host is configured, 'failed' when the server
 * rejected it. The passkey is a live credential, so the outbox copy has it
 * redacted -- a stored passkey that outlived the account it opens would be a
 * leak waiting to happen.
 */
export async function sendClientPasskey({
  client,
  passkey,
  actorName,
  trigger = 'client-passkey',
}) {
  if (!client || !client.email || !passkey) return null;

  const { subject, text, html } = buildClientPasskeyEmail({ client, passkey, actorName });

  const REDACTED = '[shown only in the email sent to the recipient]';
  const redact = (value) => value.split(passkey).join(REDACTED);
  const outbox = { text: redact(text), html: redact(html) };

  if (!isSmtpConfigured()) {
    console.warn(
      `[mail:passkey] SMTP is not configured, passkey for ${client.email} was recorded but not sent`
    );
    return await record({
      to: client.email,
      toName: client.name,
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
      to: client.email,
      subject,
      text,
      html,
    });
    return await record({
      to: client.email,
      toName: client.name,
      subject,
      text: outbox.text,
      html: outbox.html,
      trigger,
      status: 'sent',
      error: info?.message || null,
    });
  } catch (error) {
    console.error(`[mail:passkey] failed to send passkey to ${client.email}:`, error);
    const stored = await record({
      to: client.email,
      toName: client.name,
      subject,
      text: outbox.text,
      html: outbox.html,
      trigger,
      status: 'failed',
      error: error.message,
    });
    return { ...stored, error: PASSKEY_SEND_ERROR };
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

export async function sendReportEmail({ to, toName = '', subject, text, html, trigger = 'scheduled_report' }) {
  if (!to) return null;
  if (!isSmtpConfigured()) {
    console.log(`[mail:outbox:report] ${subject} -> ${to}`);
    return await record({
      to,
      toName,
      subject,
      text,
      html,
      trigger,
      status: 'logged',
    });
  }

  try {
    const info = await getTransporter().sendMail({
      from: SMTP_FROM,
      to,
      subject,
      text,
      html,
    });
    return await record({
      to,
      toName,
      subject,
      text,
      html,
      trigger,
      status: 'sent',
      error: info?.message || null,
    });
  } catch (error) {
    console.error(`[mail:report] failed to send report email to ${to}:`, error);
    return await record({
      to,
      toName,
      subject,
      text,
      html,
      trigger,
      status: 'failed',
      error: error.message,
    });
  }
}


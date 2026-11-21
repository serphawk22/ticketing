import { db } from './db.js';
import { sendReportEmail, isSmtpConfigured } from './mail.js';
import { putAttachment, readAttachment } from './storage.js';
import { generateCompanyWorkbookBuffer, generateEmployeeWorkbookBuffer } from './weeklyExcelGenerator.js';
import { generateWeeklyAiReportInsights, generateEmployeeAiObservations } from './weeklyAiReporting.js';
import { recordReportFile } from './weeklyReportService.js';
import { isAdminOrOwner, isManager } from './rbac.js';

const IN_FLIGHT_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes before in_flight is considered stale/uncertain
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validates whether an email string is well-formed.
 */
export function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  return EMAIL_REGEX.test(email.trim());
}

/**
 * Resolves management and employee recipients for a report run.
 * Implements strict privacy rules and handles shared email addresses safely.
 *
 * @param {{
 *   user: object,
 *   includeEmployees?: boolean,
 *   allowedProjectIds?: Set<number>|null,
 *   allowedEmployeeIds?: Set<number>|null,
 * }} options
 */
export async function resolveReportRecipients({
  user,
  includeEmployees = false,
  allowedProjectIds = null,
  allowedEmployeeIds = null,
} = {}) {
  const managementRecipients = [];
  const employeeRecipients = [];

  // 1. Resolve Management Recipients (Owner & Admin accounts)
  const mgmtUsers = await db
    .prepare(
      `SELECT id, name, email, role
       FROM users
       WHERE role IN ('owner', 'admin')
       ORDER BY id ASC`
    )
    .all();

  for (const u of mgmtUsers) {
    const rawEmail = (u.email || '').trim().toLowerCase();
    const valid = isValidEmail(rawEmail);
    managementRecipients.push({
      recipientType: 'management',
      userId: Number(u.id),
      employeeId: null,
      email: rawEmail,
      name: u.name || 'Management',
      isValid: valid,
      skipReason: valid ? null : 'Missing or invalid management email address',
    });
  }

  // 2. Resolve Employee Recipients (if requested)
  if (includeEmployees) {
    const employees = await db
      .prepare(
        `SELECT id, name, email, secondary_email, role, department, title, active, user_id
         FROM employees
         WHERE active = 1
         ORDER BY id ASC`
      )
      .all();

    // Map emails to count how many distinct employees share the same primary email
    const emailToEmployees = new Map();
    for (const emp of employees) {
      const empId = Number(emp.id);
      if (allowedEmployeeIds !== null && !allowedEmployeeIds.has(empId)) {
        continue;
      }
      const primaryEmail = (emp.email || '').trim().toLowerCase();
      if (isValidEmail(primaryEmail)) {
        if (!emailToEmployees.has(primaryEmail)) {
          emailToEmployees.set(primaryEmail, []);
        }
        emailToEmployees.get(primaryEmail).push(empId);
      }
    }

    for (const emp of employees) {
      const empId = Number(emp.id);
      if (allowedEmployeeIds !== null && !allowedEmployeeIds.has(empId)) {
        continue; // Exclude out-of-scope employees for scoped manager runs
      }

      const primaryEmail = (emp.email || '').trim().toLowerCase();
      let valid = isValidEmail(primaryEmail);
      let skipReason = valid ? null : 'Missing or invalid employee email address';

      // Enforce critical shared-email privacy: if multiple distinct employees share this email, withhold private delivery
      const sharedWith = emailToEmployees.get(primaryEmail) || [];
      if (valid && sharedWith.length > 1) {
        valid = false;
        skipReason = `Shared employee email address detected across ${sharedWith.length} employees; private delivery withheld to prevent unauthorized disclosure`;
      }

      employeeRecipients.push({
        recipientType: 'employee',
        userId: emp.user_id ? Number(emp.user_id) : null,
        employeeId: empId,
        email: primaryEmail,
        name: emp.name || 'Team Member',
        isValid: valid,
        skipReason,
      });
    }
  }

  return {
    managementRecipients,
    employeeRecipients,
  };
}

/**
 * Reconciles stale in-flight delivery records (> 15 mins) that were interrupted
 * by serverless timeouts or process restarts, marking them as 'uncertain'.
 */
export async function reconcileStaleInFlightDeliveries(runId) {
  const staleThreshold = new Date(Date.now() - IN_FLIGHT_TIMEOUT_MS).toISOString();

  await db
    .prepare(
      `UPDATE weekly_report_deliveries
       SET delivery_status = 'uncertain',
           error_message = 'Delivery timed out in-flight; manual reconciliation required'
       WHERE run_id = ?
         AND delivery_status = 'in_flight'
         AND (last_attempt_at IS NULL OR last_attempt_at < ?)`
    )
    .run(runId, staleThreshold);
}

/**
 * Atomically creates delivery records for a report run before dispatching.
 */
export async function initializeDeliveryRecords(runId, recipients, fileMapByRecipientType) {
  const createdRecords = [];

  for (const r of recipients) {
    const fileId = r.recipientType === 'management'
      ? fileMapByRecipientType.managementFileId
      : (fileMapByRecipientType.employeeFileMap?.get(r.employeeId) || null);

    const initialStatus = r.isValid ? 'pending' : 'skipped';
    const errorMsg = r.skipReason || null;

    try {
      const res = await db
        .prepare(
          `INSERT INTO weekly_report_deliveries
            (run_id, file_id, recipient_type, recipient_email, recipient_name_snapshot, user_id, employee_id, delivery_status, error_message)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          runId,
          fileId,
          r.recipientType,
          r.email,
          r.name,
          r.userId,
          r.employeeId,
          initialStatus,
          errorMsg
        );

      const record = await db
        .prepare('SELECT * FROM weekly_report_deliveries WHERE id = ?')
        .get(res.lastInsertRowid);
      createdRecords.push(record);
    } catch (err) {
      console.warn(`[weeklyEmailService] Could not insert delivery record for ${r.email}:`, err.message);
    }
  }

  return createdRecords;
}

/**
 * Atomically claims a delivery record for transmission (sets status = 'in_flight').
 * Prevents concurrent workers from double-sending the same email.
 */
export async function claimDeliveryRecord(deliveryId) {
  const res = await db
    .prepare(
      `UPDATE weekly_report_deliveries
       SET delivery_status = 'in_flight',
           last_attempt_at = datetime('now'),
           attempt_count = attempt_count + 1
       WHERE id = ? AND delivery_status IN ('pending', 'failed')`
    )
    .run(deliveryId);

  return res.rowCount > 0;
}

/**
 * Updates a delivery record after transmission attempt.
 */
export async function updateDeliveryResult(deliveryId, {
  status,
  smtpMessageId = null,
  errorMessage = null,
}) {
  const sets = [
    'delivery_status = ?',
    'smtp_message_id = ?',
    'error_message = ?',
  ];
  const params = [status, smtpMessageId, errorMessage];

  if (status === 'accepted' || status === 'logged_local') {
    sets.push("sent_at = datetime('now')");
  }

  params.push(deliveryId);
  await db
    .prepare(`UPDATE weekly_report_deliveries SET ${sets.join(', ')} WHERE id = ?`)
    .run(...params);
}

/**
 * Transmits an individual email delivery item with its appropriate pre-generated workbook attachment.
 */
export async function transmitDeliveryItem(delivery, fileRecord, fileBuffer, period) {
  const isMgmt = delivery.recipient_type === 'management';
  const periodLabel = period?.startIstLabel && period?.endIstLabel
    ? `${period.startIstLabel} – ${period.endIstLabel}`
    : 'Weekly Cycle';

  const subject = isMgmt
    ? `Weekly Company-Wide AI Ticket Report [${periodLabel}]`
    : `Your Weekly Performance & Work Report [${periodLabel}]`;

  const html = isMgmt
    ? `
      <div style="font-family: Arial, sans-serif; max-width: 600px; color: #091e42; line-height: 1.5;">
        <h2 style="color: #0c66e4;">Weekly Company-Wide AI Ticket Report</h2>
        <p>Hello ${delivery.recipient_name_snapshot || 'Management'},</p>
        <p>The company-wide ticket performance and executive AI reporting workbook for <strong>${periodLabel}</strong> is attached.</p>
        <p>This report contains seven comprehensive sections covering executive metrics, project delivery progress, employee summaries, blockers, overdue items, AI insights, and the weekly activity ledger.</p>
        <p style="font-size: 12px; color: #6b778c; margin-top: 24px;">Generated by SerpHawk Ticketing System on ${new Date().toISOString().slice(0, 10)}.</p>
      </div>
    `
    : `
      <div style="font-family: Arial, sans-serif; max-width: 600px; color: #091e42; line-height: 1.5;">
        <h2 style="color: #0c66e4;">Your Weekly Performance & Work Report</h2>
        <p>Hello ${delivery.recipient_name_snapshot || 'Team Member'},</p>
        <p>Your individual weekly ticket and performance workbook for <strong>${periodLabel}</strong> is attached.</p>
        <p>This private report covers your assigned work items, deliverables completed during the cycle, upcoming deadlines, active blockers, and personal AI workload observations.</p>
        <p style="font-size: 12px; color: #6b778c; margin-top: 24px;">Generated by SerpHawk Ticketing System on ${new Date().toISOString().slice(0, 10)}.</p>
      </div>
    `;

  const text = isMgmt
    ? `Weekly Company-Wide AI Ticket Report for ${periodLabel}. Please find the Excel workbook attached.`
    : `Your Weekly Performance & Work Report for ${periodLabel}. Please find your individual Excel workbook attached.`;

  const attachments = fileBuffer
    ? [
        {
          filename: fileRecord?.filename || (isMgmt ? 'Company_Weekly_Report.xlsx' : 'Employee_Weekly_Report.xlsx'),
          content: fileBuffer,
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
      ]
    : [];

  // Transmit through existing lib/mail.js
  const result = await sendReportEmail({
    to: delivery.recipient_email,
    toName: delivery.recipient_name_snapshot,
    subject,
    text,
    html,
    attachments,
    trigger: isMgmt ? 'company_weekly_report' : 'employee_weekly_report',
  });

  return result;
}

/**
 * Retries failed deliveries for a report run.
 * Only targets records with status 'failed'. Never retries 'accepted', 'logged_local', or 'uncertain'.
 *
 * @param {number} runId
 * @returns {Promise<{ retriedCount: number, acceptedCount: number, failedCount: number }>}
 */
export async function retryFailedDeliveries(runId) {
  // Reconcile any stale in-flight records first
  await reconcileStaleInFlightDeliveries(runId);

  const run = await db.prepare('SELECT * FROM weekly_report_runs WHERE id = ?').get(runId);
  if (!run) {
    throw new Error(`Report run ${runId} not found.`);
  }

  const failedDeliveries = await db
    .prepare(
      `SELECT d.*, f.filename, f.storage_key
       FROM weekly_report_deliveries d
       LEFT JOIN weekly_report_files f ON f.id = d.file_id
       WHERE d.run_id = ? AND d.delivery_status = 'failed'`
    )
    .all(runId);

  if (failedDeliveries.length === 0) {
    return { retriedCount: 0, acceptedCount: 0, failedCount: 0 };
  }

  let acceptedCount = 0;
  let failedCount = 0;

  for (const delivery of failedDeliveries) {
    const claimed = await claimDeliveryRecord(delivery.id);
    if (!claimed) continue;

    let fileBuffer = null;
    if (delivery.storage_key) {
      try {
        fileBuffer = await readAttachment(delivery.storage_key);
      } catch (readErr) {
        console.warn(`[weeklyEmailService] Could not read attachment for retry (${delivery.storage_key}):`, readErr.message);
      }
    }

    try {
      const period = {
        startIstLabel: run.period_start,
        endIstLabel: run.period_end,
      };

      const mailResult = await transmitDeliveryItem(
        delivery,
        { filename: delivery.filename },
        fileBuffer,
        period
      );

      if (mailResult?.status === 'sent') {
        await updateDeliveryResult(delivery.id, {
          status: 'accepted',
          smtpMessageId: mailResult.messageId || 'accepted',
        });
        acceptedCount += 1;
      } else if (mailResult?.status === 'logged') {
        await updateDeliveryResult(delivery.id, {
          status: 'logged_local',
        });
        acceptedCount += 1;
      } else {
        await updateDeliveryResult(delivery.id, {
          status: 'failed',
          errorMessage: mailResult?.error || 'SMTP delivery rejected',
        });
        failedCount += 1;
      }
    } catch (err) {
      await updateDeliveryResult(delivery.id, {
        status: 'uncertain',
        errorMessage: `Retry connection error: ${err.message}`,
      });
      failedCount += 1;
    }
  }

  // Update retry count on run
  await db
    .prepare("UPDATE weekly_report_runs SET retry_count = retry_count + 1, updated_at = datetime('now') WHERE id = ?")
    .run(runId);

  return {
    retriedCount: failedDeliveries.length,
    acceptedCount,
    failedCount,
  };
}

/**
 * Full Pipeline: Generates workbooks, records files, resolves recipients,
 * creates delivery records, and dispatches emails with robust error handling.
 *
 * @param {{
 *   runId: number,
 *   reportData: object,
 *   aiInsights: object,
 *   sendManagement?: boolean,
 *   sendEmployees?: boolean,
 *   user: object
 * }} options
 */
export async function executeReportEmailPipeline({
  runId,
  reportData,
  aiInsights,
  sendManagement = true,
  sendEmployees = false,
  user,
}) {
  const period = reportData.period || {};
  const dateSuffix = (period.end || new Date().toISOString()).slice(0, 10);

  // 1. Generate & Save Company Workbook
  const companyBuffer = await generateCompanyWorkbookBuffer({ reportData, aiInsights });
  const companyFilename = `SerpHawk_Weekly_AI_Ticket_Report_${dateSuffix}.xlsx`;
  const companyStorageKey = `reports/weekly/${runId}/${companyFilename}`;
  await putAttachment(companyStorageKey, companyBuffer, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

  const companyFileRecord = await recordReportFile({
    runId,
    fileType: 'company_report',
    filename: companyFilename,
    storageKey: companyStorageKey,
    fileSizeBytes: companyBuffer.length,
    status: 'generated',
  });

  // 2. Generate & Save Employee Workbooks (if sending to employees)
  const employeeFileMap = new Map(); // empId -> fileId
  const employeeFileRecordMap = new Map(); // empId -> fileRecord
  const employeeBufferMap = new Map(); // empId -> Buffer

  if (sendEmployees && reportData.employeeReports) {
    for (const [empId, empData] of reportData.employeeReports.entries()) {
      try {
        const empAiObs = await generateEmployeeAiObservations({
          employeeReportData: empData,
          period,
        });

        const empBuffer = await generateEmployeeWorkbookBuffer({
          employeeReportData: empData,
          aiObservations: empAiObs,
          period,
        });

        const safeEmpName = String(empData.employee?.name || `EMP${empId}`)
          .replace(/[^a-zA-Z0-9_]/g, '_')
          .slice(0, 30);
        const empFilename = `Employee_Weekly_Report_EMP${empId}_${safeEmpName}_${dateSuffix}.xlsx`;
        const empStorageKey = `reports/weekly/${runId}/${empFilename}`;
        await putAttachment(empStorageKey, empBuffer, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

        const empFileRecord = await recordReportFile({
          runId,
          fileType: 'employee_report',
          employeeId: empId,
          employeeNameSnapshot: empData.employee?.name || '',
          filename: empFilename,
          storageKey: empStorageKey,
          fileSizeBytes: empBuffer.length,
          status: 'generated',
        });

        employeeFileMap.set(empId, empFileRecord.id);
        employeeFileRecordMap.set(empId, empFileRecord);
        employeeBufferMap.set(empId, empBuffer);
      } catch (empGenErr) {
        console.warn(`[weeklyEmailService] Could not generate employee workbook for EMP ${empId}:`, empGenErr.message);
      }
    }
  }

  // 3. Resolve Recipients
  const { managementRecipients, employeeRecipients } = await resolveReportRecipients({
    user,
    includeEmployees: sendEmployees,
  });

  const targetRecipients = [];
  if (sendManagement) {
    targetRecipients.push(...managementRecipients);
  }
  if (sendEmployees) {
    targetRecipients.push(...employeeRecipients);
  }

  // 4. Create Initial Delivery Records
  const deliveryRecords = await initializeDeliveryRecords(runId, targetRecipients, {
    managementFileId: companyFileRecord.id,
    employeeFileMap,
  });

  // 5. Transmit Claimed Deliveries
  let acceptedCount = 0;
  let loggedLocalCount = 0;
  let failedCount = 0;
  let uncertainCount = 0;
  let skippedCount = 0;

  for (const delivery of deliveryRecords) {
    if (delivery.delivery_status === 'skipped') {
      skippedCount += 1;
      continue;
    }

    const claimed = await claimDeliveryRecord(delivery.id);
    if (!claimed) continue;

    const isMgmt = delivery.recipient_type === 'management';
    const fileRecord = isMgmt
      ? companyFileRecord
      : (employeeFileRecordMap.get(delivery.employee_id) || { filename: `Employee_Report_EMP${delivery.employee_id}.xlsx` });
    const fileBuffer = isMgmt
      ? companyBuffer
      : (employeeBufferMap.get(delivery.employee_id) || null);

    try {
      const mailRes = await transmitDeliveryItem(delivery, fileRecord, fileBuffer, period);

      if (mailRes?.status === 'sent') {
        await updateDeliveryResult(delivery.id, {
          status: 'accepted',
          smtpMessageId: mailRes.messageId || 'accepted',
        });
        acceptedCount += 1;
      } else if (mailRes?.status === 'logged') {
        await updateDeliveryResult(delivery.id, {
          status: 'logged_local',
        });
        loggedLocalCount += 1;
      } else {
        await updateDeliveryResult(delivery.id, {
          status: 'failed',
          errorMessage: mailRes?.error || 'Rejected by mail service',
        });
        failedCount += 1;
      }
    } catch (sendErr) {
      console.warn(`[weeklyEmailService] Error transmitting to ${delivery.recipient_email}:`, sendErr.message);
      await updateDeliveryResult(delivery.id, {
        status: 'uncertain',
        errorMessage: `Transport error: ${sendErr.message}`,
      });
      uncertainCount += 1;
    }
  }

  // 6. Update Run Management & Employee Email Statuses
  const mgmtStatus = !sendManagement
    ? 'not_requested'
    : failedCount > 0 && acceptedCount === 0
      ? 'failed'
      : isSmtpConfigured()
        ? 'sent'
        : 'sent'; // logged_local counts as sent in dev

  const empStatus = !sendEmployees
    ? 'not_requested'
    : failedCount > 0 && acceptedCount > 0
      ? 'partial_failed'
      : failedCount > 0
        ? 'failed'
        : 'sent';

  await db
    .prepare(
      `UPDATE weekly_report_runs
       SET management_email_status = ?,
           employee_email_status = ?,
           updated_at = datetime('now')
       WHERE id = ?`
    )
    .run(mgmtStatus, empStatus, runId);

  return {
    totalRecipients: targetRecipients.length,
    acceptedCount,
    loggedLocalCount,
    failedCount,
    uncertainCount,
    skippedCount,
    companyFileRecord,
  };
}

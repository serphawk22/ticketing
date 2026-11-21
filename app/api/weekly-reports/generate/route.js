import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { isAdminOrOwner, isManager } from '@/lib/rbac';
import {
  computeReportingPeriod,
  resolveReportScope,
  collectWeeklyReportData,
  acquireRunLock,
  updateRunStatus,
  recordReportFile,
} from '@/lib/weeklyReportService';
import { generateWeeklyAiReportInsights } from '@/lib/weeklyAiReporting';
import { generateCompanyWorkbookBuffer } from '@/lib/weeklyExcelGenerator';
import { executeReportEmailPipeline } from '@/lib/weeklyEmailService';
import { putAttachment } from '@/lib/storage';

export async function POST(request) {
  try {
    const session = await getSession();
    if (!session?.user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const user = session.user;
    if (!isAdminOrOwner(user) && !isManager(user)) {
      return NextResponse.json(
        { error: 'Forbidden: Admin, Owner, or Manager role required to generate reports' },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const {
      periodType = 'weekly_sat',
      customStartDate,
      customEndDate,
      projectScope = 'all',
      selectedProjectIds = [],
      includeAi = true,
      sendManagement = false,
      sendEmployees = false,
    } = body;

    // Only Owner and Admin can trigger employee email distribution
    if (sendEmployees && !isAdminOrOwner(user)) {
      return NextResponse.json(
        { error: 'Forbidden: Only Owner and Admin roles may dispatch company-wide employee emails' },
        { status: 403 }
      );
    }

    // 1. Resolve and validate project scope
    const scope = await resolveReportScope(user, {
      projectScope,
      selectedProjectIds,
    });

    // 2. Compute date boundaries
    const period = computeReportingPeriod(periodType, {
      customStartDate,
      customEndDate,
    });

    // 3. Acquire run lock
    const runToken = `manual:${user.id}:${Date.now()}`;
    const selectedIdsArray = scope.allowedProjectIds ? Array.from(scope.allowedProjectIds) : [];

    const lockResult = await acquireRunLock({
      runToken,
      reportType: 'manual',
      periodType: period.periodType,
      periodStart: period.start,
      periodEnd: period.end,
      projectScope: scope.effectiveScope,
      selectedProjectIds: selectedIdsArray,
      requestedBy: user.id,
    });

    if (!lockResult.acquired) {
      return NextResponse.json(
        { error: 'Another report generation is currently running. Please wait for it to complete.' },
        { status: 409 }
      );
    }

    const run = lockResult.run;

    // 4. Collect report data
    const reportData = await collectWeeklyReportData({
      period,
      periodType: period.periodType,
      customStartDate,
      customEndDate,
      user,
      projectScope: scope.effectiveScope,
      selectedProjectIds: selectedIdsArray,
    });

    // 5. Generate AI insights
    let aiInsights = null;
    if (includeAi) {
      try {
        aiInsights = await generateWeeklyAiReportInsights({ reportData, period });
        await updateRunStatus(run.id, {
          aiStatus: aiInsights.aiAvailable ? 'success' : 'failed',
        });
      } catch (aiErr) {
        console.warn('[api/weekly-reports/generate] AI generation warning:', aiErr.message);
        await updateRunStatus(run.id, { aiStatus: 'failed' });
      }
    } else {
      await updateRunStatus(run.id, { aiStatus: 'skipped' });
    }

    // 6. Excel Generation & Delivery Pipeline
    let companyFileRecord = null;
    let emailStats = null;

    if (sendManagement || sendEmployees) {
      emailStats = await executeReportEmailPipeline({
        runId: run.id,
        reportData,
        aiInsights,
        sendManagement: Boolean(sendManagement),
        sendEmployees: Boolean(sendEmployees),
        user,
      });
      companyFileRecord = emailStats.companyFileRecord;
    } else {
      // Download Only workflow: generate & record company workbook
      const companyBuffer = await generateCompanyWorkbookBuffer({ reportData, aiInsights });
      const dateSuffix = (period.end || new Date().toISOString()).slice(0, 10);
      const companyFilename = `SerpHawk_Weekly_AI_Ticket_Report_${dateSuffix}.xlsx`;
      const companyStorageKey = `reports/weekly/${run.id}/${companyFilename}`;

      await putAttachment(
        companyStorageKey,
        companyBuffer,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );

      companyFileRecord = await recordReportFile({
        runId: run.id,
        fileType: 'company_report',
        filename: companyFilename,
        storageKey: companyStorageKey,
        fileSizeBytes: companyBuffer.length,
        status: 'generated',
      });

      await updateRunStatus(run.id, {
        excelStatus: 'success',
        managementEmailStatus: 'not_requested',
        employeeEmailStatus: 'not_requested',
      });
    }

    // 7. Mark run completed
    await updateRunStatus(run.id, {
      status: 'completed',
      excelStatus: 'success',
    });

    return NextResponse.json({
      success: true,
      runId: run.id,
      period,
      scope: {
        effectiveScope: scope.effectiveScope,
        projectCount: scope.allowedProjectIds ? scope.allowedProjectIds.size : 'all',
      },
      file: {
        id: companyFileRecord.id,
        filename: companyFileRecord.filename,
        sizeBytes: companyFileRecord.file_size_bytes,
        downloadUrl: `/api/weekly-reports/download/${companyFileRecord.id}`,
      },
      aiInsights,
      executiveKPIs: reportData.executiveSummary?.companyKPIs || {},
      emailStats,
    });
  } catch (err) {
    console.error('[api/weekly-reports/generate] Error:', err);
    return NextResponse.json(
      { error: err.message || 'Internal server error while generating weekly report' },
      { status: 500 }
    );
  }
}

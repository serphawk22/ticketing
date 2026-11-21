import { NextResponse } from 'next/server';
import {
  getWeeklySaturdayPeriod,
  collectWeeklyReportData,
  acquireRunLock,
  updateRunStatus,
} from '@/lib/weeklyReportService';
import { generateWeeklyAiReportInsights } from '@/lib/weeklyAiReporting';
import { executeReportEmailPipeline } from '@/lib/weeklyEmailService';

export const maxDuration = 300; // Allow up to 5 minutes on Vercel Pro/Enterprise

export async function GET(request) {
  return handleCron(request);
}

export async function POST(request) {
  return handleCron(request);
}

async function handleCron(request) {
  try {
    // 1. Authenticate cron trigger
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (process.env.NODE_ENV === 'production') {
      if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
        return NextResponse.json({ error: 'Unauthorized: Invalid or missing cron secret' }, { status: 401 });
      }
    } else if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      // In development / staging, if CRON_SECRET is explicitly configured, enforce it
      return NextResponse.json({ error: 'Unauthorized: Invalid cron secret' }, { status: 401 });
    }

    // 2. Compute current Saturday 18:00 IST reporting period
    const period = getWeeklySaturdayPeriod(new Date());
    const dateStamp = period.end.slice(0, 10);
    const runToken = `weekly_sat:${dateStamp}`;

    // 3. Acquire run lock (idempotent, prevents duplicate runs)
    const lockResult = await acquireRunLock({
      runToken,
      reportType: 'scheduled',
      periodType: 'weekly_sat',
      periodStart: period.start,
      periodEnd: period.end,
      projectScope: 'all',
      selectedProjectIds: [],
      requestedBy: null,
    });

    if (!lockResult.acquired) {
      if (lockResult.reason === 'completed') {
        return NextResponse.json({
          success: true,
          message: `Weekly AI report for period ending ${dateStamp} is already completed.`,
          runId: lockResult.run?.id,
        });
      }
      return NextResponse.json(
        {
          error: `Another worker is currently processing weekly report for period ending ${dateStamp}.`,
          runId: lockResult.run?.id,
        },
        { status: 409 }
      );
    }

    const run = lockResult.run;
    const systemUser = {
      id: null,
      role: 'owner',
      name: 'Automated System Scheduler',
    };

    // 4. Collect central company report data
    const reportData = await collectWeeklyReportData({
      period,
      user: systemUser,
      projectScope: 'all',
      selectedProjectIds: [],
    });

    // 5. Generate Grounded AI insights
    let aiInsights = null;
    try {
      aiInsights = await generateWeeklyAiReportInsights({ reportData, period });
      await updateRunStatus(run.id, {
        aiStatus: aiInsights.aiAvailable ? 'success' : 'failed',
      });
    } catch (aiErr) {
      console.warn('[cron/weekly-ai-report] AI insights warning:', aiErr.message);
      await updateRunStatus(run.id, { aiStatus: 'failed' });
    }

    // 6. Execute full email distribution pipeline (Management + Employees)
    const emailStats = await executeReportEmailPipeline({
      runId: run.id,
      reportData,
      aiInsights,
      sendManagement: true,
      sendEmployees: true,
      user: systemUser,
    });

    // 7. Mark run completed
    await updateRunStatus(run.id, {
      status: 'completed',
      excelStatus: 'success',
    });

    return NextResponse.json({
      success: true,
      message: 'Weekly AI report generated and distributed successfully',
      runId: run.id,
      period,
      companyFile: {
        id: emailStats.companyFileRecord?.id,
        filename: emailStats.companyFileRecord?.filename,
      },
      emailStats: {
        totalRecipients: emailStats.totalRecipients,
        accepted: emailStats.acceptedCount,
        loggedLocal: emailStats.loggedLocalCount,
        failed: emailStats.failedCount,
        uncertain: emailStats.uncertainCount,
        skipped: emailStats.skippedCount,
      },
    });
  } catch (err) {
    console.error('[cron/weekly-ai-report] Error:', err);
    return NextResponse.json(
      { error: err.message || 'Fatal error in scheduled weekly report' },
      { status: 500 }
    );
  }
}

import { NextResponse } from 'next/server';
import { runDueReportSchedules, checkAndSendExceptionAlerts } from '@/lib/reportScheduler';
import { reconcileUnclosedAttendance } from '@/lib/attendance';

export const dynamic = 'force-dynamic';

/**
 * Server-side cron runner for scheduled reports, exception alerts, and attendance reconciliation.
 * Can be invoked by external cron triggers, Vercel cron, or internal schedule runners.
 */
export async function GET(request) {
  // Allow authorization via Bearer CRON_SECRET or session
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    // If CRON_SECRET is configured, enforce it for non-admin calls
    return NextResponse.json({ error: 'Unauthorized cron request' }, { status: 401 });
  }

  try {
    const [schedulesResult, alertsResult, attendanceResult] = await Promise.all([
      runDueReportSchedules(),
      checkAndSendExceptionAlerts(),
      reconcileUnclosedAttendance(),
    ]);

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      schedulesExecuted: schedulesResult,
      alertsResult,
      attendanceReconciliation: attendanceResult,
    });
  } catch (err) {
    console.error('Cron report execution failed:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

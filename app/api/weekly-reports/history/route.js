import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import {
  isAdminOrOwner,
  isManager,
  getEmployeeIdForUser,
  getManagerScopedProjectIds,
  getManagerScopedEmployeeIds,
} from '@/lib/rbac';
import { listReportRuns } from '@/lib/weeklyReportService';

export async function GET(request) {
  try {
    const session = await getSession();
    if (!session?.user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const user = session.user;
    const isOwnerAdmin = isAdminOrOwner(user);
    if (!isOwnerAdmin && !isManager(user)) {
      return NextResponse.json(
        { error: 'Forbidden: Admin, Owner, or Manager role required to view report history' },
        { status: 403 }
      );
    }

    let scopedProjects = null;
    let scopedEmployees = null;
    if (!isOwnerAdmin) {
      const mgrEmpId = await getEmployeeIdForUser(user);
      scopedProjects = mgrEmpId ? await getManagerScopedProjectIds(mgrEmpId) : new Set();
      scopedEmployees = mgrEmpId ? await getManagerScopedEmployeeIds(mgrEmpId, { includeSelf: true }) : new Set();
    }

    const { searchParams } = new URL(request.url);
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '20', 10), 1), 100);
    const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10), 0);

    const { runs = [], total = 0 } = await listReportRuns({ limit, offset });

    // Enrich runs with files and delivery stats, enforcing Manager RBAC filtering
    const enrichedRuns = [];
    for (const run of runs) {
      if (!isOwnerAdmin && run.requested_by !== user.id) {
        if (run.project_scope === 'all' || run.project_scope === 'active') {
          continue; // Hide company-wide runs from scoped managers
        }
        let runProjIds = [];
        try {
          runProjIds = JSON.parse(run.selected_project_ids || '[]');
        } catch {}
        const hasUnauthorizedProject = runProjIds.some((pId) => !scopedProjects?.has(Number(pId)));
        if (hasUnauthorizedProject) {
          continue; // Hide runs with projects outside manager scope
        }
      }

      const files = await db
        .prepare(
          `SELECT id, file_type, employee_id, employee_name_snapshot, filename, file_size_bytes, status, created_at
           FROM weekly_report_files
           WHERE run_id = ?
           ORDER BY id ASC`
        )
        .all(run.id);

      // Scoped managers can only see employee files for their own reportees
      const accessibleFiles = isOwnerAdmin
        ? files
        : files.filter((f) => {
            if (f.file_type === 'company_report') {
              return run.project_scope === 'selected' || run.requested_by === user.id;
            }
            return f.employee_id && scopedEmployees?.has(Number(f.employee_id));
          });

      const deliveryRows = await db
        .prepare(
          `SELECT delivery_status, COUNT(*) as count
           FROM weekly_report_deliveries
           WHERE run_id = ?
           GROUP BY delivery_status`
        )
        .all(run.id);

      const deliveryCounts = {
        accepted: 0,
        logged_local: 0,
        failed: 0,
        uncertain: 0,
        pending: 0,
        skipped: 0,
      };

      for (const row of deliveryRows) {
        if (deliveryCounts[row.delivery_status] !== undefined) {
          deliveryCounts[row.delivery_status] = Number(row.count);
        }
      }

      enrichedRuns.push({
        ...run,
        files: accessibleFiles,
        companyFile: accessibleFiles.find((f) => f.file_type === 'company_report') || null,
        deliveryCounts,
        hasFailedDeliveries: deliveryCounts.failed > 0,
      });
    }

    return NextResponse.json({
      runs: enrichedRuns,
      limit,
      offset,
    });
  } catch (err) {
    console.error('[api/weekly-reports/history] Error:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to fetch report history' },
      { status: 500 }
    );
  }
}

import { redirect } from 'next/navigation';
import requireTeamUser from '@/lib/requireTeamUser';
import {
  isAdminOrOwner,
  isManager,
  getEmployeeIdForUser,
  getManagerScopedProjectIds,
  getManagerScopedEmployeeIds,
} from '@/lib/rbac';
import { getAllProjects } from '@/lib/projects';
import { db } from '@/lib/db';
import { listReportRuns, getNextSaturdayExecution } from '@/lib/weeklyReportService';
import WeeklyAiReportsClient from '@/components/reports/WeeklyAiReportsClient';

export const dynamic = 'force-dynamic';

export default async function WeeklyAiReportsPage() {
  const session = await requireTeamUser();
  const user = session.user;
  const isOwnerAdmin = isAdminOrOwner(user);

  if (!isOwnerAdmin && !isManager(user)) {
    redirect('/');
  }

  let scopedProjects = null;
  let scopedEmployees = null;
  if (!isOwnerAdmin) {
    const mgrEmpId = await getEmployeeIdForUser(user);
    scopedProjects = mgrEmpId ? await getManagerScopedProjectIds(mgrEmpId) : new Set();
    scopedEmployees = mgrEmpId ? await getManagerScopedEmployeeIds(mgrEmpId, { includeSelf: true }) : new Set();
  }

  const [allProjects, runsResult] = await Promise.all([
    getAllProjects(),
    listReportRuns({ limit: 20 }),
  ]);

  const projects = isOwnerAdmin
    ? allProjects
    : allProjects.filter((p) => scopedProjects?.has(Number(p.id)));

  const rawRuns = runsResult?.runs || [];

  // Enrich initial runs with files and delivery stats, enforcing Manager RBAC filtering
  const initialRuns = [];
  for (const run of rawRuns) {
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

    initialRuns.push({
      ...run,
      files: accessibleFiles,
      companyFile: accessibleFiles.find((f) => f.file_type === 'company_report') || null,
      deliveryCounts,
      hasFailedDeliveries: deliveryCounts.failed > 0,
    });
  }

  // Calculate next upcoming Saturday execution cycle label
  const { nextSaturdayLabel } = getNextSaturdayExecution(new Date());

  return (
    <WeeklyAiReportsClient
      currentUser={user}
      projects={projects}
      initialRuns={initialRuns}
      nextSaturdayLabel={nextSaturdayLabel}
    />
  );
}

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { isAdminOrOwner, isManager, getEmployeeIdForUser, getManagerScopedProjectIds } from '@/lib/rbac';
import { readAttachment } from '@/lib/storage';

export async function GET(request, { params }) {
  try {
    const session = await getSession();
    if (!session?.user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const { id } = await params;
    const fileId = parseInt(id, 10);
    if (!fileId || Number.isNaN(fileId)) {
      return NextResponse.json({ error: 'Invalid file ID' }, { status: 400 });
    }

    const file = await db
      .prepare(
        `SELECT f.*, r.requested_by, r.project_scope, r.selected_project_ids
         FROM weekly_report_files f
         JOIN weekly_report_runs r ON r.id = f.run_id
         WHERE f.id = ?`
      )
      .get(fileId);

    if (!file) {
      return NextResponse.json({ error: 'Report file not found' }, { status: 404 });
    }

    const user = session.user;
    const isOwnerAdmin = isAdminOrOwner(user);
    const isMgr = isManager(user);

    // Permission checks
    if (!isOwnerAdmin) {
      if (file.file_type === 'employee_report') {
        // Individual employee report can only be downloaded by that employee or Admin/Owner
        if (!user.employee_id || user.employee_id !== file.employee_id) {
          return NextResponse.json(
            { error: 'Forbidden: You do not have permission to download this employee report' },
            { status: 403 }
          );
        }
      } else if (file.file_type === 'company_report') {
        // Company report can only be downloaded by Admin, Owner, or scoped Manager
        if (!isMgr) {
          return NextResponse.json(
            { error: 'Forbidden: Management privileges required to download company reports' },
            { status: 403 }
          );
        }

        // Managers cannot download company-wide reports ('all' or 'active')
        if (file.project_scope === 'all' || file.project_scope === 'active') {
          return NextResponse.json(
            { error: 'Forbidden: Managers cannot download company-wide reports outside their project scope' },
            { status: 403 }
          );
        }

        // For 'selected' reports, verify that all selected projects belong to the manager's scope
        const mgrEmpId = await getEmployeeIdForUser(user);
        const scopedProjects = mgrEmpId ? await getManagerScopedProjectIds(mgrEmpId) : new Set();
        let runProjIds = [];
        try {
          runProjIds = JSON.parse(file.selected_project_ids || '[]');
        } catch {}

        const hasUnauthorizedProject = runProjIds.some((pId) => !scopedProjects.has(Number(pId)));
        if (hasUnauthorizedProject) {
          return NextResponse.json(
            { error: 'Forbidden: Report contains projects outside your manager scope' },
            { status: 403 }
          );
        }
      }
    }

    const fileBuffer = await readAttachment(file.storage_key);
    if (!fileBuffer) {
      return NextResponse.json({ error: 'Attachment file not found in storage' }, { status: 404 });
    }

    const headers = new Headers();
    headers.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    headers.set(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(file.filename)}"`
    );
    headers.set('Content-Length', fileBuffer.length.toString());

    return new NextResponse(fileBuffer, {
      status: 200,
      headers,
    });
  } catch (err) {
    console.error('[api/weekly-reports/download] Error:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to download report file' },
      { status: 500 }
    );
  }
}

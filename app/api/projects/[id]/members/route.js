import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { getProject } from '@/lib/projects';
import { logAuditEvent } from '@/lib/audit';
import { assertCanViewProject, isAdminOrOwner, resolveUserScope } from '@/lib/rbac';

const VALID_MEMBER_ROLES = ['manager', 'lead', 'contributor', 'qa', 'observer'];

export const dynamic = 'force-dynamic';

async function canManageProjectMembers(user, projectId) {
  if (isAdminOrOwner(user)) return true;
  const scope = await resolveUserScope(user);
  if (!scope.isManager || !scope.employeeId) return false;
  const row = await db
    .prepare(
      `SELECT id FROM project_members
       WHERE project_id = ? AND employee_id = ? AND is_active = 1 AND project_role IN ('lead', 'manager')`
    )
    .get(Number(projectId), scope.employeeId);
  return Boolean(row);
}

export async function GET(request, { params }) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  }

  const access = await assertCanViewProject(session.user, project.id);
  if (!access.allowed) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const includeInactive = new URL(request.url).searchParams.get('includeInactive') === '1';
  const rows = await db
    .prepare(
      `SELECT pm.*, e.name AS employee_name, e.email AS employee_email, e.title AS employee_title,
              e.department AS employee_department, e.active AS employee_active, u.role AS user_role
       FROM project_members pm
       JOIN employees e ON e.id = pm.employee_id
       LEFT JOIN users u ON u.id = e.user_id
       WHERE pm.project_id = ? ${includeInactive ? '' : 'AND pm.is_active = 1'}
       ORDER BY pm.is_active DESC, pm.project_role ASC, e.name ASC`
    )
    .all(project.id);

  return NextResponse.json({ project_id: project.id, members: rows });
}

export async function POST(request, { params }) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  }

  if (!(await canManageProjectMembers(session.user, project.id))) {
    return NextResponse.json(
      { error: 'Only Business Owners, Administrators, or project leads can modify project members.' },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const employeeId = Number(body.employee_id ?? body.employeeId);
  const rawRole = String(body.project_role ?? body.role ?? 'contributor').trim().toLowerCase();
  const memberRole = rawRole === 'member' ? 'contributor' : rawRole;
  const allocatedHours = body.allocated_hours_per_week != null ? Number(body.allocated_hours_per_week) : 40;

  if (!Number.isInteger(employeeId) || employeeId <= 0) {
    return NextResponse.json({ error: 'Valid employee_id is required.' }, { status: 400 });
  }
  if (!VALID_MEMBER_ROLES.includes(memberRole)) {
    return NextResponse.json({ error: 'Invalid project member role.' }, { status: 400 });
  }
  if (!Number.isFinite(allocatedHours) || allocatedHours < 0 || allocatedHours > 168) {
    return NextResponse.json({ error: 'allocated_hours_per_week must be between 0 and 168.' }, { status: 400 });
  }

  const employee = await db
    .prepare('SELECT id, name, role, active FROM employees WHERE id = ?')
    .get(employeeId);
  if (!employee || !employee.active) {
    return NextResponse.json({ error: 'Active employee not found.' }, { status: 404 });
  }
  if (employee.role === 'client') {
    return NextResponse.json({ error: 'Client accounts cannot be project team members.' }, { status: 400 });
  }

  const existing = await db
    .prepare('SELECT id FROM project_members WHERE project_id = ? AND employee_id = ?')
    .get(project.id, employeeId);

  if (existing) {
    await db
      .prepare(
        `UPDATE project_members
         SET project_role = ?, allocated_hours_per_week = ?, is_active = 1, assigned_by = ?
         WHERE id = ?`
      )
      .run(memberRole, allocatedHours, session.user.id, existing.id);
  } else {
    await db
      .prepare(
        `INSERT INTO project_members (project_id, employee_id, project_role, allocated_hours_per_week, assigned_by)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(project.id, employeeId, memberRole, allocatedHours, session.user.id);
  }

  await logAuditEvent({
    actorId: session.user.id,
    actorName: session.user.name,
    action: existing ? 'project_member_updated' : 'project_member_added',
    entityType: 'project',
    entityId: project.id,
    details: { employeeId, projectRole: memberRole, allocatedHours },
  });

  const members = await db
    .prepare(
      `SELECT pm.*, e.name AS employee_name, e.email AS employee_email
       FROM project_members pm
       JOIN employees e ON e.id = pm.employee_id
       WHERE pm.project_id = ? AND pm.is_active = 1
       ORDER BY e.name ASC`
    )
    .all(project.id);

  return NextResponse.json({ project_id: project.id, members }, { status: existing ? 200 : 201 });
}

export async function DELETE(request, { params }) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  }

  if (!(await canManageProjectMembers(session.user, project.id))) {
    return NextResponse.json(
      { error: 'Only Business Owners, Administrators, or project leads can remove project members.' },
      { status: 403 }
    );
  }

  const { searchParams } = new URL(request.url);
  const employeeId = Number(searchParams.get('employeeId') ?? searchParams.get('employee_id'));
  if (!Number.isInteger(employeeId) || employeeId <= 0) {
    return NextResponse.json({ error: 'Valid employeeId query parameter is required.' }, { status: 400 });
  }

  await db
    .prepare('UPDATE project_members SET is_active = 0 WHERE project_id = ? AND employee_id = ? AND is_active = 1')
    .run(project.id, employeeId);

  await logAuditEvent({
    actorId: session.user.id,
    actorName: session.user.name,
    action: 'project_member_removed',
    entityType: 'project',
    entityId: project.id,
    details: { employeeId },
  });

  return NextResponse.json({ ok: true, project_id: project.id, removed_employee_id: employeeId });
}

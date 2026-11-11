import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { db } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import {
  TASK_STATES,
  createSubmission,
  listSubmissions,
  listSubmissionFacets,
} from '@/lib/taskSheet';
import {
  TASK_SHEET_SESSION_COOKIE,
  validateTaskSheetCookieSession,
} from '@/lib/taskSheetTokens';
import {
  recordTaskSheetWorkLogsTx,
  todayKolkataDate,
} from '@/lib/workLedger';
import { checkRateLimit, extractClientIpPrefix } from '@/lib/rateLimiter';
import { isAdminOrOwner, isTeamUser, resolveUserScope } from '@/lib/rbac';
import { transitionTicketStatus } from '@/lib/ticketStageService';

export const dynamic = 'force-dynamic';

function isOriginAllowed(request) {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  if (!host) return true;
  try {
    return new URL(origin).host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}

export async function POST(request) {
  const ipPrefix = extractClientIpPrefix(request);
  const rl = checkRateLimit(`ts-submit:${ipPrefix}`, { limit: 60, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many Task Sheet submissions. Please wait and try again.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } }
    );
  }

  const body = await request.json().catch(() => ({}));
  const session = await getSession();

  let verifiedEmployeeId = null;
  let submittedBy = null;
  let canonicalName = '';
  let transitionActor = null;

  if (session && isTeamUser(session.user)) {
    submittedBy = Number(session.user.id);
    const ownEmp = await db
      .prepare('SELECT id, name, user_id, active FROM employees WHERE user_id = ? AND active = 1')
      .get(submittedBy);

    const requestedName = String(body.name ?? '').trim();
    if (isAdminOrOwner(session.user)) {
      if (requestedName) {
        const namedEmp = await db
          .prepare('SELECT id, name, user_id, active FROM employees WHERE LOWER(name) = LOWER(?) AND active = 1')
          .get(requestedName);
        if (!namedEmp && !ownEmp) {
          return NextResponse.json(
            { error: 'Please select an active employee profile.' },
            { status: 400 }
          );
        }
        const resolved = namedEmp || ownEmp;
        verifiedEmployeeId = Number(resolved.id);
        canonicalName = resolved.name;
      } else if (ownEmp) {
        verifiedEmployeeId = Number(ownEmp.id);
        canonicalName = ownEmp.name;
      } else {
        return NextResponse.json({ error: 'Please select an active employee.' }, { status: 400 });
      }
    } else {
      if (!ownEmp) {
        return NextResponse.json(
          { error: 'Your user account is not linked to an active employee profile.' },
          { status: 403 }
        );
      }
      if (requestedName && requestedName.toLowerCase() !== ownEmp.name.toLowerCase()) {
        return NextResponse.json(
          { error: 'Forbidden: You cannot submit a Task Sheet on behalf of another employee.' },
          { status: 403 }
        );
      }
      verifiedEmployeeId = Number(ownEmp.id);
      canonicalName = ownEmp.name;
    }

    transitionActor = {
      id: session.user.id,
      name: session.user.name || canonicalName,
      role: session.user.role,
    };
  } else {
    if (!isOriginAllowed(request)) {
      return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 });
    }

    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get(TASK_SHEET_SESSION_COOKIE)?.value || '';
    const csrfHeader = request.headers.get('x-csrf-token') || '';

    const tsSession = await validateTaskSheetCookieSession({
      sessionCookieValue: sessionCookie,
      csrfToken: csrfHeader,
      requireCsrf: true,
    });

    if (!tsSession) {
      return NextResponse.json(
        { error: 'Authentication required. Open your employee-specific Task Sheet link or sign in.' },
        { status: 401 }
      );
    }
    if (tsSession.csrfInvalid) {
      return NextResponse.json({ error: 'Invalid or missing CSRF token.' }, { status: 403 });
    }

    const requestedName = String(body.name ?? '').trim();
    if (requestedName && requestedName.toLowerCase() !== tsSession.employee.name.toLowerCase()) {
      return NextResponse.json(
        { error: 'Forbidden: You cannot submit a Task Sheet on behalf of another employee.' },
        { status: 403 }
      );
    }
    const requestedEmpId = body.employeeId ?? body.employee_id;
    if (requestedEmpId != null && Number(requestedEmpId) !== Number(tsSession.employee.id)) {
      return NextResponse.json(
        { error: 'Forbidden: Employee identity mismatch.' },
        { status: 403 }
      );
    }

    verifiedEmployeeId = Number(tsSession.employee.id);
    submittedBy = tsSession.employee.user_id ? Number(tsSession.employee.user_id) : null;
    canonicalName = tsSession.employee.name;
    transitionActor = {
      id: submittedBy || 0,
      name: canonicalName,
      role: 'employee',
    };
  }

  const name = canonicalName;
  const projects = [
    ...new Set(
      (Array.isArray(body.projects) ? body.projects : [body.project])
        .map((p) => String(p ?? '').trim())
        .filter(Boolean)
    ),
  ];
  const project = projects[0] || '';
  const taskTitle = String(body.taskTitle ?? '').trim();
  const taskDescription = String(body.taskDescription ?? '').trim();
  const taskState = String(body.taskState ?? '').trim();
  const blocker = String(body.blocker ?? '').trim();
  const hoursWorked = Number(body.hoursWorked);
  const workDateRaw = String(body.workDate || '').trim();
  const workDate = /^\d{4}-\d{2}-\d{2}$/.test(workDateRaw) ? workDateRaw : todayKolkataDate();

  const learningProject = String(body.learningProject ?? '').trim() || null;
  const otherActivities = String(body.otherActivities ?? '').trim() || null;
  const categoryCode = String(body.categoryCode || body.category_code || 'development').trim();
  const otherActivitiesEntries = Array.isArray(body.otherActivitiesEntries)
    ? body.otherActivitiesEntries
    : [];

  if (!name) return NextResponse.json({ error: 'Please select your name.' }, { status: 400 });
  if (!project) {
    return NextResponse.json({ error: 'Please select at least one project.' }, { status: 400 });
  }

  const projectPlaceholders = projects.map(() => '?').join(', ');
  const existingProjects = await db
    .prepare(`SELECT id, name FROM projects WHERE name IN (${projectPlaceholders})`)
    .all(...projects);
  if (existingProjects.length !== projects.length) {
    return NextResponse.json(
      { error: 'One or more selected projects no longer exist. Please choose again.' },
      { status: 400 }
    );
  }
  if (!taskTitle) {
    return NextResponse.json({ error: 'Please enter a task title or number.' }, { status: 400 });
  }
  if (!taskDescription) {
    return NextResponse.json({ error: 'Please describe the task.' }, { status: 400 });
  }
  if (!Number.isFinite(hoursWorked) || hoursWorked <= 0 || hoursWorked > 24) {
    return NextResponse.json(
      { error: 'Approximate hours worked must be a positive number up to 24.' },
      { status: 400 }
    );
  }

  const selectedTickets = Array.isArray(body.selectedTickets) ? body.selectedTickets : [];
  const ALLOWED_NOT_COMPLETED = ['To Do', 'In Progress'];
  const ALLOWED_COMPLETED = ['QA Testing', 'Closed'];
  const STATUS_MAP = {
    'To Do': 'open',
    'In Progress': 'in_progress',
    'QA Testing': 'resolved',
    Closed: 'closed',
  };

  let effectiveTaskState = taskState;
  if (!effectiveTaskState && selectedTickets.length > 0) {
    effectiveTaskState = selectedTickets.every((t) => t.workState === 'completed')
      ? 'completed'
      : 'not_completed';
  } else if (!effectiveTaskState) {
    effectiveTaskState = 'completed';
  }
  if (!TASK_STATES.includes(effectiveTaskState)) {
    effectiveTaskState = 'completed';
  }

  if (selectedTickets.length > 0) {
    for (const t of selectedTickets) {
      if (t.workState === 'not_completed') {
        const status = t.taskStatus || 'In Progress';
        if (!ALLOWED_NOT_COMPLETED.includes(status)) {
          return NextResponse.json(
            { error: `Invalid status "${status}" for incomplete ticket #${t.key || t.id}.` },
            { status: 400 }
          );
        }
        if (!String(t.blocker ?? '').trim()) {
          return NextResponse.json(
            { error: `Please describe what is blocking #${t.key || t.id}.` },
            { status: 400 }
          );
        }
      } else if (t.workState === 'completed') {
        const status = t.taskStatus || 'QA Testing';
        if (!ALLOWED_COMPLETED.includes(status)) {
          return NextResponse.json(
            { error: `Invalid status "${status}" for completed ticket #${t.key || t.id}.` },
            { status: 400 }
          );
        }
      }
    }
  } else if (effectiveTaskState === 'not_completed' && !blocker) {
    return NextResponse.json(
      { error: 'Please describe what is blocking this task.' },
      { status: 400 }
    );
  }

  let blockerText = null;
  if (selectedTickets.length > 0) {
    const blockers = selectedTickets
      .filter((t) => t.workState === 'not_completed' && t.blocker?.trim())
      .map((t) => `#${t.key}: ${t.blocker.trim()}`);
    if (blockers.length > 0) {
      blockerText = blockers.join('; ');
    } else if (effectiveTaskState === 'not_completed') {
      blockerText = blocker || null;
    }
  } else {
    blockerText = effectiveTaskState === 'not_completed' ? blocker : null;
  }

  let linkedTicketId = null;
  const queuedTransitions = [];

  if (selectedTickets.length > 0) {
    for (const t of selectedTickets) {
      const tid = Number(t.id);
      if (!Number.isInteger(tid) || tid <= 0) continue;
      const exists = await db
        .prepare(`
          SELECT t.id, t.status, t.project_id,
            p.name AS project_name, p.key AS project_key,
            e.name AS employee_name, a.name AS assigned_to_name
          FROM tickets t
          LEFT JOIN projects p ON p.id = t.project_id
          LEFT JOIN employees e ON e.id = t.employee_id
          LEFT JOIN users a ON a.id = t.assigned_to
          WHERE t.id = ?
        `)
        .get(tid);

      if (!exists) {
        return NextResponse.json(
          { error: `Ticket #${t.key || tid} was not found.` },
          { status: 404 }
        );
      }
      if (exists.status === 'closed') {
        return NextResponse.json(
          { error: `Ticket #${t.key || tid} is closed and cannot be submitted on the task sheet.` },
          { status: 400 }
        );
      }

      const belongsToSelectedProject =
        !exists.project_name ||
        projects.some((p) => p.toLowerCase() === exists.project_name.toLowerCase());
      if (!belongsToSelectedProject) {
        return NextResponse.json(
          { error: `Ticket #${t.key || tid} does not belong to any selected project (${projects.join(', ')}).` },
          { status: 400 }
        );
      }

      const isAssigned =
        (exists.employee_name && exists.employee_name.toLowerCase() === name.toLowerCase()) ||
        (exists.assigned_to_name && exists.assigned_to_name.toLowerCase() === name.toLowerCase());
      if (!isAssigned) {
        return NextResponse.json(
          { error: `Ticket #${t.key || tid} is not assigned to ${name}.` },
          { status: 400 }
        );
      }

      if (!linkedTicketId) linkedTicketId = tid;

      const selectedStatusLabel = t.taskStatus || (t.workState === 'completed' ? 'QA Testing' : 'In Progress');
      const targetDbStatus = STATUS_MAP[selectedStatusLabel];
      if (targetDbStatus && exists.status !== targetDbStatus && body.syncTicketStatus !== false) {
        queuedTransitions.push({ ticketId: tid, from: exists.status, to: targetDbStatus });
      }
    }
  } else if (body.linkedTicketId) {
    const candidate = Number(body.linkedTicketId);
    if (Number.isInteger(candidate) && candidate > 0) {
      const exists = await db
        .prepare(`
          SELECT t.id, t.status, t.project_id,
            p.name AS project_name,
            e.name AS employee_name, a.name AS assigned_to_name
          FROM tickets t
          LEFT JOIN projects p ON p.id = t.project_id
          LEFT JOIN employees e ON e.id = t.employee_id
          LEFT JOIN users a ON a.id = t.assigned_to
          WHERE t.id = ?
        `)
        .get(candidate);
      if (exists && exists.status !== 'closed') {
        const projectMismatch =
          exists.project_name &&
          !projects.some((p) => p.toLowerCase() === exists.project_name.toLowerCase());
        const userMismatch = !(
          (exists.employee_name && exists.employee_name.toLowerCase() === name.toLowerCase()) ||
          (exists.assigned_to_name && exists.assigned_to_name.toLowerCase() === name.toLowerCase())
        );

        if (!projectMismatch && !userMismatch) {
          linkedTicketId = candidate;
          if (body.syncTicketStatus !== false && effectiveTaskState === 'completed') {
            if (exists.status !== 'resolved' && exists.status !== 'closed') {
              queuedTransitions.push({ ticketId: candidate, from: exists.status, to: 'resolved' });
            }
          }
        }
      }
    }
  }

  const ticketsDetail =
    selectedTickets.length > 0 ? JSON.stringify(selectedTickets) : null;

  const fallbackProjectId = existingProjects[0]?.id ? Number(existingProjects[0].id) : null;

  const result = await db.transaction(async (tx) => {
    const submission = await createSubmission({
      submittedBy,
      name,
      project,
      projects,
      hoursWorked,
      taskTitle,
      taskDescription,
      taskState: effectiveTaskState,
      blocker: blockerText,
      linkedTicketId,
      ticketsDetail,
      learningProject,
      otherActivities,
      executor: tx,
    });

    const workLogSummary = await recordTaskSheetWorkLogsTx(tx, {
      submissionId: submission.id,
      employeeId: verifiedEmployeeId,
      userId: submittedBy,
      workDate,
      payload: {
        hoursWorked,
        selectedTickets,
        linkedTicketId,
        fallbackProjectId,
        project,
        taskTitle,
        taskDescription,
        taskState: effectiveTaskState,
        blocker: blockerText,
        categoryCode,
        otherActivities,
        otherActivitiesEntries,
      },
    });

    return { submission, workLogSummary };
  });

  // Synchronize ticket status transitions deterministically through the immutable stage engine
  for (const tr of queuedTransitions) {
    try {
      await transitionTicketStatus({
        ticketId: tr.ticketId,
        toStatus: tr.to,
        actor: transitionActor,
        source: 'task_sheet',
      });
      const { notifyTicketStatusChanged } = await import('@/lib/notifications');
      await notifyTicketStatusChanged({
        ticketId: tr.ticketId,
        from: tr.from,
        to: tr.to,
        actorId: submittedBy,
        actorName: name,
      });
    } catch (err) {
      console.error(`Task Sheet ticket transition failed for #${tr.ticketId}:`, err);
    }
  }

  return NextResponse.json(
    {
      submission: result.submission,
      workLogsRecorded: result.workLogSummary.count,
      workDate,
    },
    { status: 201 }
  );
}

/** History view is role-scoped: Owner/Admin see all, Managers see their team/projects, Employees see self. */
export async function GET(request) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!isTeamUser(session.user)) {
    return NextResponse.json(
      { error: 'Only team members can read the task sheet history.' },
      { status: 403 }
    );
  }

  const scope = await resolveUserScope(session.user);
  const params = new URL(request.url).searchParams;
  let submissions = await listSubmissions({
    name: params.get('name') || '',
    project: params.get('project') || '',
    from: params.get('from') || '',
    to: params.get('to') || '',
    limit: Number(params.get('limit')) || 500,
  });

  if (scope.isEmployee) {
    const selfEmp = await db
      .prepare('SELECT id, name FROM employees WHERE user_id = ?')
      .get(Number(session.user.id));
    submissions = submissions.filter(
      (s) =>
        Number(s.submitted_by) === Number(session.user.id) ||
        (selfEmp?.name && s.name.toLowerCase() === selfEmp.name.toLowerCase())
    );
  } else if (scope.isManager) {
    const empIds = Array.from(scope.scopedEmployeeIds);
    const allowedUserIds = new Set([Number(session.user.id)]);
    const allowedNames = new Set();
    if (empIds.length > 0) {
      const ph = empIds.map(() => '?').join(', ');
      const empRows = await db
        .prepare(`SELECT user_id, name FROM employees WHERE id IN (${ph})`)
        .all(...empIds);
      for (const e of empRows) {
        if (e.user_id) allowedUserIds.add(Number(e.user_id));
        if (e.name) allowedNames.add(String(e.name).toLowerCase());
      }
    }
    submissions = submissions.filter(
      (s) =>
        (s.submitted_by && allowedUserIds.has(Number(s.submitted_by))) ||
        (s.name && allowedNames.has(String(s.name).toLowerCase())) ||
        (s.linked_project_id != null && scope.scopedProjectIds.has(Number(s.linked_project_id)))
    );
  }

  const facets = await listSubmissionFacets();
  return NextResponse.json({ submissions, ...facets });
}

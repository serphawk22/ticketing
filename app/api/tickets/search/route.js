import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { resolveUserScope } from '@/lib/rbac';
import { TASK_SHEET_SESSION_COOKIE, validateTaskSheetCookieSession } from '@/lib/taskSheetTokens';

export const dynamic = 'force-dynamic';

const SEARCH_CONDITION =
  "LOWER(t.title) LIKE LOWER(?) OR LOWER(t.description) LIKE LOWER(?) OR LOWER(p.key) LIKE LOWER(?) OR LOWER(p.key || '-' || t.id) LIKE LOWER(?)";

const SEARCH_QUERY = `
  SELECT t.id, t.title, t.status, t.priority, t.type, t.project_id,
    t.employee_id, t.created_by, t.assigned_to,
    p.key AS project_key, p.name AS project_name, p.color AS project_color,
    e.name AS employee_name, a.name AS assigned_to_name
  FROM tickets t
  LEFT JOIN projects p ON p.id = t.project_id
  LEFT JOIN employees e ON e.id = t.employee_id
  LEFT JOIN users a ON a.id = t.assigned_to
  WHERE ${SEARCH_CONDITION}
  ORDER BY
    CASE WHEN LOWER(p.key || '-' || t.id) LIKE LOWER(?) THEN 0 ELSE 1 END,
    t.id DESC
  LIMIT ?
`;

// Backs the "link work item" and "add child" pickers, which have to reach
// tickets outside the project the current view is showing. Archived tickets are
// left out: a picker that offers archived work is offering work that is not on
// any board.
export async function GET(request) {
  const session = await requireAuth();
  let tsSession = null;
  if (!session) {
    const cookieStore = await cookies();
    const tsCookie = cookieStore.get(TASK_SHEET_SESSION_COOKIE)?.value || '';
    tsSession = await validateTaskSheetCookieSession({ sessionCookieValue: tsCookie });
    if (!tsSession) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const params = new URL(request.url).searchParams;
  const scopeProject = params.get('projectId');
  const scope = session ? await resolveUserScope(session.user) : null;

  const q = (params.get('q') || '').trim();
  const exclude = Number(params.get('exclude'));
  const excludeClosed = params.get('excludeClosed') === 'true' || params.get('excludeClosed') === '1';
  const userName = (params.get('userName') || params.get('user') || '').trim();

  if (q.length < 1) {
    return NextResponse.json({ tickets: [] });
  }

  const like = `%${q}%`;
  // "WEB-12" is a key and should match that key only, while a bare "12" or
  // "WEB" is a loose search across titles, prefixes, and full keys.
  const isKey = /^[A-Za-z]+-\d+$/.test(q);
  const keyLike = isKey ? `${q.toUpperCase()}%` : like;
  const exactKeyLike = `${q.toUpperCase()}%`;

  const scoped = scopeProject ? ' AND t.project_id = ?' : '';
  const closedFilter = excludeClosed ? " AND t.status != 'closed'" : '';
  const userFilter = userName ? ' AND (e.name = ? OR a.name = ?)' : '';
  const sql = SEARCH_QUERY.replace(
    `WHERE ${SEARCH_CONDITION}`,
    `WHERE t.archived = 0${scoped}${closedFilter}${userFilter} AND (${SEARCH_CONDITION})`
  );
  const extra = [];
  if (scopeProject) extra.push(Number(scopeProject));
  if (userName) extra.push(userName, userName);

  const rows = await db
    .prepare(sql)
    .all(
      ...extra,
      like,
      like,
      like,
      keyLike,
      exactKeyLike,
      Math.min(Number(params.get('limit')) || 20, 50)
    );

  let tickets = Number.isInteger(exclude) ? rows.filter((r) => r.id !== exclude) : rows;
  if (tsSession) {
    const empNameLower = tsSession.employee.name.toLowerCase();
    tickets = tickets.filter(
      (r) =>
        Number(r.employee_id) === tsSession.employee.id ||
        (r.employee_name && r.employee_name.toLowerCase() === empNameLower) ||
        (r.assigned_to_name && r.assigned_to_name.toLowerCase() === empNameLower) ||
        (tsSession.employee.user_id && Number(r.assigned_to) === Number(tsSession.employee.user_id))
    );
  } else if (scope.isClient) {
    tickets = tickets.filter((r) => Number(r.created_by) === Number(session.user.id));
  } else if (scope.isManager) {
    tickets = tickets.filter(
      (r) =>
        (r.employee_id != null && scope.scopedEmployeeIds.has(Number(r.employee_id))) ||
        (r.project_id != null && scope.scopedProjectIds.has(Number(r.project_id))) ||
        Number(r.created_by) === Number(session.user.id) ||
        Number(r.assigned_to) === Number(session.user.id)
    );
  }
  if (excludeClosed) {
    tickets = tickets.filter((r) => r.status !== 'closed');
  }
  if (userName) {
    tickets = tickets.filter((r) => r.employee_name === userName || r.assigned_to_name === userName);
  }
  return NextResponse.json({ tickets });
}

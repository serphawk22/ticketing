import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSession } from '@/lib/auth';
import { isTeamUser } from '@/lib/rbac';
import { TASK_SHEET_SESSION_COOKIE, validateTaskSheetCookieSession } from '@/lib/taskSheetTokens';
import { amendTaskSheetSubmission } from '@/lib/workLedger';
import { checkRateLimit, extractClientIpPrefix } from '@/lib/rateLimiter';

export const dynamic = 'force-dynamic';

export async function POST(request, { params }) {
  const ipPrefix = extractClientIpPrefix(request);
  const rl = checkRateLimit(`ts-amend:${ipPrefix}`, { limit: 30, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many amendment requests. Please try again shortly.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } }
    );
  }

  const session = await getSession();
  let actor = null;
  let employeeActorId = null;

  if (session && isTeamUser(session.user)) {
    actor = session.user;
    employeeActorId = session.user.employee_id || null;
  } else {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get(TASK_SHEET_SESSION_COOKIE)?.value || '';
    const csrfHeader = request.headers.get('x-csrf-token') || '';
    const tsSession = await validateTaskSheetCookieSession({
      sessionCookieValue: sessionCookie,
      csrfToken: csrfHeader,
      requireCsrf: true,
    });
    if (!tsSession) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (tsSession.csrfInvalid) {
      return NextResponse.json({ error: 'Invalid CSRF token.' }, { status: 403 });
    }
    actor = { id: tsSession.employee.user_id, name: tsSession.employee.name, role: 'employee' };
    employeeActorId = tsSession.employee.id;
  }

  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  try {
    const res = await amendTaskSheetSubmission({
      submissionId: id,
      reason: body.reason || '',
      actor,
      employeeActorId,
      amendedPayload: body.amendedPayload ?? body,
      idempotencyKey: body.idempotency_key || body.idempotencyKey || null,
    });
    return NextResponse.json({ ok: true, ...res }, { status: res.idempotent ? 200 : 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err.message || 'Amendment failed.' },
      { status: err.statusCode || 400 }
    );
  }
}

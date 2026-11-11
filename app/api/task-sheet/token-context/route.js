import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  TASK_SHEET_CSRF_COOKIE,
  TASK_SHEET_SESSION_COOKIE,
  validateTaskSheetCookieSession,
} from '@/lib/taskSheetTokens';
import { getAllProjects } from '@/lib/projects';
import { getWorkCategories } from '@/lib/workLedger';

export const dynamic = 'force-dynamic';

export async function GET() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(TASK_SHEET_SESSION_COOKIE)?.value || '';
  const csrfCookie = cookieStore.get(TASK_SHEET_CSRF_COOKIE)?.value || '';

  const validated = await validateTaskSheetCookieSession({
    sessionCookieValue: sessionCookie,
  });

  if (!validated) {
    return NextResponse.json({ error: 'Invalid or expired Task Sheet session.' }, { status: 401 });
  }

  const [projects, workCategories] = await Promise.all([
    getAllProjects(),
    getWorkCategories({ activeOnly: true }),
  ]);

  return NextResponse.json({
    verified: true,
    employee: validated.employee,
    csrfToken: csrfCookie,
    expiresAt: validated.expiresAt,
    projects: projects.map((p) => ({ id: p.id, name: p.name, key: p.key, color: p.color })),
    workCategories,
  });
}

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const SEARCH_QUERY = `
  SELECT t.id, t.title, t.status, t.priority, t.type, t.project_id,
    p.key AS project_key, p.name AS project_name, p.color AS project_color
  FROM tickets t
  LEFT JOIN projects p ON p.id = t.project_id
  WHERE t.title LIKE ? OR p.key LIKE ? OR (p.key || '-' || t.id) LIKE ?
  ORDER BY
    CASE WHEN (p.key || '-' || t.id) LIKE ? THEN 0 ELSE 1 END,
    t.id DESC
  LIMIT ?
`;

// Backs the "link work item" and "add child" pickers, which have to reach
// tickets outside the project the current view is showing. Archived tickets are
// left out: a picker that offers archived work is offering work that is not on
// any board.
export async function GET(request) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const q = (params.get('q') || '').trim();
  const exclude = Number(params.get('exclude'));
  const scopeProject = params.get('projectId');

  if (q.length < 2) {
    return NextResponse.json({ tickets: [] });
  }

  const like = `%${q}%`;
  // "WEB-12" is a key and should match that key only, while a bare "12" or
  // "WEB" is a loose search across titles, prefixes, and full keys.
  const isKey = /^[A-Za-z]+-\d+$/.test(q);
  const keyLike = isKey ? `${q.toUpperCase()}%` : like;
  const exactKeyLike = `${q.toUpperCase()}%`;

  const scoped = scopeProject ? ' AND t.project_id = ?' : '';
  const sql = SEARCH_QUERY.replace('WHERE t.title LIKE ?', `WHERE t.archived = 0${scoped} AND t.title LIKE ?`);
  const extra = scopeProject ? [Number(scopeProject)] : [];

  const rows = await db
    .prepare(sql)
    .all(...extra, like, like, keyLike, exactKeyLike, Math.min(Number(params.get('limit')) || 20, 50));

  const tickets = Number.isInteger(exclude) ? rows.filter((r) => r.id !== exclude) : rows;
  return NextResponse.json({ tickets });
}

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { ticketKey } from '@/lib/ticketMeta';
import { parseTicketKey } from '@/lib/ticketRefs';
import { assertCanAccessTicket } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

const MAX_KEYS = 50;

/**
 * Batch-validates candidate ticket keys against actual existing tickets and
 * the caller's RBAC scope. Returns only keys that exist and are accessible.
 */
export async function GET(request) {
  const session = await requireAuth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rawKeys = new URL(request.url).searchParams.get('keys') || '';
  const requestedById = new Map();

  for (const part of rawKeys.split(',')) {
    const parsed = parseTicketKey(part);
    if (!parsed) continue;
    if (!requestedById.has(parsed.id)) {
      requestedById.set(parsed.id, new Set());
    }
    requestedById.get(parsed.id).add(parsed.key);
    if (requestedById.size >= MAX_KEYS) break;
  }

  if (requestedById.size === 0) {
    return NextResponse.json({ validKeys: [] });
  }

  const ids = [...requestedById.keys()];
  const placeholders = ids.map(() => '?').join(', ');
  const rows = await db
    .prepare(
      `SELECT t.id, t.project_id, t.employee_id, t.assigned_to, t.created_by, t.archived,
              p.key AS project_key
       FROM tickets t
       LEFT JOIN projects p ON p.id = t.project_id
       WHERE t.id IN (${placeholders})`
    )
    .all(...ids);

  const validKeys = [];
  for (const row of rows) {
    const actualKey = ticketKey(row).toUpperCase();
    const wanted = requestedById.get(Number(row.id));
    if (!wanted || !wanted.has(actualKey)) continue;

    const access = await assertCanAccessTicket(session.user, row);
    if (!access.allowed) continue;
    if (access.scope?.isClient && Number(row.archived) === 1) continue;

    validKeys.push(actualKey);
  }

  return NextResponse.json({ validKeys });
}

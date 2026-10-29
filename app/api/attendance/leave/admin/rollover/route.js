import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { performAnnualRollover } from '@/lib/attendance';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  const session = await requireAuth();
  if (!session || session.user.role !== 'admin') {
    return NextResponse.json(
      { error: 'Forbidden: Only authorized administrators can trigger annual leave rollover.' },
      { status: 403 }
    );
  }

  try {
    const body = await request.json().catch(() => ({}));
    const { employeeId = null, targetFiscalYear = null } = body;

    const result = await performAnnualRollover({
      employeeId: employeeId ? Number(employeeId) : null,
      targetFiscalYear,
      adminUser: session.user,
    });

    return NextResponse.json({ ok: true, rolloverResult: result });
  } catch (err) {
    return NextResponse.json(
      { error: err.message || 'Failed to execute annual rollover.' },
      { status: 400 }
    );
  }
}


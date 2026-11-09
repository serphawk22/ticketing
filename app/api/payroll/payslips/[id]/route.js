import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { db } from '@/lib/db';
import { renderPayslipHtml } from '@/lib/payslipService';

export const dynamic = 'force-dynamic';

export async function GET(request, { params }) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const payslipId = Number(id);
  const { searchParams } = new URL(request.url);
  const format = searchParams.get('format');

  try {
    const payslip = await db
      .prepare('SELECT * FROM payslips WHERE id = ?')
      .get(payslipId);

    if (!payslip) return NextResponse.json({ error: 'Payslip not found' }, { status: 404 });

    // Authorization: User must be admin/developer or the employee who owns the payslip
    const isOwner = session.user.employee_id === payslip.employee_id;
    const isAdminOrDev = session.user.role === 'admin' || session.user.role === 'developer';

    if (!isOwner && !isAdminOrDev) {
      return NextResponse.json({ error: 'Forbidden: You cannot view another employee\'s payslip' }, { status: 403 });
    }

    if (format === 'html') {
      const html = renderPayslipHtml(payslip.payload_json);
      return new NextResponse(html, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
        },
      });
    }

    return NextResponse.json({
      payslip: {
        ...payslip,
        payload: JSON.parse(payslip.payload_json),
      },
    });
  } catch (err) {
    console.error(`[API /api/payroll/payslips/${payslipId}] GET error:`, err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

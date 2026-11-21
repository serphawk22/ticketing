import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { isAdminOrOwner, isManager } from '@/lib/rbac';
import { resolveReportRecipients } from '@/lib/weeklyEmailService';

export async function GET(request) {
  try {
    const session = await getSession();
    if (!session?.user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const user = session.user;
    if (!isAdminOrOwner(user) && !isManager(user)) {
      return NextResponse.json(
        { error: 'Forbidden: Admin, Owner, or Manager role required' },
        { status: 403 }
      );
    }

    const { managementRecipients, employeeRecipients } = await resolveReportRecipients({
      user,
      includeEmployees: true,
    });

    return NextResponse.json({
      managementRecipients,
      employeeRecipients,
      summary: {
        totalManagement: managementRecipients.length,
        validManagement: managementRecipients.filter((r) => r.isValid).length,
        totalEmployees: employeeRecipients.length,
        validEmployees: employeeRecipients.filter((r) => r.isValid).length,
      },
    });
  } catch (err) {
    console.error('[api/weekly-reports/recipients-preview] Error:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to preview recipients' },
      { status: 500 }
    );
  }
}

import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getOnboardingWorkflows, createOnboardingWorkflow } from '@/lib/onboarding';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const session = await requireAuth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status') || null;
  const employeeId = searchParams.get('employee_id') ? Number(searchParams.get('employee_id')) : null;

  try {
    const workflows = await getOnboardingWorkflows({
      workspaceId: session.user.workspace_id,
      status,
      employeeId,
    });
    return NextResponse.json({ workflows });
  } catch (err) {
    console.error('[api/onboarding] GET error:', err.message);
    return NextResponse.json({ error: 'Failed to fetch onboarding workflows.' }, { status: 500 });
  }
}

export async function POST(request) {
  const session = await requireAuth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden: Only administrators can initiate onboarding.' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { employee_id, target_joining_date, buddy_employee_id, custom_tasks } = body;

    if (!employee_id) {
      return NextResponse.json({ error: 'Employee ID is required.' }, { status: 400 });
    }

    const workflow = await createOnboardingWorkflow({
      workspaceId: session.user.workspace_id,
      employeeId: Number(employee_id),
      targetJoiningDate: target_joining_date || null,
      buddyEmployeeId: buddy_employee_id ? Number(buddy_employee_id) : null,
      createdBy: session.user.id,
      customTasks: custom_tasks || null,
    });

    return NextResponse.json({ workflow }, { status: 201 });
  } catch (err) {
    console.error('[api/onboarding] POST error:', err.message);
    return NextResponse.json({ error: err.message || 'Failed to create onboarding workflow.' }, { status: 400 });
  }
}


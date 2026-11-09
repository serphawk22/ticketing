import { db, isRemoteDatabase } from '../lib/db.js';
import { createEmployee, deleteEmployee } from '../lib/employees.js';
import {
  createOnboardingWorkflow,
  getOnboardingWorkflows,
  getOnboardingWorkflow,
  updateOnboardingWorkflow,
  addChecklistItem,
  updateChecklistItem,
  deleteChecklistItem,
  deleteOnboardingWorkflow,
  DEFAULT_ONBOARDING_TASKS,
} from '../lib/onboarding.js';

async function runPhase5Tests() {
  console.log('--- Phase 5 Employee Onboarding Management Tests ---');

  if (isRemoteDatabase()) {
    throw new Error('FATAL: Running against remote database instead of local SQLite!');
  }

  // Get or create workspace
  let ws = await db.prepare('SELECT id FROM workspaces ORDER BY id ASC LIMIT 1').get();
  if (!ws) {
    const wsRes = await db.prepare('INSERT INTO workspaces (key, name, description) VALUES (?, ?, ?)').run('ONBWS', 'Onboarding WS', 'Testing');
    ws = { id: wsRes.lastInsertRowid };
  }

  const timestamp = Date.now();

  console.log('1. Setting up test Employees and Buddy...');
  const newHireEmail = `newhire_${timestamp}@example.com`;
  const buddyEmail = `buddy_${timestamp}@example.com`;

  const newHire = await createEmployee({
    workspaceId: ws.id,
    name: 'New Hire Charlie',
    email: newHireEmail,
    employment_status: 'probation',
    joining_date: '2026-11-15',
  });

  const buddy = await createEmployee({
    workspaceId: ws.id,
    name: 'Senior Buddy Dave',
    email: buddyEmail,
    employment_status: 'active',
  });

  console.log('2. Testing Onboarding Workflow Initiation & Checklist Item Generation...');
  const wf = await createOnboardingWorkflow({
    workspaceId: ws.id,
    employeeId: newHire.id,
    targetJoiningDate: '2026-11-15',
    buddyEmployeeId: buddy.id,
  });

  if (!wf || !wf.id) {
    throw new Error('FAIL: Onboarding workflow creation failed');
  }
  if (wf.status !== 'pre_boarding') {
    throw new Error(`FAIL: Initial status should be pre_boarding, got ${wf.status}`);
  }
  if (wf.items.length !== DEFAULT_ONBOARDING_TASKS.length) {
    throw new Error(`FAIL: Checklist count ${wf.items.length} does not match default ${DEFAULT_ONBOARDING_TASKS.length}`);
  }
  if (wf.completed_tasks !== 0 || wf.progress_percent !== 0) {
    throw new Error('FAIL: Initial completed tasks should be 0');
  }
  if (Number(wf.buddy_employee_id) !== Number(buddy.id)) {
    throw new Error('FAIL: Buddy employee ID not set');
  }

  // Verify duplicate prevention
  try {
    await createOnboardingWorkflow({
      workspaceId: ws.id,
      employeeId: newHire.id,
    });
    throw new Error('FAIL: Allowed duplicate active onboarding workflow for same employee');
  } catch (err) {
    if (!err.message.includes('already exists')) throw err;
  }
  console.log('   PASSED: Onboarding workflow created with default task checklist and duplicate guard.');

  console.log('3. Testing Onboarding Listing & Metrics...');
  const list = await getOnboardingWorkflows({ workspaceId: ws.id });
  const found = list.find((w) => w.id === wf.id);
  if (!found) {
    throw new Error('FAIL: Created workflow not found in list');
  }
  if (found.total_tasks !== DEFAULT_ONBOARDING_TASKS.length || found.progress_percent !== 0) {
    throw new Error('FAIL: Metrics calculation mismatch in list');
  }

  const preBoardingList = await getOnboardingWorkflows({ workspaceId: ws.id, status: 'pre_boarding' });
  if (!preBoardingList.some((w) => w.id === wf.id)) {
    throw new Error('FAIL: Status filter pre_boarding did not return workflow');
  }
  console.log('   PASSED: Workflows list and metrics verified.');

  console.log('4. Testing Checklist Item Status Toggle & Auto-Progress...');
  const firstItem = wf.items[0];
  const updatedWf = await updateChecklistItem(firstItem.id, {
    workspaceId: ws.id,
    status: 'completed',
    notes: 'Signed contract received via DocuSign',
  });

  if (updatedWf.completed_tasks !== 1) {
    throw new Error(`FAIL: Expected 1 completed task, got ${updatedWf.completed_tasks}`);
  }
  if (updatedWf.status !== 'in_progress') {
    throw new Error(`FAIL: Workflow should transition to in_progress upon completing first task, got ${updatedWf.status}`);
  }
  console.log('   PASSED: Checklist item completed and workflow transitioned to in_progress.');

  console.log('5. Testing Custom Task Addition...');
  const customItem = await addChecklistItem(wf.id, {
    workspaceId: ws.id,
    taskName: 'Arrange welcome lunch and introduce team',
    category: 'Orientation',
  });

  if (!customItem || customItem.task_name !== 'Arrange welcome lunch and introduce team') {
    throw new Error('FAIL: Custom checklist item not added correctly');
  }

  const refreshedWf = await getOnboardingWorkflow(wf.id, ws.id);
  if (refreshedWf.total_tasks !== DEFAULT_ONBOARDING_TASKS.length + 1) {
    throw new Error('FAIL: Total tasks did not increment after adding custom task');
  }
  console.log('   PASSED: Custom checklist task added and counted.');

  console.log('6. Testing Workflow Completion...');
  // Mark all remaining items as completed
  for (const item of refreshedWf.items) {
    if (item.status !== 'completed') {
      await updateChecklistItem(item.id, {
        workspaceId: ws.id,
        status: 'completed',
      });
    }
  }

  const completedWf = await getOnboardingWorkflow(wf.id, ws.id);
  if (completedWf.status !== 'completed' || completedWf.progress_percent !== 100) {
    throw new Error(`FAIL: Workflow should auto-complete at 100%, status=${completedWf.status}, progress=${completedWf.progress_percent}%`);
  }
  if (!completedWf.completed_at) {
    throw new Error('FAIL: completed_at timestamp missing on completed workflow');
  }
  console.log('   PASSED: Auto-completion at 100% verified.');

  console.log('7. Testing Workflow Deletion and Cascade Cleanup...');
  await deleteOnboardingWorkflow(wf.id, ws.id);
  const deletedCheck = await getOnboardingWorkflow(wf.id, ws.id);
  if (deletedCheck !== null) {
    throw new Error('FAIL: Workflow still exists after deletion');
  }

  const itemsRemaining = await db.prepare('SELECT COUNT(*) AS c FROM onboarding_checklist_items WHERE workflow_id = ?').get(wf.id);
  if (itemsRemaining.c !== 0) {
    throw new Error('FAIL: Checklist items were not cascade purged');
  }
  console.log('   PASSED: Workflow and checklist items cleanly purged.');

  console.log('8. Cleaning up test employees...');
  await deleteEmployee(newHire.id, ws.id);
  await deleteEmployee(buddy.id, ws.id);
  console.log('   PASSED: Cleanup complete.');

  console.log('\n>>> ALL PHASE 5 TESTS PASSED SUCCESSFULLY! <<<');
}

runPhase5Tests().catch((err) => {
  console.error('\n*** TEST FAILED ***\n', err);
  process.exit(1);
});


import { db, isRemoteDatabase } from '../lib/db.js';
import { createEmployee, deleteEmployee, getEmployee } from '../lib/employees.js';
import { createAsset, allocateAsset, returnAsset, deleteAsset } from '../lib/assets.js';
import {
  createExitRequest,
  getExitRequests,
  getExitRequest,
  updateExitRequest,
  updateDepartmentClearance,
  reassignExitEmployeeTickets,
  updateExitChecklistItem,
  deleteExitRequest,
  DEFAULT_EXIT_TASKS,
} from '../lib/exitManagement.js';

async function runPhase7Tests() {
  console.log('--- Phase 7 Employee Exit Management Tests ---');

  if (isRemoteDatabase()) {
    throw new Error('FATAL: Running against remote database instead of local SQLite!');
  }

  // Get or create workspace
  let ws = await db.prepare('SELECT id FROM workspaces ORDER BY id ASC LIMIT 1').get();
  if (!ws) {
    const wsRes = await db.prepare('INSERT INTO workspaces (key, name, description) VALUES (?, ?, ?)').run('EXITWS', 'Exit WS', 'Testing');
    ws = { id: wsRes.lastInsertRowid };
  }

  // Get or create a test project for tickets
  let proj = await db.prepare('SELECT id FROM projects WHERE workspace_id = ? LIMIT 1').get(ws.id);
  if (!proj) {
    const projRes = await db.prepare("INSERT INTO projects (workspace_id, key, name, description) VALUES (?, 'EXT', 'Exit Test Proj', 'Test')").run(ws.id);
    proj = { id: projRes.lastInsertRowid };
  }

  const timestamp = Date.now();

  console.log('1. Setting up test Exiting Employee, Successor, Ticket, and Asset...');
  const exiter = await createEmployee({
    workspaceId: ws.id,
    name: 'Eve Exiter',
    email: `eve_exit_${timestamp}@example.com`,
    employment_status: 'active',
  });

  const successor = await createEmployee({
    workspaceId: ws.id,
    name: 'Sam Successor',
    email: `sam_succ_${timestamp}@example.com`,
    employment_status: 'active',
  });

  let creatorUser = await db.prepare('SELECT id FROM users LIMIT 1').get();
  if (!creatorUser) {
    const uRes = await db.prepare("INSERT INTO users (name, email, role, password) VALUES ('Creator', 'creator@test.com', 'admin', 'dummy')").run();
    creatorUser = { id: uRes.lastInsertRowid };
  }

  // Create an open ticket assigned to Eve
  const ticketRes = await db.prepare(`
    INSERT INTO tickets (
      project_id, employee_id, created_by, title,
      status, priority, description, created_at, updated_at
    ) VALUES (?, ?, ?, 'Critical Client Bug', 'open', 'high', 'Handoff required', datetime('now'), datetime('now'))
  `).run(proj.id, exiter.id, creatorUser.id);
  const ticketId = ticketRes.lastInsertRowid;

  // Allocate a laptop to Eve
  const testTag = `EXT-LAP-${timestamp.toString().slice(-5)}`;
  const asset = await createAsset({
    workspaceId: ws.id,
    assetTag: testTag,
    name: 'Company ThinkPad',
    category: 'Laptop',
  });
  await allocateAsset({
    workspaceId: ws.id,
    assetId: asset.id,
    employeeId: exiter.id,
    allocatedAt: '2026-11-01',
  });

  console.log('2. Testing Exit Request Initiation & Notice Period Transition...');
  const exitReq = await createExitRequest({
    workspaceId: ws.id,
    employeeId: exiter.id,
    resignationDate: '2026-11-02',
    noticePeriodDays: 30,
    reason: 'Career transition and new opportunity',
  });

  if (!exitReq || !exitReq.id) {
    throw new Error('FAIL: Exit request creation failed');
  }
  if (exitReq.status !== 'submitted' || exitReq.noc_status !== 'pending') {
    throw new Error('FAIL: Initial status must be submitted with pending NOC');
  }
  if (exitReq.items.length !== DEFAULT_EXIT_TASKS.length) {
    throw new Error(`FAIL: Checklist count ${exitReq.items.length} does not match default ${DEFAULT_EXIT_TASKS.length}`);
  }

  // Verify employee transitioned to notice_period
  const exiterUpdated = await getEmployee(exiter.id);
  if (exiterUpdated.employment_status !== 'notice_period') {
    throw new Error(`FAIL: Employee employment_status should be notice_period, got ${exiterUpdated.employment_status}`);
  }
  console.log('   PASSED: Exit request created and employee transitioned to notice_period.');

  console.log('3. Testing Liability Detection (Open Tickets and Custody Assets)...');
  const details = await getExitRequest(exitReq.id, ws.id);
  if (details.open_tickets.length !== 1 || details.assets.length !== 1) {
    throw new Error(`FAIL: Expected 1 open ticket and 1 asset, got ${details.open_tickets.length} tickets and ${details.assets.length} assets`);
  }
  console.log('   PASSED: Active liabilities detected accurately.');

  console.log('4. Testing Ticket Reassignment Handover...');
  const reassignResult = await reassignExitEmployeeTickets(exiter.id, successor.id, ws.id);
  if (reassignResult.reassigned_count !== 1) {
    throw new Error('FAIL: Failed to reassign open ticket');
  }

  const ticketAfterReassign = await db.prepare('SELECT employee_id FROM tickets WHERE id = ?').get(ticketId);
  if (Number(ticketAfterReassign.employee_id) !== Number(successor.id)) {
    throw new Error('FAIL: Ticket employee_id not updated to successor');
  }

  const detailsAfterReassign = await getExitRequest(exitReq.id, ws.id);
  if (detailsAfterReassign.open_tickets.length !== 0) {
    throw new Error('FAIL: Exiting employee still has open tickets after reassignment');
  }
  console.log('   PASSED: Open tickets successfully bulk reassigned to successor.');

  console.log('5. Testing Asset Return Clearance...');
  await returnAsset({
    workspaceId: ws.id,
    assetId: asset.id,
    returnedAt: '2026-11-02',
    condition: 'good',
    notes: 'Laptop returned and inspected during exit procedure',
  });

  const detailsAfterAssetReturn = await getExitRequest(exitReq.id, ws.id);
  if (detailsAfterAssetReturn.assets.length !== 0) {
    throw new Error('FAIL: Exiting employee still shows unreturned assets after return');
  }
  console.log('   PASSED: Asset return cleared.');

  console.log('6. Testing Department Clearances & Automated NOC / Deactivation...');
  // Grant IT Clearance
  await updateDepartmentClearance(exitReq.id, {
    workspaceId: ws.id,
    department: 'it',
    cleared: true,
  });

  // Grant Finance Clearance
  await updateDepartmentClearance(exitReq.id, {
    workspaceId: ws.id,
    department: 'finance',
    cleared: true,
  });

  // Grant HR Clearance (Final clearance trigger)
  const finalExit = await updateDepartmentClearance(exitReq.id, {
    workspaceId: ws.id,
    department: 'hr',
    cleared: true,
  });

  if (!finalExit.hr_clearance || !finalExit.it_clearance || !finalExit.finance_clearance) {
    throw new Error('FAIL: Department clearance flags not all recorded');
  }
  if (finalExit.noc_status !== 'approved') {
    throw new Error(`FAIL: Expected noc_status to be approved, got ${finalExit.noc_status}`);
  }
  if (finalExit.status !== 'completed') {
    throw new Error(`FAIL: Expected exit request status to be completed, got ${finalExit.status}`);
  }

  // Verify employee is marked as resigned and deactivated
  const finalEmployee = await getEmployee(exiter.id);
  if (finalEmployee.employment_status !== 'resigned' || finalEmployee.active !== false) {
    throw new Error(`FAIL: Employee should be deactivated with resigned status, got active=${finalEmployee.active}, status=${finalEmployee.employment_status}`);
  }
  console.log('   PASSED: All clearances granted, NOC issued, and employee automatically separated & deactivated.');

  console.log('7. Testing Checklist Item Status Updates...');
  const firstItem = finalExit.items[0];
  const itemUpdated = await updateExitChecklistItem(firstItem.id, {
    workspaceId: ws.id,
    status: 'completed',
    notes: 'Access revoked via Google Admin',
  });
  if (!itemUpdated.items.some((i) => i.id === firstItem.id && i.status === 'completed')) {
    throw new Error('FAIL: Checklist item completion not recorded');
  }
  console.log('   PASSED: Exit checklist item status verified.');

  console.log('8. Cleaning up test data...');
  await deleteExitRequest(exitReq.id, ws.id);
  await db.prepare('DELETE FROM tickets WHERE id = ?').run(ticketId);
  await deleteAsset(asset.id, ws.id);
  await deleteEmployee(exiter.id, ws.id);
  await deleteEmployee(successor.id, ws.id);
  console.log('   PASSED: Cleanup complete.');

  console.log('\n>>> ALL PHASE 7 TESTS PASSED SUCCESSFULLY! <<<');
}

runPhase7Tests().catch((err) => {
  console.error('\n*** TEST FAILED ***\n', err);
  process.exit(1);
});

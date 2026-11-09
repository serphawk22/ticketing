import { db, isRemoteDatabase } from '../lib/db.js';
import { createEmployee, deleteEmployee } from '../lib/employees.js';
import {
  createAsset,
  getAssets,
  getAsset,
  updateAsset,
  allocateAsset,
  returnAsset,
  getEmployeeAssets,
  deleteAsset,
} from '../lib/assets.js';

async function runPhase6Tests() {
  console.log('--- Phase 6 Company Asset Management Tests ---');

  if (isRemoteDatabase()) {
    throw new Error('FATAL: Running against remote database instead of local SQLite!');
  }

  // Get or create workspace
  let ws = await db.prepare('SELECT id FROM workspaces ORDER BY id ASC LIMIT 1').get();
  if (!ws) {
    const wsRes = await db.prepare('INSERT INTO workspaces (key, name, description) VALUES (?, ?, ?)').run('ASTWS', 'Asset WS', 'Testing');
    ws = { id: wsRes.lastInsertRowid };
  }

  const timestamp = Date.now();

  console.log('1. Setting up test Employees...');
  const empA = await createEmployee({
    workspaceId: ws.id,
    name: 'Alice AssetTester',
    email: `alice_ast_${timestamp}@example.com`,
    employment_status: 'active',
  });

  const empB = await createEmployee({
    workspaceId: ws.id,
    name: 'Bob AssetTester',
    email: `bob_ast_${timestamp}@example.com`,
    employment_status: 'active',
  });

  console.log('2. Testing Asset Registration & Tag Uniqueness...');
  const testTag = `LAP-TEST-${timestamp.toString().slice(-6)}`;
  const asset = await createAsset({
    workspaceId: ws.id,
    assetTag: testTag,
    name: 'MacBook Pro 16" M3 Max',
    category: 'Laptop',
    serialNumber: `SN-${timestamp}`,
    condition: 'new',
    purchaseDate: '2026-01-15',
    notes: '36GB RAM, 1TB SSD',
  });

  if (!asset || !asset.id) {
    throw new Error('FAIL: Asset registration failed');
  }
  if (asset.asset_tag !== testTag || asset.status !== 'available' || asset.condition !== 'new') {
    throw new Error('FAIL: Asset fields mismatch');
  }

  // Duplicate tag guard
  try {
    await createAsset({
      workspaceId: ws.id,
      assetTag: testTag,
      name: 'Duplicate Laptop',
    });
    throw new Error('FAIL: Allowed duplicate asset tag in same workspace');
  } catch (err) {
    if (!err.message.includes('already exists')) throw err;
  }
  console.log('   PASSED: Asset registered with unique tag constraint.');

  console.log('3. Testing Asset Listing, Category & Status Filters...');
  const allAssets = await getAssets({ workspaceId: ws.id });
  if (!allAssets.some((a) => a.id === asset.id)) {
    throw new Error('FAIL: Created asset not found in getAssets');
  }

  const laptopAssets = await getAssets({ workspaceId: ws.id, category: 'Laptop' });
  if (!laptopAssets.some((a) => a.id === asset.id)) {
    throw new Error('FAIL: Category filter did not return asset');
  }

  const availableAssets = await getAssets({ workspaceId: ws.id, status: 'available' });
  if (!availableAssets.some((a) => a.id === asset.id)) {
    throw new Error('FAIL: Status filter available did not return asset');
  }
  console.log('   PASSED: Asset listing and filtering verified.');

  console.log('4. Testing Asset Allocation to Employee A...');
  const allocated = await allocateAsset({
    workspaceId: ws.id,
    assetId: asset.id,
    employeeId: empA.id,
    allocatedAt: '2026-11-01',
    condition: 'new',
    notes: 'Issued with 140W USB-C power adapter and case',
  });

  if (allocated.status !== 'allocated' || Number(allocated.assigned_employee_id) !== Number(empA.id)) {
    throw new Error(`FAIL: Asset status after allocation should be allocated, got ${allocated.status}`);
  }

  // Verify double allocation is prevented
  try {
    await allocateAsset({
      workspaceId: ws.id,
      assetId: asset.id,
      employeeId: empB.id,
    });
    throw new Error('FAIL: Allowed double allocation of an already allocated asset');
  } catch (err) {
    if (!err.message.includes('already allocated')) throw err;
  }
  console.log('   PASSED: Asset allocated to Employee A and double-allocation blocked.');

  console.log('5. Testing Employee Allocated Assets Lookup (getEmployeeAssets)...');
  const empAAssets = await getEmployeeAssets(empA.id, ws.id);
  if (empAAssets.length !== 1 || empAAssets[0].id !== asset.id) {
    throw new Error('FAIL: getEmployeeAssets for Employee A did not return allocated asset');
  }

  const empBAssets = await getEmployeeAssets(empB.id, ws.id);
  if (empBAssets.length !== 0) {
    throw new Error('FAIL: Employee B should have 0 allocated assets');
  }
  console.log('   PASSED: Employee asset ownership query verified.');

  console.log('6. Testing Safe Deletion Guard (Cannot delete actively allocated asset)...');
  try {
    await deleteAsset(asset.id, ws.id);
    throw new Error('FAIL: deleteAsset should reject deleting an actively allocated asset');
  } catch (err) {
    if (!err.message.includes('currently allocated')) throw err;
  }
  console.log('   PASSED: Deletion blocked for actively allocated asset.');

  console.log('7. Testing Asset Return...');
  const returned = await returnAsset({
    workspaceId: ws.id,
    assetId: asset.id,
    returnedAt: '2026-11-02',
    condition: 'good',
    notes: 'Returned in good condition, factory reset performed',
  });

  if (returned.status !== 'available' || returned.assigned_employee_id) {
    throw new Error(`FAIL: Returned asset should be available with no active employee, got status=${returned.status}`);
  }

  const empAAssetsAfterReturn = await getEmployeeAssets(empA.id, ws.id);
  if (empAAssetsAfterReturn.length !== 0) {
    throw new Error('FAIL: Employee A should have 0 active assets after return');
  }
  console.log('   PASSED: Asset returned successfully and status reverted to available.');

  console.log('8. Testing Re-allocation to Employee B and Full Audit History...');
  await allocateAsset({
    workspaceId: ws.id,
    assetId: asset.id,
    employeeId: empB.id,
    condition: 'good',
    notes: 'Re-issued to Bob',
  });

  const assetDetails = await getAsset(asset.id, ws.id);
  if (assetDetails.history.length !== 2) {
    throw new Error(`FAIL: Asset history should contain 2 allocation records, got ${assetDetails.history.length}`);
  }

  // Most recent should be Employee B (active)
  const [currentAlloc, pastAlloc] = assetDetails.history;
  if (Number(currentAlloc.employee_id) !== Number(empB.id) || currentAlloc.returned_at !== null) {
    throw new Error('FAIL: Latest history record mismatch');
  }
  // Past should be Employee A (returned)
  if (Number(pastAlloc.employee_id) !== Number(empA.id) || pastAlloc.returned_at === null) {
    throw new Error('FAIL: Past history record mismatch');
  }
  console.log('   PASSED: Asset re-allocated and complete chronological audit history verified.');

  console.log('9. Cleaning up test asset and employees...');
  await returnAsset({ assetId: asset.id });
  await deleteAsset(asset.id, ws.id);
  await deleteEmployee(empA.id, ws.id);
  await deleteEmployee(empB.id, ws.id);
  console.log('   PASSED: Cleanup complete.');

  console.log('\n>>> ALL PHASE 6 TESTS PASSED SUCCESSFULLY! <<<');
}

runPhase6Tests().catch((err) => {
  console.error('\n*** TEST FAILED ***\n', err);
  process.exit(1);
});


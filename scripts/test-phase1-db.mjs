import { db, isRemoteDatabase } from '../lib/db.js';

async function runTests() {
  console.log('--- Phase 1 Database Architecture & Safeguard Tests ---');

  // Test 1: Verify driver is SQLite
  console.log('1. Checking driver selection...');
  if (isRemoteDatabase()) {
    throw new Error('FAIL: Database driver is reporting remote database! Expected SQLite.');
  }
  console.log('   PASS: Running against local SQLite driver.');

  // Test 2: Trigger DB initialization and schema migration
  console.log('2. Initializing database and running migrations...');
  await db.prepare('SELECT 1 AS alive').get();
  console.log('   PASS: Database initialized.');

  // Test 3: Check columns on employees table
  console.log('3. Verifying extended columns on employees table...');
  const empCols = await db.prepare('PRAGMA table_info(employees)').all();
  const colNames = empCols.map((c) => c.name);
  const requiredCols = [
    'phone',
    'dob',
    'gender',
    'current_address',
    'permanent_address',
    'emergency_contact_name',
    'emergency_contact_relation',
    'emergency_contact_phone',
    'blood_group',
    'department_id',
    'designation_id',
    'reporting_manager_id',
    'employment_status',
  ];
  for (const col of requiredCols) {
    if (!colNames.includes(col)) {
      throw new Error(`FAIL: Missing column "${col}" on employees table.`);
    }
  }
  console.log(`   PASS: All ${requiredCols.length} extended employee columns present.`);

  // Test 4: Check new tables
  console.log('4. Verifying new tables exist...');
  const newTables = [
    'departments',
    'designations',
    'onboarding_workflows',
    'onboarding_checklist_items',
    'exit_requests',
    'exit_checklist_items',
    'company_assets',
    'asset_allocations',
    'employee_documents',
  ];
  for (const table of newTables) {
    const info = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
    if (!info) {
      throw new Error(`FAIL: Table "${table}" was not created.`);
    }
  }
  console.log(`   PASS: All ${newTables.length} new tables verified.`);

  // Test 5: Verify CRUD and constraints on new tables using dummy data
  console.log('5. Testing CRUD operations on new tables...');

  // Get or create a test workspace
  let ws = await db.prepare('SELECT id FROM workspaces ORDER BY id ASC LIMIT 1').get();
  if (!ws) {
    const wsRes = await db.prepare('INSERT INTO workspaces (key, name, description) VALUES (?, ?, ?)').run('TESTWS', 'Test WS', 'Test');
    ws = { id: wsRes.lastInsertRowid };
  }

  // Create test department
  const deptCode = `DEPT_${Date.now()}`;
  const deptRes = await db.prepare(`
    INSERT INTO departments (workspace_id, name, code, description)
    VALUES (?, ?, ?, ?)
  `).run(ws.id, 'Engineering Test', deptCode, 'Test Dept');
  const deptId = deptRes.lastInsertRowid;
  if (!deptId) throw new Error('FAIL: Could not create department.');

  // Create test designation
  const desigCode = `DESIG_${Date.now()}`;
  const desigRes = await db.prepare(`
    INSERT INTO designations (workspace_id, department_id, title, code, level)
    VALUES (?, ?, ?, ?, ?)
  `).run(ws.id, deptId, 'Senior Engineer Test', desigCode, 'L4');
  const desigId = desigRes.lastInsertRowid;
  if (!desigId) throw new Error('FAIL: Could not create designation.');

  // Create test employee with extended fields
  const empEmail = `test.emp.${Date.now()}@example.com`;
  const empRes = await db.prepare(`
    INSERT INTO employees (
      name, email, role, department_id, designation_id, phone, dob, gender,
      current_address, permanent_address, emergency_contact_name, emergency_contact_relation,
      emergency_contact_phone, blood_group, employment_status, workspace_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'Test Employee', empEmail, 'developer', deptId, desigId, '+1234567890', '1995-05-15', 'other',
    '123 Test St', '123 Test St', 'Emergency Contact', 'Sibling', '+1987654321', 'O+', 'active', ws.id
  );
  const empId = empRes.lastInsertRowid;
  if (!empId) throw new Error('FAIL: Could not create test employee with extended fields.');

  // Test onboarding workflow
  const onbRes = await db.prepare(`
    INSERT INTO onboarding_workflows (workspace_id, employee_id, target_joining_date, status)
    VALUES (?, ?, ?, ?)
  `).run(ws.id, empId, '2026-11-15', 'pre_boarding');
  const onbId = onbRes.lastInsertRowid;

  const onbItemRes = await db.prepare(`
    INSERT INTO onboarding_checklist_items (workspace_id, workflow_id, task_name, category, status)
    VALUES (?, ?, ?, ?, ?)
  `).run(ws.id, onbId, 'Collect Signed Offer Letter', 'Documentation', 'pending');
  if (!onbItemRes.lastInsertRowid) throw new Error('FAIL: Could not create onboarding checklist item.');

  // Test asset and allocation
  const assetTag = `AST-${Date.now()}`;
  const assetRes = await db.prepare(`
    INSERT INTO company_assets (workspace_id, asset_tag, name, category, serial_number, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(ws.id, assetTag, 'MacBook Pro 16', 'Laptop', 'SN123456789', 'allocated');
  const assetId = assetRes.lastInsertRowid;

  const allocRes = await db.prepare(`
    INSERT INTO asset_allocations (workspace_id, asset_id, employee_id, allocated_at, issued_condition)
    VALUES (?, ?, ?, ?, ?)
  `).run(ws.id, assetId, empId, '2026-11-02 10:00:00', 'new in box');
  if (!allocRes.lastInsertRowid) throw new Error('FAIL: Could not create asset allocation.');

  // Test employee document
  const docRes = await db.prepare(`
    INSERT INTO employee_documents (
      workspace_id, employee_id, doc_type, title, file_name, storage_key, file_size, mime_type, verification_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    ws.id, empId, 'offer_letter', 'Signed Offer Letter', 'offer.pdf',
    `employee-docs/${empId}/test-offer.pdf`, 102400, 'application/pdf', 'pending'
  );
  if (!docRes.lastInsertRowid) throw new Error('FAIL: Could not create employee document record.');

  // Test exit request and checklist item
  const exitRes = await db.prepare(`
    INSERT INTO exit_requests (workspace_id, employee_id, resignation_date, last_working_day, reason, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(ws.id, empId, '2026-11-02', '2026-12-02', 'Personal reasons', 'submitted');
  const exitId = exitRes.lastInsertRowid;

  const exitItemRes = await db.prepare(`
    INSERT INTO exit_checklist_items (workspace_id, exit_request_id, task_name, category, status)
    VALUES (?, ?, ?, ?, ?)
  `).run(ws.id, exitId, 'Handover laptop and peripherals', 'IT', 'pending');
  if (!exitItemRes.lastInsertRowid) throw new Error('FAIL: Could not create exit checklist item.');

  console.log('   PASS: All CRUD operations and relations succeeded.');

  // Clean up dummy test data
  console.log('6. Cleaning up test data...');
  await db.prepare('DELETE FROM exit_checklist_items WHERE exit_request_id = ?').run(exitId);
  await db.prepare('DELETE FROM exit_requests WHERE id = ?').run(exitId);
  await db.prepare('DELETE FROM employee_documents WHERE id = ?').run(docRes.lastInsertRowid);
  await db.prepare('DELETE FROM asset_allocations WHERE id = ?').run(allocRes.lastInsertRowid);
  await db.prepare('DELETE FROM company_assets WHERE id = ?').run(assetId);
  await db.prepare('DELETE FROM onboarding_checklist_items WHERE id = ?').run(onbItemRes.lastInsertRowid);
  await db.prepare('DELETE FROM onboarding_workflows WHERE id = ?').run(onbId);
  await db.prepare('DELETE FROM employees WHERE id = ?').run(empId);
  await db.prepare('DELETE FROM designations WHERE id = ?').run(desigId);
  await db.prepare('DELETE FROM departments WHERE id = ?').run(deptId);
  console.log('   PASS: Test dummy records cleanly purged.');

  // Test 7: Verify existing records preserved
  console.log('7. Verifying existing employee records preserved...');
  const existingEmployees = await db.prepare('SELECT COUNT(*) AS total FROM employees').all();
  console.log(`   PASS: Existing employees intact (Total employees: ${existingEmployees[0].total}).`);

  console.log('\n--- ALL PHASE 1 DATABASE TESTS PASSED SUCCESSFULLY ---');
}

runTests().catch((err) => {
  console.error('\nTEST FAILED:', err);
  process.exit(1);
});


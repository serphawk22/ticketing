import { db, isRemoteDatabase } from '../lib/db.js';
import {
  getDepartments,
  getDepartment,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  getDesignations,
  getDesignation,
  createDesignation,
  updateDesignation,
  deleteDesignation,
  getDepartmentEmployees,
} from '../lib/departments.js';
import {
  validateManagerAssignment,
  getDirectReportees,
  getIndirectReportees,
  getReportingTree,
  getEmployeeHierarchy,
} from '../lib/reportingTree.js';
import { createEmployee, updateEmployee, deleteEmployee, getEmployee } from '../lib/employees.js';

async function runPhase2Tests() {
  console.log('--- Phase 2 Department, Designation & Reporting Hierarchy Tests ---');

  if (isRemoteDatabase()) {
    throw new Error('FAIL: Running against remote database instead of local SQLite!');
  }

  // Get or create workspace
  let ws = await db.prepare('SELECT id FROM workspaces ORDER BY id ASC LIMIT 1').get();
  if (!ws) {
    const wsRes = await db.prepare('INSERT INTO workspaces (key, name, description) VALUES (?, ?, ?)').run('ORGWS', 'Org Test WS', 'Org');
    ws = { id: wsRes.lastInsertRowid };
  }

  const timestamp = Date.now();
  const testDeptCode = `ENG_${timestamp}`;
  const testDesigCode = `DEV_${timestamp}`;

  console.log('1. Testing Department CRUD...');
  // Create department
  const dept = await createDepartment({
    workspaceId: ws.id,
    name: 'Software Engineering',
    code: testDeptCode,
    description: 'Core product engineering',
  });
  if (!dept || dept.code !== testDeptCode) throw new Error('FAIL: Department creation failed.');
  console.log(`   PASS: Department created (ID: ${dept.id}, Code: ${dept.code}).`);

  // Test duplicate code constraint
  let dupFailed = false;
  try {
    await createDepartment({
      workspaceId: ws.id,
      name: 'Duplicate Dept',
      code: testDeptCode,
    });
  } catch (err) {
    dupFailed = true;
  }
  if (!dupFailed) throw new Error('FAIL: Duplicate department code did not throw error.');
  console.log('   PASS: Duplicate department code within workspace correctly rejected.');

  // Update department
  const updatedDept = await updateDepartment(dept.id, {
    description: 'Updated engineering description',
  });
  if (updatedDept.description !== 'Updated engineering description') {
    throw new Error('FAIL: Department update failed.');
  }
  console.log('   PASS: Department updated successfully.');

  console.log('2. Testing Designation CRUD...');
  // Create designation
  const desig = await createDesignation({
    workspaceId: ws.id,
    departmentId: dept.id,
    title: 'Senior Full Stack Engineer',
    code: testDesigCode,
    level: 'L5',
    description: 'Senior IC',
  });
  if (!desig || desig.code !== testDesigCode) throw new Error('FAIL: Designation creation failed.');
  console.log(`   PASS: Designation created (ID: ${desig.id}, Title: ${desig.title}).`);

  // Test duplicate designation code
  let desigDupFailed = false;
  try {
    await createDesignation({
      workspaceId: ws.id,
      departmentId: dept.id,
      title: 'Duplicate Title',
      code: testDesigCode,
    });
  } catch (err) {
    desigDupFailed = true;
  }
  if (!desigDupFailed) throw new Error('FAIL: Duplicate designation code did not throw error.');
  console.log('   PASS: Duplicate designation code correctly rejected.');

  // Filter designations by department
  const deptDesigs = await getDesignations({ departmentId: dept.id });
  if (!deptDesigs.some((d) => d.id === desig.id)) {
    throw new Error('FAIL: Designation not returned when filtering by department.');
  }
  console.log('   PASS: Designation filtered by department successfully.');

  console.log('3. Testing Organizational Hierarchy & Cycle Prevention...');
  // Create 3 employees: CEO, Manager, Engineer
  const empCeo = await createEmployee({
    name: 'Test CEO',
    email: `ceo.${timestamp}@example.com`,
    role: 'admin',
    workspace_id: ws.id,
    department_id: dept.id,
    designation_id: desig.id,
  });

  const empMgr = await createEmployee({
    name: 'Test Engineering Manager',
    email: `mgr.${timestamp}@example.com`,
    role: 'developer',
    workspace_id: ws.id,
    department_id: dept.id,
    designation_id: desig.id,
    reporting_manager_id: empCeo.id,
  });

  const empDev = await createEmployee({
    name: 'Test Junior Developer',
    email: `dev.${timestamp}@example.com`,
    role: 'developer',
    workspace_id: ws.id,
    department_id: dept.id,
    designation_id: desig.id,
    reporting_manager_id: empMgr.id,
  });

  console.log(`   PASS: Created hierarchy chain: ${empCeo.name} -> ${empMgr.name} -> ${empDev.name}.`);

  // Test self-reporting prevention
  const selfCheck = await validateManagerAssignment(empMgr.id, empMgr.id);
  if (selfCheck.valid) {
    throw new Error('FAIL: Self-reporting check failed to block manager reporting to self.');
  }
  console.log('   PASS: Self-reporting blocked: ' + selfCheck.error);

  // Test direct circular reporting: CEO -> Manager (CEO is already Manager's manager)
  const directCycle = await validateManagerAssignment(empCeo.id, empMgr.id);
  if (directCycle.valid) {
    throw new Error('FAIL: Direct circular reporting was not blocked!');
  }
  console.log('   PASS: Direct cycle prevented: ' + directCycle.error);

  // Test indirect circular reporting: CEO -> Dev (CEO -> Mgr -> Dev -> CEO)
  const indirectCycle = await validateManagerAssignment(empCeo.id, empDev.id);
  if (indirectCycle.valid) {
    throw new Error('FAIL: Indirect circular reporting was not blocked!');
  }
  console.log('   PASS: Multi-level cycle prevented: ' + indirectCycle.error);

  // Test reporting tree retrieval
  const directUnderMgr = await getDirectReportees(empMgr.id);
  if (directUnderMgr.length !== 1 || directUnderMgr[0].id !== empDev.id) {
    throw new Error('FAIL: Direct reportees for manager incorrect.');
  }
  console.log('   PASS: Direct reportees verified.');

  const indirectUnderCeo = await getIndirectReportees(empCeo.id);
  if (indirectUnderCeo.length !== 2) {
    throw new Error(`FAIL: Indirect reportees for CEO incorrect, expected 2, got ${indirectUnderCeo.length}.`);
  }
  console.log(`   PASS: Indirect reportees for CEO verified (count: ${indirectUnderCeo.length}).`);

  const devHierarchy = await getEmployeeHierarchy(empDev.id);
  if (devHierarchy.managersChain.length !== 2) {
    throw new Error(`FAIL: Developer managers chain length expected 2, got ${devHierarchy.managersChain.length}.`);
  }
  console.log(`   PASS: Upward management chain for developer verified (${devHierarchy.managersChain.map(m => m.name).join(' -> ')}).`);

  const tree = await getReportingTree({ workspaceId: ws.id });
  if (!tree.roots || tree.roots.length === 0) {
    throw new Error('FAIL: Reporting tree roots empty.');
  }
  console.log(`   PASS: Global reporting tree verified (Total active employees: ${tree.totalEmployees}, Max depth: ${tree.maxDepth}).`);

  console.log('4. Testing Safe Deletion Rules...');
  // Attempt to delete department while employees are assigned -> must fail
  let deptDeleteBlocked = false;
  try {
    await deleteDepartment(dept.id);
  } catch (err) {
    deptDeleteBlocked = true;
    console.log(`   PASS: Safe deletion blocked department deletion: ${err.message}`);
  }
  if (!deptDeleteBlocked) throw new Error('FAIL: Department with assigned employees was deleted without error!');

  // Attempt to delete designation while employees are assigned -> must fail
  let desigDeleteBlocked = false;
  try {
    await deleteDesignation(desig.id);
  } catch (err) {
    desigDeleteBlocked = true;
    console.log(`   PASS: Safe deletion blocked designation deletion: ${err.message}`);
  }
  if (!desigDeleteBlocked) throw new Error('FAIL: Designation with assigned employees was deleted without error!');

  console.log('5. Cleaning up test employees, designation, and department...');
  await deleteEmployee(empDev.id);
  await deleteEmployee(empMgr.id);
  await deleteEmployee(empCeo.id);
  await deleteDesignation(desig.id);
  await deleteDepartment(dept.id);
  console.log('   PASS: Test data cleanly purged.');

  console.log('\n--- ALL PHASE 2 TESTS PASSED SUCCESSFULLY ---');
}

runPhase2Tests().catch((err) => {
  console.error('\nTEST FAILED:', err);
  process.exit(1);
});


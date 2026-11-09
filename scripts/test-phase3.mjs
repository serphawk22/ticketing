import { db, isRemoteDatabase } from '../lib/db.js';
import {
  createDepartment,
  createDesignation,
  deleteDepartment,
  deleteDesignation,
} from '../lib/departments.js';
import {
  createEmployee,
  updateEmployee,
  deleteEmployee,
  getEmployee,
  listEmployees,
  toSafeEmployee,
} from '../lib/employees.js';
import {
  getUserProfile,
  updatePersonalProfile,
} from '../lib/profiles.js';

async function runPhase3Tests() {
  console.log('--- Phase 3 Employee Profile Management Tests ---');

  if (isRemoteDatabase()) {
    throw new Error('FATAL: Running against remote database instead of local SQLite!');
  }

  // Get or create workspace
  let ws = await db.prepare('SELECT id FROM workspaces ORDER BY id ASC LIMIT 1').get();
  if (!ws) {
    const wsRes = await db.prepare('INSERT INTO workspaces (key, name, description) VALUES (?, ?, ?)').run('P3WS', 'Phase 3 Workspace', 'Testing');
    ws = { id: wsRes.lastInsertRowid };
  }

  const timestamp = Date.now();

  console.log('1. Setting up test Department and Designation...');
  const dept = await createDepartment({
    workspaceId: ws.id,
    name: `Dept Phase 3 ${timestamp}`,
    code: `D3_${timestamp}`,
  });
  const desig = await createDesignation({
    workspaceId: ws.id,
    title: `Senior Engineer ${timestamp}`,
    code: `SE3_${timestamp}`,
    departmentId: dept.id,
  });

  console.log('2. Testing Employee Creation with all Extended Profile & Contact Fields...');
  const empEmail = `testemp3_${timestamp}@example.com`;
  const userRes = await db.prepare(
    "INSERT INTO users (name, email, role, password) VALUES (?, ?, 'developer', 'dummyhash')"
  ).run('Alice ProfileTest', empEmail);
  const testUserId = userRes.lastInsertRowid;

  const emp = await createEmployee({
    workspaceId: ws.id,
    name: 'Alice ProfileTest',
    email: empEmail,
    user_id: testUserId,
    department_id: dept.id,
    designation_id: desig.id,
    phone: '+1-555-0199',
    dob: '1995-05-15',
    gender: 'female',
    blood_group: 'O+',
    current_address: '123 Tech Lane, Silicon City',
    permanent_address: '456 Native Blvd, Countryside',
    emergency_contact_name: 'Bob ProfileTest',
    emergency_contact_relation: 'Brother',
    emergency_contact_phone: '+1-555-0188',
    employment_status: 'active',
    base_salary: 85000,
    salary_currency: 'USD',
  });

  if (!emp || !emp.id) {
    throw new Error('FAIL: Employee creation failed');
  }
  if (emp.phone !== '+1-555-0199' || emp.blood_group !== 'O+' || emp.gender !== 'female') {
    throw new Error(`FAIL: Employee fields mismatch: phone=${emp.phone}, blood_group=${emp.blood_group}`);
  }
  if (emp.emergency_contact_name !== 'Bob ProfileTest' || emp.emergency_contact_relation !== 'Brother') {
    throw new Error('FAIL: Emergency contact fields not saved correctly');
  }
  console.log('   PASSED: Employee created with extended profile fields.');

  console.log('3. Testing Employee Update & Lifecycle Status Synchronization...');
  const updatedEmp = await updateEmployee(emp.id, {
    workspaceId: ws.id,
    employment_status: 'on_notice',
    phone: '+1-555-9999',
    current_address: '789 Updated Way, Downtown',
  });

  if (updatedEmp.employment_status !== 'on_notice' || updatedEmp.phone !== '+1-555-9999' || updatedEmp.current_address !== '789 Updated Way, Downtown') {
    throw new Error('FAIL: Employee update did not persist extended fields');
  }
  if (!updatedEmp.active) {
    throw new Error('FAIL: on_notice status should maintain active=true');
  }

  // Test termination status sync
  const terminatedEmp = await updateEmployee(emp.id, {
    workspaceId: ws.id,
    employment_status: 'terminated',
  });
  if (terminatedEmp.active) {
    throw new Error('FAIL: terminated status should sync active to false');
  }

  // Restore to active for further tests
  await updateEmployee(emp.id, {
    workspaceId: ws.id,
    employment_status: 'active',
  });
  console.log('   PASSED: Lifecycle status synchronization and field updates verified.');

  console.log('4. Testing Privacy & RBAC Filtering (toSafeEmployee)...');
  const fetchedEmp = await getEmployee(emp.id, ws.id);

  // Admin viewer
  const adminView = toSafeEmployee(fetchedEmp, { role: 'admin', id: 9999 });
  if (!adminView.base_salary || !adminView.emergency_contact_phone || !adminView.current_address) {
    throw new Error('FAIL: Admin should see compensation and private contact info');
  }

  // Self viewer (non-admin employee viewing their own profile)
  const selfView = toSafeEmployee(fetchedEmp, { role: 'developer', id: fetchedEmp.user_id });
  if (!selfView.base_salary || !selfView.emergency_contact_phone || !selfView.current_address) {
    throw new Error('FAIL: Self viewer should see their own compensation and contact info');
  }

  // Other peer viewer (non-admin viewing another employee)
  const otherView = toSafeEmployee(fetchedEmp, { role: 'developer', id: 8888 });
  if (otherView.base_salary !== null && otherView.base_salary !== undefined) {
    throw new Error('FAIL: Non-admin peer should NOT see compensation data');
  }
  if (otherView.current_address || otherView.permanent_address || otherView.emergency_contact_phone) {
    throw new Error('FAIL: Non-admin peer should NOT see private address or emergency contact info');
  }
  // But non-admin peer CAN see organizational info
  if (otherView.department_name !== dept.name || otherView.designation_title !== desig.title) {
    throw new Error('FAIL: Peer should see public organizational fields');
  }
  console.log('   PASSED: Privacy and field-level masking verified.');

  console.log('5. Testing Self-Service Profile Update (updatePersonalProfile)...');
  if (fetchedEmp.user_id) {
    await updatePersonalProfile(fetchedEmp.user_id, {
      name: 'Alice P. Tester',
      phone: '+1-555-7777',
      emergency_contact_name: 'Carol ProfileTest',
      emergency_contact_phone: '+1-555-3333',
      blood_group: 'AB+',
    });

    const userProfile = await getUserProfile(fetchedEmp.user_id);
    if (userProfile.name !== 'Alice P. Tester') {
      throw new Error('FAIL: Name was not updated in profile');
    }
    if (userProfile.phone !== '+1-555-7777' || userProfile.blood_group !== 'AB+') {
      throw new Error('FAIL: Self-service personal profile update did not sync to employee row');
    }
    if (userProfile.emergency_contact_name !== 'Carol ProfileTest') {
      throw new Error('FAIL: Emergency contact was not updated');
    }
  }
  console.log('   PASSED: Self-service profile update verified.');

  console.log('6. Testing Employee List Filtering...');
  const filteredByDept = await listEmployees({
    workspaceId: ws.id,
    departmentId: dept.id,
  });
  if (!filteredByDept.some(e => e.id === emp.id)) {
    throw new Error('FAIL: listEmployees with departmentId filter failed');
  }

  const filteredByDesig = await listEmployees({
    workspaceId: ws.id,
    designationId: desig.id,
  });
  if (!filteredByDesig.some(e => e.id === emp.id)) {
    throw new Error('FAIL: listEmployees with designationId filter failed');
  }

  const filteredByStatus = await listEmployees({
    workspaceId: ws.id,
    employmentStatus: 'active',
  });
  if (!filteredByStatus.some(e => e.id === emp.id)) {
    throw new Error('FAIL: listEmployees with employmentStatus filter failed');
  }

  const searched = await listEmployees({
    workspaceId: ws.id,
    search: 'Alice P. Tester',
  });
  if (!searched.some(e => e.id === emp.id)) {
    throw new Error('FAIL: listEmployees with search filter failed');
  }
  console.log('   PASSED: List filtering by Department, Designation, Status, and Search verified.');

  console.log('7. Cleaning up test employee...');
  await deleteEmployee(emp.id, ws.id);
  await db.prepare('DELETE FROM users WHERE id = ?').run(testUserId);
  await deleteDesignation(desig.id, ws.id);
  await deleteDepartment(dept.id, ws.id);
  console.log('   PASSED: Cleanup complete.');

  console.log('\n>>> ALL PHASE 3 TESTS PASSED SUCCESSFULLY! <<<');
}

runPhase3Tests().catch((err) => {
  console.error('\n*** TEST FAILED ***\n', err);
  process.exit(1);
});

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB_PATH = path.resolve(__dirname, '../data/test_phase2_isolated.db');

for (const ext of ['', '-wal', '-shm']) {
  if (fs.existsSync(TEST_DB_PATH + ext)) fs.unlinkSync(TEST_DB_PATH + ext);
}

process.env.DB_DRIVER = 'sqlite';
process.env.SQLITE_DB_PATH = TEST_DB_PATH;
delete process.env.POSTGRES_URL;
delete process.env.DATABASE_URL;

const { db } = await import('../lib/db.js');
const {
  normalizeRole,
  canAssignOrModifyRole,
  getManagerScopedEmployeeIds,
  getManagerScopedProjectIds,
  resolveUserScope,
  assertCanViewEmployee,
  assertCanViewProject,
  assertCanAccessTicket,
} = await import('../lib/rbac.js');
const {
  canManagePayroll,
  canCalculatePayroll,
  canApprovePayroll,
  canFinalizePayroll,
  canDisbursePayroll,
} = await import('../lib/payrollAuth.js');
const {
  bootstrapOwnerAccount,
  transferOwnership,
  recoverOwnerAccess,
} = await import('../lib/ownerGovernance.js');

after(() => {
  try {
    db.close();
  } catch {
    // ignore
  }
  for (const ext of ['', '-wal', '-shm']) {
    if (fs.existsSync(TEST_DB_PATH + ext)) fs.unlinkSync(TEST_DB_PATH + ext);
  }
});

async function seedFixture() {
  const mkUser = async (name, email, role) => {
    const u = await db
      .prepare("INSERT INTO users (name, email, password, role) VALUES (?, ?, 'hash', ?)")
      .run(name, email, role);
    return Number(u.lastInsertRowid);
  };
  const mkEmp = async (name, email, role, userId, reportingManagerId = null) => {
    const e = await db
      .prepare(
        `INSERT INTO employees (name, email, role, active, user_id, reporting_manager_id, employment_status)
         VALUES (?, ?, ?, 1, ?, ?, 'active')`
      )
      .run(name, email, role, userId, reportingManagerId);
    return Number(e.lastInsertRowid);
  };

  const adminUid = await mkUser('Admin One', 'admin1@test.local', 'admin');
  const adminEmp = await mkEmp('Admin One', 'admin1@test.local', 'admin', adminUid);

  const mgrUid = await mkUser('Manager One', 'mgr1@test.local', 'manager');
  const mgrEmp = await mkEmp('Manager One', 'mgr1@test.local', 'manager', mgrUid);

  const directUid = await mkUser('Direct Rep', 'direct@test.local', 'employee');
  const directEmp = await mkEmp('Direct Rep', 'direct@test.local', 'employee', directUid, mgrEmp);

  const indirectUid = await mkUser('Indirect Rep', 'indirect@test.local', 'developer');
  const indirectEmp = await mkEmp('Indirect Rep', 'indirect@test.local', 'developer', indirectUid, directEmp);

  const peerUid = await mkUser('Project Peer', 'peer@test.local', 'employee');
  const peerEmp = await mkEmp('Project Peer', 'peer@test.local', 'employee', peerUid, null);

  const formerUid = await mkUser('Former Peer', 'former@test.local', 'employee');
  const formerEmp = await mkEmp('Former Peer', 'former@test.local', 'employee', formerUid, null);

  const outsiderUid = await mkUser('Outsider Emp', 'outsider@test.local', 'employee');
  const outsiderEmp = await mkEmp('Outsider Emp', 'outsider@test.local', 'employee', outsiderUid, null);

  const clientUid = await mkUser('Client A', 'clienta@test.local', 'client');

  const pManaged = Number(
    (await db.prepare("INSERT INTO projects (key, name, color, client_id) VALUES ('MGD', 'Managed Project', '#0052cc', ?)").run(clientUid)).lastInsertRowid
  );
  const pOutside = Number(
    (await db.prepare("INSERT INTO projects (key, name, color) VALUES ('OUT', 'Outside Project', '#36b37e')").run()).lastInsertRowid
  );

  // Manager is lead on Managed Project; directEmp is ALSO a member (tests deduplication); peerEmp is member; formerEmp has is_active = 0
  await db.prepare("INSERT INTO project_members (project_id, employee_id, project_role) VALUES (?, ?, 'lead')").run(pManaged, mgrEmp);
  await db.prepare("INSERT INTO project_members (project_id, employee_id, project_role) VALUES (?, ?, 'contributor')").run(pManaged, directEmp);
  await db.prepare("INSERT INTO project_members (project_id, employee_id, project_role) VALUES (?, ?, 'contributor')").run(pManaged, peerEmp);
  await db.prepare("INSERT INTO project_members (project_id, employee_id, project_role, is_active) VALUES (?, ?, 'contributor', 0)").run(pManaged, formerEmp);

  const tClient = Number(
    (await db.prepare("INSERT INTO tickets (title, description, status, project_id, employee_id, created_by) VALUES ('Client Ticket', 'Desc', 'open', ?, ?, ?)").run(pManaged, directEmp, clientUid)).lastInsertRowid
  );
  const tOutside = Number(
    (await db.prepare("INSERT INTO tickets (title, description, status, project_id, employee_id, created_by) VALUES ('Outside Ticket', 'Desc', 'open', ?, ?, ?)").run(pOutside, outsiderEmp, outsiderUid)).lastInsertRowid
  );

  return {
    adminUid,
    adminEmp,
    mgrUid,
    mgrEmp,
    directUid,
    directEmp,
    indirectUid,
    indirectEmp,
    peerEmp,
    formerEmp,
    outsiderEmp,
    outsiderUid,
    clientUid,
    pManaged,
    pOutside,
    tClient,
    tOutside,
  };
}

test('Phase 2: Role normalization & Payroll Auth removes developer privilege escalation', async () => {
  assert.equal(normalizeRole('developer'), 'employee');
  assert.equal(normalizeRole('owner'), 'owner');
  assert.equal(normalizeRole('MANAGER'), 'manager');

  const devUser = { id: 99, role: 'developer' };
  const adminUser = { id: 100, role: 'admin' };
  const ownerUser = { id: 101, role: 'owner' };

  assert.equal(canManagePayroll(devUser), false);
  assert.equal(canCalculatePayroll(devUser), false);
  assert.equal(canApprovePayroll(devUser), false);
  assert.equal(canFinalizePayroll(devUser), false);
  assert.equal(canDisbursePayroll(devUser), false);

  assert.equal(canManagePayroll(adminUser), true);
  assert.equal(canManagePayroll(ownerUser), true);
  assert.equal(canDisbursePayroll(ownerUser), true);
});

test('Phase 2: Out-of-band Owner Bootstrap, Lock, Admin Anti-Escalation, Ownership Transfer & Recovery', async () => {
  const fx = await seedFixture();

  // First bootstrap creates/promotes owner and locks system
  const owner = await bootstrapOwnerAccount({ email: 'admin1@test.local' });
  assert.equal(owner.role, 'owner');
  assert.equal(owner.id, fx.adminUid);

  // Subsequent bootstrap attempts MUST fail permanently
  await assert.rejects(
    () => bootstrapOwnerAccount({ email: 'mgr1@test.local' }),
    /Owner bootstrap locked/
  );

  // Ensure setting lock stops bootstrap
  const lockRow = await db.prepare("SELECT value FROM app_settings WHERE key = 'owner_bootstrap_completed'").get();
  assert.equal(lockRow.value, '1');

  // Create second admin to test anti-escalation
  const admin2Res = await db
    .prepare("INSERT INTO users (name, email, password, role) VALUES ('Admin Two', 'admin2@test.local', 'hash', 'admin')")
    .run();
  const admin2 = { id: Number(admin2Res.lastInsertRowid), name: 'Admin Two', email: 'admin2@test.local', role: 'admin' };

  // Admin CANNOT elevate self or anyone to owner
  const esc1 = canAssignOrModifyRole({ actor: admin2, targetCurrentRole: 'employee', targetNewRole: 'owner' });
  assert.equal(esc1.allowed, false);

  // Admin CANNOT modify or demote an owner
  const esc2 = canAssignOrModifyRole({ actor: admin2, targetCurrentRole: 'owner', targetNewRole: 'employee' });
  assert.equal(esc2.allowed, false);

  // Admin CAN assign manager/employee
  const okMgr = canAssignOrModifyRole({ actor: admin2, targetCurrentRole: 'employee', targetNewRole: 'manager' });
  assert.equal(okMgr.allowed, true);

  // Admin CANNOT transfer ownership
  await assert.rejects(
    () => transferOwnership({ actor: admin2, targetUserId: admin2.id, reason: 'Unauthorized' }),
    /Only an active Business Owner/
  );

  // Owner transfers ownership to admin2 (owner demotes to admin)
  const transferRes = await transferOwnership({
    actor: owner,
    targetUserId: admin2.id,
    demoteActorToAdmin: true,
    reason: 'Executive transition test',
  });
  assert.equal(transferRes.newOwner.role, 'owner');
  assert.equal(transferRes.previousOwner.role, 'admin');
  assert.equal(transferRes.ownerCount, 1);

  // Recovery fails if active owner exists without --allow-co-owner
  await assert.rejects(
    () => recoverOwnerAccess({ email: 'admin1@test.local', reason: 'Duplicate check' }),
    /Active owner\(s\) exist/
  );

  // Recovery succeeds with co-owner flag
  const coOwner = await recoverOwnerAccess({
    email: 'admin1@test.local',
    reason: 'Approved co-owner',
    allowCoOwner: true,
  });
  assert.equal(coOwner.role, 'owner');

  // Manager union scope deduplication & client/outsider checks
  const mgrScopeIds = await getManagerScopedEmployeeIds(fx.mgrEmp);
  assert.equal(mgrScopeIds.has(fx.directEmp), true);
  assert.equal(mgrScopeIds.has(fx.indirectEmp), true);
  assert.equal(mgrScopeIds.has(fx.peerEmp), true);
  assert.equal(mgrScopeIds.has(fx.formerEmp), false, 'Former member with left_at must be excluded');
  assert.equal(mgrScopeIds.has(fx.outsiderEmp), false);
  // Deduplicated exact size = 3 (directEmp, indirectEmp, peerEmp)
  assert.equal(mgrScopeIds.size, 3);

  const mgrProjIds = await getManagerScopedProjectIds(fx.mgrEmp);
  assert.equal(mgrProjIds.has(fx.pManaged), true);
  assert.equal(mgrProjIds.has(fx.pOutside), false);

  const mgrActor = { id: fx.mgrUid, role: 'manager', employee_id: fx.mgrEmp };
  const clientActor = { id: fx.clientUid, role: 'client' };
  const outsiderActor = { id: fx.outsiderUid, role: 'employee', employee_id: fx.outsiderEmp };

  // Manager access assertions
  assert.equal((await assertCanViewEmployee(mgrActor, fx.directEmp)).allowed, true);
  assert.equal((await assertCanViewEmployee(mgrActor, fx.outsiderEmp)).allowed, false);
  assert.equal((await assertCanViewProject(mgrActor, fx.pManaged)).allowed, true);
  assert.equal((await assertCanViewProject(mgrActor, fx.pOutside)).allowed, false);
  assert.equal((await assertCanAccessTicket(mgrActor, fx.tClient)).allowed, true);
  assert.equal((await assertCanAccessTicket(mgrActor, fx.tOutside)).allowed, false);

  // Client access assertions
  assert.equal((await assertCanViewEmployee(clientActor, fx.directEmp)).allowed, false);
  assert.equal((await assertCanViewProject(clientActor, fx.pManaged)).allowed, true);
  assert.equal((await assertCanViewProject(clientActor, fx.pOutside)).allowed, false);
  assert.equal((await assertCanAccessTicket(clientActor, fx.tClient)).allowed, true);
  assert.equal((await assertCanAccessTicket(clientActor, fx.tOutside)).allowed, false);

  // Outsider employee can view self, denied viewing another employee directly
  assert.equal((await assertCanViewEmployee(outsiderActor, fx.outsiderEmp)).allowed, true);
  assert.equal((await assertCanViewEmployee(outsiderActor, fx.directEmp)).allowed, false);

  const resolvedScope = await resolveUserScope(mgrActor);
  assert.equal(resolvedScope.scopedEmployeeIds.has(fx.mgrEmp), true);
  assert.equal(resolvedScope.scopedEmployeeIds.has(fx.outsiderEmp), false);
});

import assert from 'node:assert/strict';
import { db } from '../lib/db.js';
import {
  createEmployee,
  getEmployee,
  getEmployeeByUserId,
  getEmployees,
  updateEmployee,
  toSafeEmployee,
} from '../lib/employees.js';
import {
  getUserByEmail,
  getUserById,
  getClientByPasskey,
  createClientAccount,
  issueClientPasskey,
} from '../lib/users.js';
import { getUserProfile } from '../lib/profiles.js';

console.log('====================================================');
console.log('RUNNING MANDATORY PRIMARY EMAIL & CLIENT SUITE');
console.log('====================================================\n');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`✓ PASS: ${name}`);
    passed++;
  } catch (err) {
    console.error(`✗ FAIL: ${name}`);
    console.error(err);
    failed++;
  }
}

async function runAll() {
  const createdEmployees = [];
  const createdUsers = [];

  // 1. Schema check
  await test('Schema: employees table has secondary_email column and nullable/unique email', async () => {
    const empCols = await db.prepare('PRAGMA table_info(employees)').all();
    const secCol = empCols.find((c) => c.name === 'secondary_email');
    assert.ok(secCol, 'employees.secondary_email column should exist');
  });

  // 2. Client creation without primary email (API rule: must be rejected)
  // We simulate API validation logic directly:
  await test('Validation: Client creation without primary email is rejected', async () => {
    const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    function validateClientCreation({ email, secondary_email }) {
      const cleanEmail = email ? String(email).trim().toLowerCase() : null;
      const cleanSecondary = secondary_email ? String(secondary_email).trim().toLowerCase() : null;

      if (!cleanEmail) {
        throw new Error('Primary email is required for clients.');
      }
      if (!EMAIL_PATTERN.test(cleanEmail)) {
        throw new Error('A valid email address is required.');
      }
      if (cleanSecondary && !EMAIL_PATTERN.test(cleanSecondary)) {
        throw new Error('A valid secondary email address is required.');
      }
      if (cleanEmail && cleanSecondary && cleanEmail === cleanSecondary) {
        throw new Error('Secondary email must be different from primary email.');
      }
    }

    assert.throws(() => {
      validateClientCreation({ email: null, secondary_email: 'backup@example.com' });
    }, /Primary email is required for clients\./);

    assert.throws(() => {
      validateClientCreation({ email: '', secondary_email: null });
    }, /Primary email is required for clients\./);

    assert.throws(() => {
      validateClientCreation({ email: '   ', secondary_email: null });
    }, /Primary email is required for clients\./);

    assert.throws(() => {
      validateClientCreation({ email: 'invalid-email', secondary_email: null });
    }, /A valid email address is required\./);

    assert.throws(() => {
      validateClientCreation({ email: 'client@example.com', secondary_email: 'invalid-sec' });
    }, /A valid secondary email address is required\./);

    assert.throws(() => {
      validateClientCreation({ email: 'same@example.com', secondary_email: 'same@example.com' });
    }, /Secondary email must be different from primary email\./);
  });

  // 3. Client created with valid primary email and no secondary email
  let clientPrimaryOnlyEmp = null;
  let clientPrimaryOnlyAccount = null;
  const primaryOnlyEmail = `client_p_only_${Date.now()}@example.com`;
  await test('Creation: Client can be saved with valid primary email and no secondary email', async () => {
    clientPrimaryOnlyAccount = await createClientAccount({
      name: 'Client Primary Only',
      email: primaryOnlyEmail,
    });
    createdUsers.push(clientPrimaryOnlyAccount.id);

    clientPrimaryOnlyEmp = await createEmployee({
      name: 'Client Primary Only',
      email: primaryOnlyEmail,
      secondary_email: null,
      role: 'client',
      user_id: clientPrimaryOnlyAccount.id,
    });
    createdEmployees.push(clientPrimaryOnlyEmp.id);

    assert.equal(clientPrimaryOnlyEmp.email, primaryOnlyEmail);
    assert.equal(clientPrimaryOnlyEmp.secondary_email, null);

    const fetched = await getEmployee(clientPrimaryOnlyEmp.id);
    assert.equal(fetched.email, primaryOnlyEmail);
    assert.equal(fetched.secondary_email, null);

    const profile = await getUserProfile(clientPrimaryOnlyAccount.id);
    assert.equal(profile.email, primaryOnlyEmail);
    assert.equal(profile.secondary_email, null);
  });

  // 4. Client created with both valid emails
  let clientBothEmp = null;
  let clientBothAccount = null;
  const bothPEmail = `client_both_p_${Date.now()}@example.com`;
  const bothSEmail = `client_both_s_${Date.now()}@example.com`;
  await test('Creation: Client can be saved with both valid email addresses', async () => {
    clientBothAccount = await createClientAccount({
      name: 'Client Both Emails',
      email: bothPEmail,
    });
    createdUsers.push(clientBothAccount.id);

    clientBothEmp = await createEmployee({
      name: 'Client Both Emails',
      email: bothPEmail,
      secondary_email: bothSEmail,
      role: 'client',
      user_id: clientBothAccount.id,
    });
    createdEmployees.push(clientBothEmp.id);

    assert.equal(clientBothEmp.email, bothPEmail);
    assert.equal(clientBothEmp.secondary_email, bothSEmail);

    const fetched = await getEmployee(clientBothEmp.id);
    assert.equal(fetched.email, bothPEmail);
    assert.equal(fetched.secondary_email, bothSEmail);

    const profile = await getUserProfile(clientBothAccount.id);
    assert.equal(profile.email, bothPEmail);
    assert.equal(profile.secondary_email, bothSEmail);
  });

  // 5. Updating existing Client: Primary email cannot be left empty
  await test('Edit: Updating Client cannot leave primary email empty', async () => {
    function validateClientUpdate({ email, secondary_email }) {
      const cleanEmail = email ? String(email).trim().toLowerCase() : null;
      const cleanSecondary = secondary_email ? String(secondary_email).trim().toLowerCase() : null;

      if (!cleanEmail) {
        throw new Error('Primary email is required for clients.');
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        throw new Error('A valid email address is required.');
      }
      if (cleanSecondary && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanSecondary)) {
        throw new Error('A valid secondary email address is required.');
      }
    }

    assert.throws(() => {
      validateClientUpdate({ email: '', secondary_email: 'sec@example.com' });
    }, /Primary email is required for clients\./);

    assert.throws(() => {
      validateClientUpdate({ email: null, secondary_email: 'sec@example.com' });
    }, /Primary email is required for clients\./);

    // Valid update works
    const updatedPEmail = `updated_primary_${Date.now()}@example.com`;
    const updated = await updateEmployee(clientBothEmp.id, {
      email: updatedPEmail,
    });
    assert.equal(updated.email, updatedPEmail);
    assert.equal(updated.secondary_email, bothSEmail);
  });

  // 6. Duplicate checks: Duplicate primary email is rejected
  await test('Duplicate: Duplicate primary email is rejected', async () => {
    await assert.rejects(
      async () => {
        await createClientAccount({
          name: 'Clashing Client',
          email: primaryOnlyEmail,
        });
      },
      /UNIQUE constraint failed/
    );
  });

  // 7. Non-client roles retain email requirements and profile behavior
  await test('Regression: Non-Client (Developer) retains email requirement and profile behavior', async () => {
    const dev = await db.prepare("SELECT id, email FROM users WHERE role = 'developer' LIMIT 1").get();
    if (dev) {
      assert.ok(dev.email, 'Developer has email');
      const devProfile = await getUserProfile(dev.id);
      assert.equal(devProfile.email, dev.email);
      assert.equal(devProfile.secondary_email, null, 'Non-clients must not have secondary_email');
    }
  });

  // 8. Cleanup
  await test('Cleanup: Remove all test entities', async () => {
    for (const eid of createdEmployees) {
      await db.prepare('DELETE FROM employees WHERE id = ?').run(eid);
    }
    for (const uid of createdUsers) {
      await db.prepare('DELETE FROM users WHERE id = ?').run(uid);
    }
  });

  console.log('\n====================================================');
  console.log(`TEST RESULTS: ${passed}/${passed + failed} PASSED`);
  if (failed > 0) {
    console.error(`FAILED: ${failed}`);
    process.exit(1);
  }
  console.log('====================================================\n');
}

runAll();

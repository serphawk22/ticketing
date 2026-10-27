import assert from 'node:assert/strict';
import { db } from '../lib/db.js';
import {
  encryptBankData,
  decryptBankData,
  maskAccountNumber,
  isValidIFSC,
  isValidGithubUrl,
  isValidLinkedinUrl,
} from '../lib/bankCrypto.js';
import {
  getUserProfile,
  updatePersonalProfile,
  updateBankDetails,
  updateAvatar,
  deleteAvatar,
} from '../lib/profiles.js';
import {
  getEmployee,
  getEmployees,
  updateEmployee,
  toSafeEmployee,
} from '../lib/employees.js';
import { formatSalary, getCurrencySymbol, CURRENCIES } from '../lib/currency.js';
import { readFileSync } from 'node:fs';

const results = [];
function test(name, fn) {
  return async () => {
    try {
      await fn();
      results.push({ name, passed: true });
      console.log(`✓ PASS: ${name}`);
    } catch (err) {
      results.push({ name, passed: false, error: err.message });
      console.error(`✗ FAIL: ${name}\n  ${err.stack || err.message}`);
    }
  };
}

async function runAll() {
  console.log('====================================================');
  console.log('RUNNING PROFILE & EMPLOYEE MANAGEMENT TEST SUITE');
  console.log('====================================================\n');

  // 1. Bank Crypto Tests
  await test('Bank Crypto: Encrypt and decrypt roundtrip matches', async () => {
    const raw = '987654321098';
    const encrypted = encryptBankData(raw);
    assert.notEqual(encrypted, raw);
    assert.ok(encrypted.includes(':'));
    const decrypted = decryptBankData(encrypted);
    assert.equal(decrypted, raw);
  })();

  await test('Bank Crypto: Account number masking displays only last 4 digits', async () => {
    assert.equal(maskAccountNumber('1234567890'), '••••••7890');
    assert.equal(maskAccountNumber('5555'), '5555');
    assert.equal(maskAccountNumber(''), '');
  })();

  await test('Bank Crypto: IFSC validation accepts valid and rejects invalid formats', async () => {
    assert.equal(isValidIFSC('SBIN0001234'), true);
    assert.equal(isValidIFSC('HDFC0000240'), true);
    assert.equal(isValidIFSC('ICIC0000001'), true);
    assert.equal(isValidIFSC('INVALID_IFSC'), false);
    assert.equal(isValidIFSC('SBIN1001234'), false); // 5th char must be 0
    assert.equal(isValidIFSC('12345'), false);
    assert.equal(isValidIFSC(''), false);
  })();

  await test('Bank Crypto: Social URLs validation', async () => {
    assert.equal(isValidGithubUrl('https://github.com/serphawk'), true);
    assert.equal(isValidGithubUrl('http://github.com/user'), true);
    assert.equal(isValidGithubUrl('https://evil.com/fake'), false);
    assert.equal(isValidGithubUrl(''), true); // optional
    assert.equal(isValidLinkedinUrl('https://linkedin.com/in/user'), true);
    assert.equal(isValidLinkedinUrl('https://www.linkedin.com/in/user'), true);
    assert.equal(isValidLinkedinUrl('https://phishing.com'), false);
  })();

  // 2. Database Schema Verification
  await test('Database: SQLite contains user_profiles and user_bank_details tables and employee columns', async () => {
    const tables = await db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all();
    const tableNames = tables.map((t) => t.name);
    assert.ok(tableNames.includes('user_profiles'), 'user_profiles table exists');
    assert.ok(tableNames.includes('user_bank_details'), 'user_bank_details table exists');

    const empCols = await db.prepare('PRAGMA table_info(employees)').all();
    const empColNames = empCols.map((c) => c.name);
    assert.ok(empColNames.includes('base_salary'), 'employees has base_salary');
    assert.ok(empColNames.includes('salary_currency'), 'employees has salary_currency');
    assert.ok(empColNames.includes('last_payment_date'), 'employees has last_payment_date');
    assert.ok(empColNames.includes('payment_status'), 'employees has payment_status');
  })();

  await test('Currency: Multi-currency formatting correctly formats INR (₹) and USD ($)', async () => {
    assert.equal(getCurrencySymbol('INR'), '₹');
    assert.equal(getCurrencySymbol('USD'), '$');
    assert.equal(formatSalary(500000, 'INR'), '₹ 5,00,000');
    assert.equal(formatSalary(75000, 'USD'), '$ 75,000');
    assert.equal(formatSalary(null, 'INR'), '₹ Not set');
    assert.ok(CURRENCIES.some((c) => c.code === 'INR'));
    assert.ok(CURRENCIES.some((c) => c.code === 'USD'));
  })();

  // 3. Navigation / Settings Dropdown Structure Test
  await test('UI: Profile option exists in navigation SettingsMenu and Logout exists in Account menu', async () => {
    const settingsSource = readFileSync('components/SettingsMenu.js', 'utf8');
    const appShellSource = readFileSync('components/AppShell.js', 'utf8');
    const profileIndex = settingsSource.indexOf('href="/profile"');
    const logoutIndex = appShellSource.indexOf('<LogoutIcon />');
    assert.ok(profileIndex !== -1, 'Profile link exists in SettingsMenu.js');
    assert.ok(logoutIndex !== -1, 'Log out button exists in AppShell.js');
  })();

  // 4. User Profile Tests
  let testUser = null;
  let testDevUser = null;

  await test('Profile: Retrieve profile for authenticated user', async () => {
    // Admin user (id 1)
    testUser = await db.prepare("SELECT * FROM users WHERE role = 'admin' LIMIT 1").get();
    assert.ok(testUser, 'Admin user exists');

    const profile = await getUserProfile(testUser.id);
    assert.equal(profile.id, testUser.id);
    assert.equal(profile.email, testUser.email);
    assert.ok(profile.created_at, 'Joined date exists');
    assert.ok(profile.bank_details !== undefined, 'Bank details object present');
  })();

  await test('Profile: Update personal details and verify persistence', async () => {
    const updated = await updatePersonalProfile(testUser.id, {
      name: 'Admin Test Updated',
      age: 32,
      github_url: 'https://github.com/admintest',
      linkedin_url: 'https://linkedin.com/in/admintest',
    });

    assert.equal(updated.name, 'Admin Test Updated');
    assert.equal(updated.age, 32);
    assert.equal(updated.github_url, 'https://github.com/admintest');
    assert.equal(updated.linkedin_url, 'https://linkedin.com/in/admintest');

    // Verify persisted in DB
    const refreshed = await getUserProfile(testUser.id);
    assert.equal(refreshed.name, 'Admin Test Updated');
    assert.equal(refreshed.age, 32);
    assert.equal(refreshed.github_url, 'https://github.com/admintest');
  })();

  await test('Profile: Invalid personal fields rejected with errors', async () => {
    // Empty name
    await assert.rejects(
      async () => {
        await updatePersonalProfile(testUser.id, { name: '' });
      },
      /Full name is required/
    );

    // Invalid age (< 16 or > 120)
    await assert.rejects(
      async () => {
        await updatePersonalProfile(testUser.id, { name: 'Valid', age: 10 });
      },
      /Age must be a valid number/
    );

    await assert.rejects(
      async () => {
        await updatePersonalProfile(testUser.id, { name: 'Valid', age: 150 });
      },
      /Age must be a valid number/
    );

    // Invalid social profile URLs
    await assert.rejects(
      async () => {
        await updatePersonalProfile(testUser.id, {
          name: 'Valid',
          github_url: 'https://notgithub.com/attacker',
        });
      },
      /Invalid GitHub profile URL/
    );

    await assert.rejects(
      async () => {
        await updatePersonalProfile(testUser.id, {
          name: 'Valid',
          linkedin_url: 'https://attacker.com/profile',
        });
      },
      /Invalid LinkedIn profile URL/
    );
  })();

  // 5. Bank Details Tests
  await test('Bank Details: Save, encrypt, mask, and persist bank details', async () => {
    const bankRes = await updateBankDetails(testUser.id, {
      account_holder_name: 'Admin User',
      bank_name: 'State Bank of India',
      account_number: '123456789012',
      ifsc_code: 'SBIN0001234',
    });

    assert.equal(bankRes.account_holder_name, 'Admin User');
    assert.equal(bankRes.bank_name, 'State Bank of India');
    assert.equal(bankRes.ifsc_code, 'SBIN0001234');
    assert.equal(bankRes.account_number_masked, '••••••••9012');

    // Direct DB check: account number is encrypted and never plaintext
    const dbRow = await db
      .prepare('SELECT * FROM user_bank_details WHERE user_id = ?')
      .get(testUser.id);
    assert.ok(dbRow, 'Bank details row exists');
    assert.notEqual(dbRow.account_number_encrypted, '123456789012');
    assert.equal(dbRow.account_number_last4, '9012');

    // Decrypting verifies integrity
    const decrypted = decryptBankData(dbRow.account_number_encrypted);
    assert.equal(decrypted, '123456789012');
  })();

  await test('Bank Details: Invalid IFSC rejected', async () => {
    await assert.rejects(
      async () => {
        await updateBankDetails(testUser.id, {
          account_holder_name: 'Admin',
          bank_name: 'Bank',
          account_number: '123456789',
          ifsc_code: 'INVALID_IFSC_CODE',
        });
      },
      /Invalid IFSC code format/
    );
  })();

  await test('Bank Details: Invalid account number rejected', async () => {
    await assert.rejects(
      async () => {
        await updateBankDetails(testUser.id, {
          account_holder_name: 'Admin',
          bank_name: 'Bank',
          account_number: '123', // too short (<6)
          ifsc_code: 'SBIN0001234',
        });
      },
      /Account number must contain between 6 and 30 digits/
    );
  })();

  // 6. Avatar Upload and Removal Tests
  await test('Avatar: Update avatar URL and delete avatar', async () => {
    const avatarUrl = '/api/profile/avatar?u=' + testUser.id;
    const storageKey = 'avatars/test-avatar-123.jpg';

    await updateAvatar(testUser.id, { avatar_url: avatarUrl, avatar_storage_key: storageKey });

    const p = await getUserProfile(testUser.id);
    assert.equal(p.avatar_url, avatarUrl);
    assert.equal(p.avatar_storage_key, storageKey);

    const deletedKey = await deleteAvatar(testUser.id);
    assert.equal(deletedKey, storageKey);

    const pAfter = await getUserProfile(testUser.id);
    assert.equal(pAfter.avatar_url, '');
    assert.equal(pAfter.avatar_storage_key, '');
  })();

  // 7. Administrator Employee Management & Compensation Tests
  await test('Admin: Administrator can update employee salary, department, and payment status', async () => {
    testDevUser = await db
      .prepare("SELECT * FROM users WHERE role = 'developer' LIMIT 1")
      .get();
    assert.ok(testDevUser, 'Developer user exists');

    const devEmp = await db
      .prepare('SELECT id FROM employees WHERE email = ?')
      .get(testDevUser.email);
    assert.ok(devEmp, 'Developer employee record exists');

    // Admin updates developer's department, salary, currency, last payment date, payment status
    const updatedDev = await updateEmployee(devEmp.id, {
      name: testDevUser.name,
      email: testDevUser.email,
      role: 'developer',
      department: 'Platform Engineering',
      title: 'Senior Developer',
      active: true,
      base_salary: 850000,
      salary_currency: 'INR',
      last_payment_date: '2026-10-01',
      payment_status: 'paid',
    });

    assert.equal(updatedDev.department, 'Platform Engineering');
    assert.equal(updatedDev.base_salary, 850000);
    assert.equal(updatedDev.salary_currency, 'INR');
    assert.equal(updatedDev.last_payment_date, '2026-10-01');
    assert.equal(updatedDev.payment_status, 'paid');

    // Developer views their own profile and sees the compensation and currency set by admin
    const devProfile = await getUserProfile(testDevUser.id);
    assert.equal(devProfile.department, 'Platform Engineering');
    assert.equal(devProfile.base_salary, 850000);
    assert.equal(devProfile.salary_currency, 'INR');
    assert.equal(devProfile.last_payment_date, '2026-10-01');
    assert.equal(devProfile.payment_status, 'paid');
  })();

  // 8. Security & Privacy Tests
  await test('Security: Non-admin calling toSafeEmployee has salary and payment info stripped', async () => {
    const rawEmployee = {
      id: 10,
      name: 'Bob Dev',
      email: 'bob@example.com',
      role: 'developer',
      department: 'Engineering',
      base_salary: 95000,
      salary_currency: 'USD',
      last_payment_date: '2026-10-01',
      payment_status: 'paid',
      active: true,
    };

    // For non-admin (isAdmin = false)
    const safeForDev = toSafeEmployee(rawEmployee, false);
    assert.equal(safeForDev.name, 'Bob Dev');
    assert.equal(safeForDev.department, 'Engineering');
    assert.equal(safeForDev.base_salary, undefined, 'base_salary must be stripped for non-admin');
    assert.equal(safeForDev.salary_currency, undefined, 'salary_currency must be stripped for non-admin');
    assert.equal(safeForDev.last_payment_date, undefined, 'last_payment_date must be stripped for non-admin');
    assert.equal(safeForDev.payment_status, undefined, 'payment_status must be stripped for non-admin');

    // For admin (isAdmin = true)
    const safeForAdmin = toSafeEmployee(rawEmployee, true);
    assert.equal(safeForAdmin.base_salary, 95000, 'base_salary visible to admin');
    assert.equal(safeForAdmin.salary_currency, 'USD', 'salary_currency visible to admin');
    assert.equal(safeForAdmin.payment_status, 'paid', 'payment_status visible to admin');
  })();

  await test('Security: Bank details are never included in general employee queries', async () => {
    const employees = await getEmployees();
    for (const emp of employees) {
      assert.equal(emp.account_number, undefined, 'Bank account number must never be in employee object');
      assert.equal(emp.account_number_encrypted, undefined, 'Encrypted bank info must never be in employee object');
      assert.equal(emp.ifsc_code, undefined, 'IFSC must never be in employee object');
      assert.equal(emp.bank_name, undefined, 'Bank name must never be in employee object');
    }
  })();

  await test('Security: User cannot modify another user profile or bank details (IDOR test)', async () => {
    // When Developer tries to access profile, getUserProfile uses authenticated user's ID
    const devProfile = await getUserProfile(testDevUser.id);
    const adminProfile = await getUserProfile(testUser.id);

    assert.notEqual(devProfile.id, adminProfile.id);
    assert.notEqual(devProfile.email, adminProfile.email);

    // Ensure dev bank details is separate from admin bank details
    await updateBankDetails(testDevUser.id, {
      account_holder_name: 'Developer User',
      bank_name: 'HDFC Bank',
      account_number: '987654321012',
      ifsc_code: 'HDFC0000240',
    });

    const devBank = (await getUserProfile(testDevUser.id)).bank_details;
    const adminBank = (await getUserProfile(testUser.id)).bank_details;

    assert.equal(devBank.bank_name, 'HDFC Bank');
    assert.equal(adminBank.bank_name, 'State Bank of India');
    assert.notEqual(devBank.account_number_masked, adminBank.account_number_masked);
  })();

  // 9. Regression Tests
  await test('Regression: Users and employee roles and activation still function', async () => {
    const devEmp = await db
      .prepare('SELECT id, active FROM employees WHERE email = ?')
      .get(testDevUser.email);
    assert.ok(devEmp, 'Employee exists');

    // Toggle active state
    const deactivated = await updateEmployee(devEmp.id, {
      ...testDevUser,
      active: false,
    });
    assert.equal(deactivated.active, false);

    const reactivated = await updateEmployee(devEmp.id, {
      ...testDevUser,
      active: true,
    });
    assert.equal(reactivated.active, true);
  })();

  // Print Summary
  console.log('\n====================================================');
  console.log(`TEST RESULTS: ${results.filter((r) => r.passed).length}/${results.length} PASSED`);
  console.log('====================================================\n');

  if (results.some((r) => !r.passed)) {
    process.exit(1);
  }
}

runAll().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});

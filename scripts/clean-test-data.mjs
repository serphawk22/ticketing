import { db } from '../lib/db.js';

async function cleanup() {
  console.log('--- Starting Database Cleanup of Test Elements ---');

  // Verify Dev User exists
  const devEmp = await db.prepare("SELECT * FROM employees WHERE email = 'dev@example.com'").get();
  const devUser = await db.prepare("SELECT * FROM users WHERE email = 'dev@example.com'").get();

  if (!devEmp || !devUser) {
    throw new Error('Dev User not found! Aborting cleanup to ensure Dev User is preserved.');
  }

  console.log(`Preserving Dev User: employee id=${devEmp.id}, user id=${devUser.id}, email=${devEmp.email}`);

  const run = (sql, params = []) => db.prepare(sql).run(params);

  // Disable FK temporarily for atomic batch cleanup
  await run('PRAGMA foreign_keys = OFF');

  // 1. Delete test tickets and related items
  console.log('1. Cleaning test tickets, activity, logs, and notifications...');
  await run('DELETE FROM ticket_activity');
  await run('DELETE FROM ticket_time_logs');
  await run('DELETE FROM ticket_comments');
  await run('DELETE FROM ticket_attachments');
  await run('DELETE FROM ticket_relations');
  await run('DELETE FROM ticket_watchers');
  await run('DELETE FROM ticket_votes');
  await run('DELETE FROM ticket_web_links');
  await run('DELETE FROM notifications');
  await run('DELETE FROM email_outbox');
  await run('UPDATE task_sheet_submissions SET linked_ticket_id = NULL');
  await run('DELETE FROM tickets');

  // 2. Delete test exit requests & checklist items
  console.log('2. Cleaning test exit requests and checklist items...');
  await run('DELETE FROM exit_checklist_items');
  await run('DELETE FROM exit_requests');

  // 3. Delete test onboarding workflows & checklist items
  console.log('3. Cleaning test onboarding workflows and checklist items...');
  await run('DELETE FROM onboarding_checklist_items');
  await run('DELETE FROM onboarding_workflows');

  // 4. Delete test asset allocations & test company assets
  console.log('4. Cleaning test assets and allocations...');
  await run('DELETE FROM asset_allocations');
  await run('DELETE FROM company_assets');

  // 5. Delete test employee documents
  console.log('5. Cleaning test employee documents...');
  await run('DELETE FROM employee_documents');

  // 6. Delete test designations & departments
  console.log('6. Cleaning test designations and departments...');
  await run('UPDATE employees SET designation_id = NULL, department_id = NULL, reporting_manager_id = NULL');
  await run('DELETE FROM designations');
  await run('DELETE FROM departments');

  // 7. Delete test leave requests, balances, adjustments, and attendance
  console.log('7. Cleaning test leave records, adjustments, and attendance...');
  await run('DELETE FROM employee_leave_requests WHERE employee_id != ?', [devEmp.id]);
  await run('DELETE FROM leave_balance_adjustments WHERE employee_id != ?', [devEmp.id]);
  await run('DELETE FROM leave_balances WHERE employee_id != ?', [devEmp.id]);
  await run('DELETE FROM employee_attendance WHERE employee_id != ?', [devEmp.id]);
  await run('DELETE FROM attendance_audit_logs WHERE employee_id != ?', [devEmp.id]);

  // 8. Delete test task sheet submissions
  console.log('8. Cleaning test task sheet submissions...');
  await run('DELETE FROM task_sheet_submissions WHERE submitted_by != ?', [devUser.id]);

  // 9. Delete test report schedules
  console.log('9. Cleaning test report schedules...');
  await run('DELETE FROM report_schedules');

  // 10. Clean test audit logs
  console.log('10. Cleaning test audit logs...');
  await run("DELETE FROM audit_logs WHERE action LIKE 'department.%' OR action LIKE 'designation.%' OR action = 'test_audit_event'");

  // 11. Clean test user profiles & test bank details
  console.log('11. Cleaning test user profiles and test bank details...');
  await run('DELETE FROM user_profiles WHERE user_id != ?', [devUser.id]);
  await run('DELETE FROM user_bank_details WHERE user_id != ?', [devUser.id]);

  // 12. Delete all test employees (keeping Dev User and resetting Admin User)
  console.log('12. Cleaning test employees...');
  await run("DELETE FROM employees WHERE email != 'dev@example.com' AND email != 'admin@example.com'");

  // 13. Delete all test users from users table
  console.log('13. Cleaning test users from users table...');
  await run("DELETE FROM users WHERE email != 'dev@example.com' AND email != 'admin@example.com'");
  await run("DELETE FROM users WHERE name LIKE 'TestClient%'");

  // 14. Reset Admin User back to clean canonical default
  console.log('14. Resetting Admin User to clean default seed state...');
  await run("UPDATE users SET name = 'Admin User' WHERE email = 'admin@example.com'");
  await run(`
    UPDATE employees 
    SET name = 'Admin User',
        department = '',
        title = '',
        base_salary = null,
        payment_status = '',
        department_id = null,
        designation_id = null,
        reporting_manager_id = null,
        emergency_contact_name = '',
        emergency_contact_phone = '',
        emergency_contact_relation = '',
        phone = '',
        dob = null,
        gender = '',
        current_address = '',
        permanent_address = '',
        blood_group = ''
    WHERE email = 'admin@example.com'
  `);

  // Re-enable foreign keys
  await run('PRAGMA foreign_keys = ON');

  // Run foreign key integrity check
  const fkErrors = await db.prepare('PRAGMA foreign_key_check').all();
  if (fkErrors.length > 0) {
    console.error('Foreign key check failed:', fkErrors);
    throw new Error('Foreign key integrity violation detected!');
  } else {
    console.log('✓ Foreign key integrity check PASSED (0 violations)');
  }

  console.log('--- Cleanup Finished Successfully ---');
}

cleanup().catch(err => {
  console.error('Error during cleanup:', err);
  process.exit(1);
});

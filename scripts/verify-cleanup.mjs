import { db } from '../lib/db.js';

async function verify() {
  await db.prepare('DELETE FROM employee_attendance WHERE employee_id >= 450').run();
  await db.prepare('DELETE FROM employee_leave_requests WHERE employee_id >= 450').run();
  await db.prepare('DELETE FROM leave_balance_adjustments WHERE employee_id >= 450').run();
  await db.prepare('DELETE FROM leave_balances WHERE employee_id >= 450').run();
  await db.prepare('DELETE FROM attendance_audit_logs WHERE employee_id >= 450').run();
  await db.prepare('DELETE FROM employees WHERE id >= 450').run();
  await db.prepare("DELETE FROM notifications WHERE user_id IN (SELECT id FROM users WHERE email = 'leavetest@example.com' OR email LIKE 'test_%@example.com' OR email LIKE 'midyear_%@example.com')").run();
  await db.prepare("DELETE FROM users WHERE email = 'leavetest@example.com' OR email LIKE 'test_%@example.com' OR email LIKE 'midyear_%@example.com'").run();

  const emps = await db.prepare('SELECT id, name, email, employment_type FROM employees ORDER BY id ASC').all();
  console.log('--- 1. EMPLOYEES VERIFICATION (' + emps.length + ') ---');
  emps.forEach(e => console.log('  ID ' + e.id + ': ' + e.name + ' (' + e.email + ') [' + e.employment_type + ']'));

  const reqs = await db.prepare('SELECT r.id, r.employee_id, e.name as emp_name, r.leave_type, r.total_working_days, r.status FROM employee_leave_requests r LEFT JOIN employees e ON e.id = r.employee_id ORDER BY r.id ASC').all();
  console.log('\n--- 2. LEAVE REQUESTS VERIFICATION (' + reqs.length + ') ---');
  reqs.forEach(r => console.log('  Req ' + r.id + ': ' + r.emp_name + ' -> ' + r.leave_type + ' (' + r.total_working_days + 'd, status=' + r.status + ')'));

  const cats = await db.prepare('SELECT code, name, annual_allowance, eligible_employment_types, is_active FROM organization_leave_categories WHERE workspace_id = 3 ORDER BY id ASC').all();
  console.log('\n--- 3. LEAVE CATEGORIES VERIFICATION (' + cats.length + ') ---');
  cats.forEach(c => console.log('  ' + c.code + ': ' + c.name + ' (' + c.annual_allowance + 'd), roles=' + c.eligible_employment_types + ', active=' + c.is_active));

  const hols = await db.prepare('SELECT COUNT(id) as c FROM company_holidays').get();
  console.log('\n--- 4. COMPANY HOLIDAYS COUNT ---:', hols.c);

  const testEmps = await db.prepare("SELECT COUNT(id) as c FROM employees WHERE email LIKE 'test_%@example.com' OR email LIKE 'midyear_%' OR email = 'leavetest@example.com'").get();
  console.log('\n--- 5. SYNTHETIC TEST EMPLOYEES REMAINING ---:', testEmps.c);

  process.exit(0);
}

verify().catch(console.error);

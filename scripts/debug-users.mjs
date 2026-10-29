import { db } from '../lib/db.js';

async function run() {
  const q = await db.prepare(`
    SELECT u.id as user_id, u.name as user_name, u.email as user_email, u.role,
           e.id as emp_id, e.name as emp_name, e.joining_date, e.employment_type
    FROM users u
    LEFT JOIN employees e ON e.user_id = u.id OR (e.user_id IS NULL AND e.email = u.email)
  `).all();
  console.table(q);

  const sessions = await db.prepare(`SELECT * FROM sessions ORDER BY created_at DESC LIMIT 5`).all();
  console.log('Recent sessions:', sessions);

  process.exit(0);
}

run().catch(console.error);


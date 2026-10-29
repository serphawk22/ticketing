import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.resolve(__dirname, '../data/app.db');

console.log('Connecting to database at:', dbPath);
const db = new Database(dbPath);

const integrity = db.prepare('PRAGMA integrity_check').get();
console.log('PRAGMA integrity_check:', integrity.integrity_check);
if (integrity.integrity_check !== 'ok') {
  console.error('Database integrity check failed!');
  process.exit(1);
}

const timestamp = Date.now();
const backupPath = path.resolve(__dirname, `../data/app.db.bak-${timestamp}`);
const normalizedBackupPath = backupPath.replace(/\\/g, '/');

console.log('Executing VACUUM INTO to safe backup path:', normalizedBackupPath);
db.exec(`VACUUM INTO '${normalizedBackupPath}'`);

console.log('Verifying backup file restorability...');
const backupDb = new Database(backupPath, { readonly: true });
const backupIntegrity = backupDb.prepare('PRAGMA integrity_check').get();
const users = backupDb.prepare('SELECT count(*) as c FROM users').get();
const att = backupDb.prepare('SELECT count(*) as c FROM employee_attendance').get();
const leaves = backupDb.prepare('SELECT count(*) as c FROM employee_leave_requests').get();

backupDb.close();
db.close();

console.log('Backup PRAGMA integrity_check:', backupIntegrity.integrity_check);
console.log('Verified Counts in Backup -> Users:', users.c, '| Attendance:', att.c, '| Leave Requests:', leaves.c);

if (backupIntegrity.integrity_check === 'ok' && users.c > 0) {
  console.log('>>> VERIFIED BACKUP SUCCESSFUL:', backupPath);
} else {
  console.error('Backup verification failed!');
  process.exit(1);
}


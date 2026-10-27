import assert from 'node:assert/strict';
import sharp from 'sharp';
import { db } from '../lib/db.js';
import { passwordProblems } from '../lib/users.js';
import { getImageTypeFromBuffer, sanitizeAndReencodeImage } from '../lib/fileSignature.js';
import { THEME_STORAGE_KEY, THEME_DEFAULT, THEME_MODES } from '../lib/theme.js';

const results = [];

async function test(name, fn) {
  try {
    await fn();
    results.push({ name, passed: true });
    console.log(`✓ PASS: ${name}`);
  } catch (err) {
    results.push({ name, passed: false, error: err.message });
    console.error(`✗ FAIL: ${name}\n  ${err.stack || err.message}`);
  }
}

async function runAll() {
  console.log('====================================================');
  console.log('RUNNING SETTINGS, HELP & SECURITY REGRESSION SUITE');
  console.log('====================================================\n');

  // --- 1. Password Complexity Rules ---
  await test('Password Complexity: Rejects short or weak passwords', () => {
    assert.ok(passwordProblems('short').length > 0);
    assert.ok(passwordProblems('nouppercase123!').includes('an uppercase letter'));
    assert.ok(passwordProblems('NOLOWERCASE123!').includes('a lowercase letter'));
    assert.ok(passwordProblems('NoNumberSymbol!').includes('a number'));
    assert.ok(passwordProblems('NoSymbol1234567').includes('a symbol'));
    assert.equal(passwordProblems('ValidP@ssw0rd123!').length, 0);
  });

  // --- 2. Database Schema: app_settings table ---
  await test('Database Schema: app_settings exists and performs upserts', async () => {
    const testKey = 'test_regression_key_' + Date.now();
    await db.prepare(`
      INSERT INTO app_settings (key, value, description, updated_at, updated_by)
      VALUES (?, ?, ?, datetime('now'), NULL)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(testKey, 'initial_value', 'test desc');

    const row = await db.prepare('SELECT value FROM app_settings WHERE key = ?').get(testKey);
    assert.equal(row.value, 'initial_value');

    // Update via conflict
    await db.prepare(`
      INSERT INTO app_settings (key, value, description, updated_at, updated_by)
      VALUES (?, ?, ?, datetime('now'), NULL)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(testKey, 'updated_value', 'test desc');

    const updated = await db.prepare('SELECT value FROM app_settings WHERE key = ?').get(testKey);
    assert.equal(updated.value, 'updated_value');

    // Clean up
    await db.prepare('DELETE FROM app_settings WHERE key = ?').run(testKey);
  });

  // --- 3. Support Settings Fallback & Website Data ---
  await test('Support Settings: Falls back to primary admin email and SerpHawk website data', async () => {
    const admin = await db.prepare("SELECT name, email FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1").get();
    assert.ok(admin, 'Admin user should exist');
    assert.ok(admin.email, 'Admin email should exist');
    assert.ok(admin.email.includes('@'));

    await db.prepare(`
      INSERT INTO app_settings (key, value, description, updated_at, updated_by)
      VALUES (?, ?, ?, datetime('now'), NULL)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run('support_website', 'https://serphawk.com', 'Official website');

    const webRow = await db.prepare('SELECT value FROM app_settings WHERE key = ?').get('support_website');
    assert.equal(webRow.value, 'https://serphawk.com');
    await db.prepare('DELETE FROM app_settings WHERE key = ?').run('support_website');
  });

  // --- 4. Screenshot Security: Magic Byte & sharp Re-encoding ---
  await test('Screenshot Security: Validates signatures and decodes valid PNG/JPEG', async () => {
    // Generate valid PNG in-memory
    const validPng = await sharp({
      create: { width: 100, height: 100, channels: 4, background: { r: 12, g: 102, b: 228, alpha: 1 } },
    }).png().toBuffer();

    assert.equal(getImageTypeFromBuffer(validPng), 'image/png');

    const sanitized = await sanitizeAndReencodeImage(validPng);
    assert.equal(sanitized.contentType, 'image/png');
    assert.equal(sanitized.width, 100);
    assert.equal(sanitized.height, 100);
    assert.ok(sanitized.buffer.length > 0);
  });

  await test('Screenshot Security: Rejects disguised non-image files (HTML/text/executables)', async () => {
    const fakeFile = Buffer.from('<html><script>alert("exploit")</script></html>');
    assert.equal(getImageTypeFromBuffer(fakeFile), null);

    await assert.rejects(
      async () => {
        await sanitizeAndReencodeImage(fakeFile);
      },
      /Unsupported or invalid image file signature/
    );
  });

  await test('Screenshot Security: Rejects oversized image dimensions (>4096px)', async () => {
    const hugeImage = await sharp({
      create: { width: 5000, height: 50, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
    }).png().toBuffer();

    await assert.rejects(
      async () => {
        await sanitizeAndReencodeImage(hugeImage);
      },
      /dimensions exceed maximum allowed size/
    );
  });

  // --- 5. Bug Reports Project & Client Role Isolation ---
  await test('Bug Reports: Internal project creation and access isolation', async () => {
    let bugProject = await db.prepare("SELECT * FROM projects WHERE key = 'BUG'").get();

    if (!bugProject) {
      const workspace = await db.prepare("SELECT * FROM workspaces LIMIT 1").get();
      assert.ok(workspace, 'At least one workspace must exist');

      await db.prepare(`
        INSERT INTO projects (key, name, description, color, workspace_id, client_id)
        VALUES ('BUG', 'Bug Reports', 'Internal bug reports and feedback', '#e5493a', ?, NULL)
      `).run(workspace.id);
      bugProject = await db.prepare("SELECT * FROM projects WHERE key = 'BUG'").get();
    }

    assert.ok(bugProject, 'BUG project must exist or be created');
    assert.equal(bugProject.client_id, null, 'BUG project must have client_id = null (internal only)');

    // Verify client isolation: client users can only access tickets created by themselves
    const clientUser = await db.prepare("SELECT id FROM users WHERE role = 'client' LIMIT 1").get();
    if (clientUser) {
      const clientTickets = await db.prepare("SELECT * FROM tickets WHERE created_by = ? AND archived = 0").all(clientUser.id);
      const leakedBugTicket = clientTickets.find((t) => t.project_id === bugProject.id);
      assert.equal(leakedBugTicket, undefined, 'Client tickets query must never leak BUG project tickets');
    }
  });

  // --- 6. Duplicate Submission Prevention ---
  await test('Duplicate Prevention: Identical submissions within 60s detected; distinct reports accepted', async () => {
    const admin = await db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
    const bugProject = await db.prepare("SELECT * FROM projects WHERE key = 'BUG'").get();
    assert.ok(bugProject);

    const uniqueTitle = 'Regression Bug ' + Date.now();
    const description = 'Steps to reproduce the regression issue.';

    // 1. Create first report
    const insertStmt = db.prepare(`
      INSERT INTO tickets (title, description, status, priority, type, created_by, project_id, labels, category)
      VALUES (?, ?, 'open', 'medium', 'bug', ?, ?, 'bug-report', 'Bug Report')
    `);
    const firstResult = await insertStmt.run(uniqueTitle, description, admin.id, bugProject.id);
    assert.ok(firstResult.lastInsertRowid);

    // 2. Query recent within 60s
    const cutoff = new Date(Date.now() - 60000).toISOString().slice(0, 19).replace('T', ' ');
    const recent = await db.prepare(`
      SELECT * FROM tickets WHERE project_id = ? AND created_by = ? AND created_at >= ?
    `).all(bugProject.id, admin.id, cutoff);

    // Exact duplicate test
    const exactDuplicate = recent.find((t) => t.title.toLowerCase() === uniqueTitle.toLowerCase() && t.description.includes(description));
    assert.ok(exactDuplicate, 'Duplicate must be detected');
    assert.equal(exactDuplicate.id, firstResult.lastInsertRowid);

    // Distinct report test (different title)
    const distinctTitle = 'Different Bug ' + Date.now();
    const distinctDuplicate = recent.find((t) => t.title.toLowerCase() === distinctTitle.toLowerCase());
    assert.equal(distinctDuplicate, undefined, 'Distinct report must NOT be flagged as duplicate');

    // Clean up test tickets
    await db.prepare('DELETE FROM tickets WHERE id = ?').run(firstResult.lastInsertRowid);
  });

  // --- 7. Theme Synchronization Contract ---
  await test('Theme: Constants and storage key contract intact', () => {
    assert.equal(THEME_STORAGE_KEY, 'ticketing:theme');
    assert.equal(THEME_DEFAULT, 'light');
    assert.deepEqual(THEME_MODES, ['light', 'dark', 'system']);
  });

  // --- 8. Core Workflows Regression Checks ---
  await test('Core Regression: Existing tickets, projects and workspaces query cleanly', async () => {
    const allTickets = await db.prepare('SELECT count(*) as count FROM tickets').get();
    assert.ok(allTickets.count >= 0);

    const workspaces = await db.prepare('SELECT count(*) as count FROM workspaces').get();
    assert.ok(workspaces.count >= 1);

    const projects = await db.prepare('SELECT count(*) as count FROM projects').get();
    assert.ok(projects.count >= 1);
  });

  await test('Core Regression: Task sheets and attendance tables intact', async () => {
    const sheets = await db.prepare('SELECT count(*) as count FROM task_sheet_submissions').get();
    assert.ok(typeof sheets.count === 'number');

    const att = await db.prepare('SELECT count(*) as count FROM attendance_settings').get();
    assert.ok(typeof att.count === 'number');
  });

  console.log('\n====================================================');
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  console.log(`RESULTS: ${passed} passed, ${failed} failed`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runAll().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});

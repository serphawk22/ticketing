import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const TEST_DB_PATH = path.resolve(ROOT_DIR, 'data/test_ticket_refs_isolated.db');

for (const ext of ['', '-wal', '-shm']) {
  if (fs.existsSync(TEST_DB_PATH + ext)) fs.unlinkSync(TEST_DB_PATH + ext);
}

process.env.DB_DRIVER = 'sqlite';
process.env.SQLITE_DB_PATH = TEST_DB_PATH;
delete process.env.POSTGRES_URL;
delete process.env.DATABASE_URL;

// Register a test-only ESM loader hook so we can execute the real Next.js
// route handlers against the isolated SQLite DB with controlled session cookies.
const rootUrl = pathToFileURL(ROOT_DIR + path.sep).href;
const loaderCode = `
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT_URL = ${JSON.stringify(rootUrl)};

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'next/headers') {
    return { url: 'test-mock:next/headers', shortCircuit: true };
  }
  if (specifier === 'next/server') {
    return { url: 'test-mock:next/server', shortCircuit: true };
  }
  if (specifier.startsWith('@/')) {
    const rel = specifier.slice(2);
    const candidate = new URL(rel, ROOT_URL);
    if (!fs.existsSync(fileURLToPath(candidate)) && fs.existsSync(fileURLToPath(new URL(rel + '.js', ROOT_URL)))) {
      return nextResolve(new URL(rel + '.js', ROOT_URL).href, context);
    }
    return nextResolve(candidate.href, context);
  }
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL?.startsWith(ROOT_URL)) {
    const candidate = new URL(specifier, context.parentURL);
    if (!fs.existsSync(fileURLToPath(candidate)) && fs.existsSync(fileURLToPath(new URL(specifier + '.js', context.parentURL)))) {
      return nextResolve(new URL(specifier + '.js', context.parentURL).href, context);
    }
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url === 'test-mock:next/headers') {
    return {
      format: 'module',
      shortCircuit: true,
      source: \`
        export async function cookies() {
          return {
            get(name) {
              const val = globalThis.__TEST_COOKIES__?.[name];
              return val ? { name, value: val } : undefined;
            },
            set() {},
            delete() {},
          };
        }
      \`,
    };
  }
  if (url === 'test-mock:next/server') {
    return {
      format: 'module',
      shortCircuit: true,
      source: \`
        export const NextResponse = {
          json(body, init) {
            return new Response(JSON.stringify(body), {
              status: init?.status ?? 200,
              headers: { 'content-type': 'application/json' },
            });
          },
        };
      \`,
    };
  }
  return nextLoad(url, context);
}
`;

register(`data:text/javascript;base64,${Buffer.from(loaderCode).toString('base64')}`, import.meta.url);

const { db } = await import('../lib/db.js');
const {
  parseTicketKey,
  buildValidPrefixSet,
  buildExistingKeySet,
  tokenizeTicketRefs,
  extractCandidateTicketKeys,
  extractCandidateTicketKeysFromHtml,
  linkifyHtmlTicketRefs,
  ticketHref,
} = await import('../lib/ticketRefs.js');
const { sanitizeDocHtml } = await import('../lib/docHtml.js');
const { GET: getTicketByKey } = await import('../app/api/tickets/by-key/[key]/route.js');
const { GET: batchValidateKeys } = await import('../app/api/tickets/by-key/route.js');

after(() => {
  globalThis.__TEST_COOKIES__ = undefined;
  try {
    db.close();
  } catch {
    // ignore
  }
  for (const ext of ['', '-wal', '-shm']) {
    if (fs.existsSync(TEST_DB_PATH + ext)) fs.unlinkSync(TEST_DB_PATH + ext);
  }
});

test('ticketRefs: parses valid keys including numeric prefixes and rejects invalid forms', () => {
  assert.deepEqual(parseTicketKey('tm-101'), { prefix: 'TM', id: 101, key: 'TM-101' });
  assert.deepEqual(parseTicketKey('[WEB-104]'), { prefix: 'WEB', id: 104, key: 'WEB-104' });
  assert.deepEqual(parseTicketKey('2FA-15'), { prefix: '2FA', id: 15, key: '2FA-15' });
  assert.equal(parseTicketKey('NO-0'), null); // ticket IDs start at 1
  assert.equal(parseTicketKey('A-1'), null); // prefix < 2 chars
  assert.equal(parseTicketKey('TOOLONG7-1'), null); // prefix > 6 chars
  assert.equal(parseTicketKey('2026-11-01'), null); // multi-hyphen date
  assert.equal(parseTicketKey('not-a-key'), null);
  assert.equal(ticketHref('web-42'), '/t/WEB-42');
});

test('ticketRefs: rejects false positives (UTF-8, COVID-19, 2026-11, ISO-9001, NOPE-99) and respects URLs', () => {
  const validPrefixes = buildValidPrefixSet([{ key: 'TM' }, { key: 'WEB' }, { key: '2FA' }]);
  const existingKeys = buildExistingKeySet(['TM-101', 'WEB-104', '2FA-5']);

  const sample =
    'Check TM-101 and [WEB-104] and 2FA-5, ignore UTF-8, COVID-19, 2026-11, ISO-9001, NOPE-99, TM-999, and https://example.com/TM-101.';
  const candidates = extractCandidateTicketKeys(sample, { validPrefixes });
  assert.deepEqual(candidates, ['TM-101', 'WEB-104', '2FA-5', 'TM-999']);

  const tokens = tokenizeTicketRefs(sample, { validPrefixes, existingKeys });
  const linkedKeys = tokens.filter((t) => t.type === 'ticket').map((t) => ({ key: t.key, raw: t.raw }));
  assert.deepEqual(linkedKeys, [
    { key: 'TM-101', raw: 'TM-101' },
    { key: 'WEB-104', raw: '[WEB-104]' },
    { key: '2FA-5', raw: '2FA-5' },
  ]);
});

test('ticketRefs: linkifyHtmlTicketRefs skips <a>, <code>, <pre>, and preserves HTML formatting', () => {
  const validPrefixes = buildValidPrefixSet([{ key: 'TM' }, { key: 'WEB' }]);
  const existingKeys = buildExistingKeySet(['TM-101', 'WEB-104']);

  const html =
    '<p>Fix <strong>TM-101</strong> &amp; [WEB-104], keep <code>TM-101</code>, <pre>WEB-104</pre>, ' +
    '<a href="/t/TM-101">TM-101</a>, and https://foo.bar/WEB-104 untouched.</p>';

  const out = linkifyHtmlTicketRefs(html, { validPrefixes, existingKeys });
  assert.match(
    out,
    /<p>Fix <strong><a class="doc-issue" data-key="TM-101" href="\/t\/TM-101">TM-101<\/a><\/strong>/
  );
  assert.match(out, /\[<a class="doc-issue" data-key="WEB-104" href="\/t\/WEB-104">WEB-104<\/a>\]/);
  assert.match(out, /<code>TM-101<\/code>/);
  assert.match(out, /<pre>WEB-104<\/pre>/);
  assert.match(out, /<a href="\/t\/TM-101">TM-101<\/a>/);
  assert.match(out, /https:\/\/foo\.bar\/WEB-104 untouched\./);

  const htmlCandidates = extractCandidateTicketKeysFromHtml(html, { validPrefixes });
  assert.deepEqual(htmlCandidates, ['TM-101', 'WEB-104']);
});

test('docHtml: sanitizeDocHtml preserves doc-issue anchors including numeric prefixes and supplies default href', () => {
  const dirty =
    '<p>See <a class="doc-issue" data-key="2fa-5" onclick="alert(1)">2FA-5</a> and ' +
    '<a href="javascript:alert(2)" class="doc-issue" data-key="TM-101">TM-101</a></p>';
  const clean = sanitizeDocHtml(dirty);
  assert.match(clean, /<a href="\/t\/2FA-5" class="doc-issue" data-key="2FA-5">2FA-5<\/a>/);
  assert.match(clean, /<a href="\/t\/TM-101" class="doc-issue" data-key="TM-101">TM-101<\/a>/);
  assert.doesNotMatch(clean, /onclick|javascript:/i);
});

async function createSessionForUser(userId) {
  const token = `tok-${userId}-${crypto.randomUUID()}`;
  await db
    .prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
    .run(token, userId, Date.now() + 60 * 60 * 1000);
  return token;
}

test('API /api/tickets/by-key & /api/tickets/by-key/[key]: cross-project lookup, validation, and RBAC', async () => {
  // Users
  const ownerId = Number(
    (
      await db
        .prepare("INSERT INTO users (name, email, password, role) VALUES ('Owner Ref', 'ownerref@test.local', 'h', 'owner')")
        .run()
    ).lastInsertRowid
  );
  const empIdRes = Number(
    (
      await db
        .prepare("INSERT INTO users (name, email, password, role) VALUES ('Emp Ref', 'empref@test.local', 'h', 'employee')")
        .run()
    ).lastInsertRowid
  );
  const empRowId = Number(
    (
      await db
        .prepare("INSERT INTO employees (user_id, name, email, role, active) VALUES (?, 'Emp Ref', 'empref@test.local', 'employee', 1)")
        .run(empIdRes)
    ).lastInsertRowid
  );
  const clientAId = Number(
    (
      await db
        .prepare("INSERT INTO users (name, email, password, role) VALUES ('Client A', 'clienta@test.local', 'h', 'client')")
        .run()
    ).lastInsertRowid
  );
  const clientBId = Number(
    (
      await db
        .prepare("INSERT INTO users (name, email, password, role) VALUES ('Client B', 'clientb@test.local', 'h', 'client')")
        .run()
    ).lastInsertRowid
  );

  async function ensureProject(name, key, color) {
    const existing = await db.prepare('SELECT id FROM projects WHERE key = ?').get(key);
    if (existing) return Number(existing.id);
    const res = await db
      .prepare('INSERT INTO projects (name, key, color) VALUES (?, ?, ?)')
      .run(name, key, color);
    return Number(res.lastInsertRowid);
  }

  // Projects (reuse existing seeded keys if present, plus numeric prefix 2FA)
  const projTmId = await ensureProject('Ticketing Main', 'TM', '#111111');
  const projWebId = await ensureProject('Web App', 'WEB', '#222222');
  const proj2faId = await ensureProject('Auth Security', '2FA', '#333333');

  // Tickets
  const internalTicketId = Number(
    (
      await db
        .prepare(
          "INSERT INTO tickets (title, description, status, priority, type, project_id, employee_id, created_by, archived) VALUES ('Internal Core', 'secret internal notes', 'in_progress', 'high', 'task', ?, ?, ?, 0)"
        )
        .run(projTmId, empRowId, ownerId)
    ).lastInsertRowid
  );
  const clientOwnTicketId = Number(
    (
      await db
        .prepare(
          "INSERT INTO tickets (title, description, status, priority, type, project_id, created_by, archived) VALUES ('Client Own Request', 'desc', 'open', 'medium', 'bug', ?, ?, 0)"
        )
        .run(projWebId, clientAId)
    ).lastInsertRowid
  );
  const clientArchivedTicketId = Number(
    (
      await db
        .prepare(
          "INSERT INTO tickets (title, description, status, priority, type, project_id, created_by, archived) VALUES ('Client Archived', 'desc', 'closed', 'low', 'task', ?, ?, 1)"
        )
        .run(proj2faId, clientAId)
    ).lastInsertRowid
  );
  const otherClientTicketId = Number(
    (
      await db
        .prepare(
          "INSERT INTO tickets (title, description, status, priority, type, project_id, created_by, archived) VALUES ('Client B Request', 'desc', 'open', 'low', 'bug', ?, ?, 0)"
        )
        .run(projWebId, clientBId)
    ).lastInsertRowid
  );

  const ownerToken = await createSessionForUser(ownerId);
  const empToken = await createSessionForUser(empIdRes);
  const clientAToken = await createSessionForUser(clientAId);

  const tmKey = `TM-${internalTicketId}`;
  const webKey = `WEB-${clientOwnTicketId}`;
  const twoFaKey = `2FA-${clientArchivedTicketId}`;
  const clientBKey = `WEB-${otherClientTicketId}`;

  // 1. Unauthenticated -> 401
  globalThis.__TEST_COOKIES__ = {};
  const unauthRes = await getTicketByKey(new Request(`http://localhost/api/tickets/by-key/${tmKey}`), {
    params: Promise.resolve({ key: tmKey }),
  });
  assert.equal(unauthRes.status, 401);

  // 2. Owner can fetch cross-project tickets including archived ones
  globalThis.__TEST_COOKIES__ = { ticket_session: ownerToken };
  const ownerArchRes = await getTicketByKey(new Request(`http://localhost/api/tickets/by-key/${twoFaKey}`), {
    params: Promise.resolve({ key: twoFaKey }),
  });
  assert.equal(ownerArchRes.status, 200);
  const ownerArchJson = await ownerArchRes.json();
  assert.equal(ownerArchJson.ticket.id, clientArchivedTicketId);
  assert.equal(ownerArchJson.ticket.project_key, '2FA');

  // 3. Mismatched project prefix for an existing ID returns 404 (not leaked under wrong key)
  const mismatchRes = await getTicketByKey(
    new Request(`http://localhost/api/tickets/by-key/WEB-${internalTicketId}`),
    { params: Promise.resolve({ key: `WEB-${internalTicketId}` }) }
  );
  assert.equal(mismatchRes.status, 404);

  // 4. Invalid key format returns 400
  const invalidRes = await getTicketByKey(new Request('http://localhost/api/tickets/by-key/INVALID'), {
    params: Promise.resolve({ key: 'INVALID' }),
  });
  assert.equal(invalidRes.status, 400);

  // 5. Client A can open their own active ticket, receives sanitized payload
  globalThis.__TEST_COOKIES__ = { ticket_session: clientAToken };
  const clientOwnRes = await getTicketByKey(new Request(`http://localhost/api/tickets/by-key/${webKey}`), {
    params: Promise.resolve({ key: webKey }),
  });
  assert.equal(clientOwnRes.status, 200);
  const clientOwnJson = await clientOwnRes.json();
  assert.equal(clientOwnJson.ticket.id, clientOwnTicketId);
  assert.equal(clientOwnJson.ticket.due_date, undefined);

  // 6. Client A CANNOT access internal ticket -> 403
  const clientInternalRes = await getTicketByKey(new Request(`http://localhost/api/tickets/by-key/${tmKey}`), {
    params: Promise.resolve({ key: tmKey }),
  });
  assert.equal(clientInternalRes.status, 403);

  // 7. Client A CANNOT access even their own archived ticket via by-key -> 403
  const clientArchRes = await getTicketByKey(new Request(`http://localhost/api/tickets/by-key/${twoFaKey}`), {
    params: Promise.resolve({ key: twoFaKey }),
  });
  assert.equal(clientArchRes.status, 403);

  // 8. Client A CANNOT access Client B's ticket -> 403
  const clientOtherRes = await getTicketByKey(new Request(`http://localhost/api/tickets/by-key/${clientBKey}`), {
    params: Promise.resolve({ key: clientBKey }),
  });
  assert.equal(clientOtherRes.status, 403);

  // 9. Batch validation for Client A only reveals clientA's active ticket
  const clientBatchRes = await batchValidateKeys(
    new Request(
      `http://localhost/api/tickets/by-key?keys=${encodeURIComponent(
        [tmKey, webKey, twoFaKey, clientBKey, 'UTF-8', 'NOPE-99'].join(',')
      )}`
    )
  );
  assert.equal(clientBatchRes.status, 200);
  const clientBatchJson = await clientBatchRes.json();
  assert.deepEqual(clientBatchJson.validKeys, [webKey]);

  // 10. Batch validation for Employee reveals accessible employee tickets (including assigned internal ticket)
  globalThis.__TEST_COOKIES__ = { ticket_session: empToken };
  const empBatchRes = await batchValidateKeys(
    new Request(
      `http://localhost/api/tickets/by-key?keys=${encodeURIComponent(
        [tmKey, webKey, twoFaKey, 'ISO-9001'].join(',')
      )}`
    )
  );
  assert.equal(empBatchRes.status, 200);
  const empBatchJson = await empBatchRes.json();
  assert.equal(empBatchJson.validKeys.includes(tmKey), true);
  assert.equal(empBatchJson.validKeys.includes('ISO-9001'), false);
});

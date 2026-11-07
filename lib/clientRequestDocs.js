import { db } from './db';
import { sanitizeDocHtml } from './docHtml';

const DOC_COLUMNS = `
  d.id, d.parent_id, d.title, d.body, d.position,
  d.created_by, d.updated_by, d.created_at, d.updated_at,
  cu.name AS created_by_name, uu.name AS updated_by_name
`;

const LIST_QUERY = `
  SELECT ${DOC_COLUMNS}
  FROM client_request_docs d
  LEFT JOIN users cu ON cu.id = d.created_by
  LEFT JOIN users uu ON uu.id = d.updated_by
  ORDER BY d.position ASC, d.id ASC
`;

const ONE_QUERY = `
  SELECT ${DOC_COLUMNS}
  FROM client_request_docs d
  LEFT JOIN users cu ON cu.id = d.created_by
  LEFT JOIN users uu ON uu.id = d.updated_by
  WHERE d.id = ?
`;

const TITLE_LIMIT = 200;
const BODY_LIMIT = 200000;

export async function getClientRequestDocs() {
  return db.prepare(LIST_QUERY).all();
}

export async function getClientRequestDoc(docId) {
  return db.prepare(ONE_QUERY).get(Number(docId));
}

async function nextPosition(parentId) {
  const row = parentId
    ? await db
        .prepare(
          'SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM client_request_docs WHERE parent_id = ?'
        )
        .get(parentId)
    : await db
        .prepare(
          'SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM client_request_docs WHERE parent_id IS NULL'
        )
        .get();
  return Number(row?.pos) || 0;
}

function cleanTitle(title) {
  return String(title || '').replace(/\s+/g, ' ').trim().slice(0, TITLE_LIMIT);
}

function cleanBody(body) {
  const raw = String(body || '');
  if (raw.length > BODY_LIMIT) {
    const error = new Error('This doc is too long.');
    error.status = 400;
    throw error;
  }
  return sanitizeDocHtml(raw);
}

export async function createClientRequestDoc({
  parentId = null,
  title = '',
  body = '',
  userId,
}) {
  const parent = parentId ? await getClientRequestDoc(parentId) : null;
  if (parentId && !parent) {
    const error = new Error('Parent page not found.');
    error.status = 400;
    throw error;
  }
  const position = await nextPosition(parent ? parent.id : null);
  const info = await db
    .prepare(
      `INSERT INTO client_request_docs
         (parent_id, title, body, position, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      parent ? parent.id : null,
      cleanTitle(title),
      cleanBody(body),
      position,
      userId,
      userId
    );
  return getClientRequestDoc(info.lastInsertRowid);
}

export async function duplicateClientRequestDoc(docId, userId) {
  const source = await getClientRequestDoc(docId);
  if (!source) return null;
  const title = cleanTitle(source.title ? `Copy of ${source.title}` : 'Copy of Untitled');
  return createClientRequestDoc({
    parentId: source.parent_id,
    title,
    body: source.body,
    userId,
  });
}

async function parentChainHas(startId, targetId) {
  let cursorId = startId;
  for (let i = 0; i < 40 && cursorId; i += 1) {
    if (Number(cursorId) === Number(targetId)) return true;
    const row = await getClientRequestDoc(cursorId);
    cursorId = row?.parent_id;
  }
  return false;
}

export async function updateClientRequestDoc(docId, fields, userId) {
  const existing = await getClientRequestDoc(docId);
  if (!existing) return null;

  let parentId = existing.parent_id;
  if (fields.parent_id !== undefined) {
    parentId = fields.parent_id == null || fields.parent_id === '' ? null : Number(fields.parent_id);
    if (parentId && !Number.isInteger(parentId)) {
      const error = new Error('Parent page not found.');
      error.status = 400;
      throw error;
    }
    if (parentId) {
      const parent = await getClientRequestDoc(parentId);
      if (!parent) {
        const error = new Error('Parent page not found.');
        error.status = 400;
        throw error;
      }
      if (await parentChainHas(parent.id, existing.id)) {
        const error = new Error('A page cannot sit inside itself.');
        error.status = 400;
        throw error;
      }
    }
    if (Number(parentId) !== Number(existing.parent_id)) {
      const position = await nextPosition(parentId);
      await db
        .prepare('UPDATE client_request_docs SET parent_id = ?, position = ? WHERE id = ?')
        .run(parentId, position, existing.id);
    }
  }

  const title = fields.title === undefined ? existing.title : cleanTitle(fields.title);
  const body = fields.body === undefined ? existing.body : cleanBody(fields.body);
  await db
    .prepare(
      `UPDATE client_request_docs
       SET title = ?, body = ?, updated_by = ?, updated_at = datetime('now')
       WHERE id = ?`
    )
    .run(title, body, userId, existing.id);
  return getClientRequestDoc(existing.id);
}

async function siblings(parentId) {
  if (parentId) {
    return db
      .prepare(
        'SELECT id FROM client_request_docs WHERE parent_id = ? ORDER BY position ASC, id ASC'
      )
      .all(parentId);
  }
  return db
    .prepare(
      'SELECT id FROM client_request_docs WHERE parent_id IS NULL ORDER BY position ASC, id ASC'
    )
    .all();
}

export async function moveClientRequestDoc(docId, direction) {
  const existing = await getClientRequestDoc(docId);
  if (!existing) return null;
  const rows = await siblings(existing.parent_id);
  const index = rows.findIndex((row) => Number(row.id) === Number(existing.id));
  const nextIndex = index + (direction === 'up' ? -1 : 1);
  if (index < 0 || nextIndex < 0 || nextIndex >= rows.length) return existing;
  const ordered = rows.map((row) => row.id);
  const [moved] = ordered.splice(index, 1);
  ordered.splice(nextIndex, 0, moved);
  for (let position = 0; position < ordered.length; position += 1) {
    await db
      .prepare('UPDATE client_request_docs SET position = ? WHERE id = ?')
      .run(position, ordered[position]);
  }
  return getClientRequestDoc(existing.id);
}

export async function deleteClientRequestDoc(docId) {
  const existing = await getClientRequestDoc(docId);
  if (!existing) return null;
  await db
    .prepare('UPDATE client_request_docs SET parent_id = ? WHERE parent_id = ?')
    .run(existing.parent_id, existing.id);
  await db.prepare('DELETE FROM client_request_docs WHERE id = ?').run(existing.id);
  return existing;
}

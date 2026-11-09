import fs from 'fs/promises';
import path from 'path';
import { db, isRemoteDatabase } from './db.js';
import { usesRemoteStorage } from './storage.js';

// Local storage directory for employee documents
const LOCAL_DOCS_ROOT = path.resolve(process.cwd(), 'data', 'attachments', 'employee-docs');

export const ALLOWED_DOC_TYPES = [
  'national_id',
  'education',
  'experience',
  'offer_contract',
  'tax_finance',
  'medical',
  'other',
];

export const DOC_TYPE_LABELS = {
  national_id: 'Identity / National ID',
  education: 'Educational Certificate',
  experience: 'Experience / Relieving Letter',
  offer_contract: 'Offer Letter / Contract',
  tax_finance: 'Tax / Financial Document',
  medical: 'Medical Certificate',
  other: 'Other Document',
};

export const MAX_DOC_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

function localFilePath(storageKey) {
  const full = path.resolve(LOCAL_DOCS_ROOT, String(storageKey));
  const rel = path.relative(LOCAL_DOCS_ROOT, full);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Invalid employee document path.');
  }
  return full;
}

/**
 * Checks whether the viewer is authorized to access an employee's documents.
 * Admins can access all documents. Employees can access their own.
 */
export function canAccessEmployeeDocuments(viewer, employee) {
  if (!viewer || !employee) return false;
  if (viewer.role === 'admin') return true;
  if (employee.user_id && Number(viewer.id) === Number(employee.user_id)) return true;
  if (viewer.email && employee.email && viewer.email.toLowerCase() === employee.email.toLowerCase()) return true;
  return false;
}

/**
 * Checks whether the viewer is authorized to verify or reject documents.
 * Only administrators can verify documents.
 */
export function canVerifyEmployeeDocuments(viewer) {
  return viewer?.role === 'admin';
}

/**
 * List documents for an employee.
 */
export async function getEmployeeDocuments({
  employeeId,
  workspaceId,
  includeDeleted = false,
  docType = null,
  verificationStatus = null,
}) {
  if (!employeeId) return [];

  const conditions = ['d.employee_id = ?'];
  const params = [Number(employeeId)];

  if (workspaceId) {
    conditions.push('d.workspace_id = ?');
    params.push(Number(workspaceId));
  }

  if (!includeDeleted) {
    conditions.push('d.deleted_at IS NULL');
  }

  if (docType) {
    conditions.push('d.doc_type = ?');
    params.push(String(docType));
  }

  if (verificationStatus) {
    conditions.push('d.verification_status = ?');
    params.push(String(verificationStatus));
  }

  const sql = `
    SELECT d.*,
           u_up.name AS uploaded_by_name,
           u_up.email AS uploaded_by_email,
           u_ver.name AS verified_by_name,
           u_ver.email AS verified_by_email
    FROM employee_documents d
    LEFT JOIN users u_up ON u_up.id = d.uploaded_by
    LEFT JOIN users u_ver ON u_ver.id = d.verified_by
    WHERE ${conditions.join(' AND ')}
    ORDER BY d.created_at DESC
  `;

  return db.prepare(sql).all(...params);
}

/**
 * Fetch a single document by ID.
 */
export async function getEmployeeDocument(id, workspaceId = null) {
  if (!id) return null;

  const conditions = ['d.id = ?'];
  const params = [Number(id)];

  if (workspaceId) {
    conditions.push('d.workspace_id = ?');
    params.push(Number(workspaceId));
  }

  const sql = `
    SELECT d.*,
           u_up.name AS uploaded_by_name,
           u_up.email AS uploaded_by_email,
           u_ver.name AS verified_by_name,
           u_ver.email AS verified_by_email
    FROM employee_documents d
    LEFT JOIN users u_up ON u_up.id = d.uploaded_by
    LEFT JOIN users u_ver ON u_ver.id = d.verified_by
    WHERE ${conditions.join(' AND ')}
    LIMIT 1
  `;

  return db.prepare(sql).get(...params);
}

/**
 * Create and upload an employee document.
 */
export async function createEmployeeDocument({
  workspaceId,
  employeeId,
  docType,
  title,
  fileName,
  fileSize,
  mimeType,
  buffer,
  uploadedBy = null,
}) {
  if (!workspaceId) throw new Error('Workspace ID is required.');
  if (!employeeId) throw new Error('Employee ID is required.');
  if (!docType || !ALLOWED_DOC_TYPES.includes(docType)) {
    throw new Error(`Invalid document type. Allowed types: ${ALLOWED_DOC_TYPES.join(', ')}`);
  }
  if (!title || !title.trim()) {
    throw new Error('Document title is required.');
  }
  if (!fileName || !buffer) {
    throw new Error('File content and name are required.');
  }
  if (fileSize > MAX_DOC_SIZE_BYTES) {
    throw new Error(`File size exceeds maximum allowed size of 10MB.`);
  }

  // Safe file name sanitize
  const safeName = String(fileName)
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(-80) || 'document';

  const relativeKey = `${workspaceId}/${employeeId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;

  // In development and SQLite mode, always write locally to prevent touching production S3
  const dest = localFilePath(relativeKey);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, buffer);

  const res = await db.prepare(`
    INSERT INTO employee_documents (
      workspace_id, employee_id, doc_type, title,
      file_name, storage_key, file_size, mime_type,
      verification_status, uploaded_by, verification_notes,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, '', datetime('now'), datetime('now'))
  `).run(
    Number(workspaceId),
    Number(employeeId),
    String(docType),
    String(title.trim()),
    safeName,
    relativeKey,
    Number(fileSize || buffer.length),
    String(mimeType || 'application/octet-stream'),
    uploadedBy ? Number(uploadedBy) : null
  );

  return getEmployeeDocument(res.lastInsertRowid, workspaceId);
}

/**
 * Update verification status of a document.
 */
export async function updateDocumentVerification(
  id,
  { workspaceId = null, verificationStatus, verificationNotes = '', verifiedBy = null }
) {
  const allowed = ['pending', 'verified', 'rejected'];
  if (!allowed.includes(verificationStatus)) {
    throw new Error(`Invalid verification status. Must be one of: ${allowed.join(', ')}`);
  }

  const doc = await getEmployeeDocument(id, workspaceId);
  if (!doc) throw new Error('Document not found.');

  const verifiedAt = verificationStatus === 'pending' ? null : new Date().toISOString();

  await db.prepare(`
    UPDATE employee_documents
    SET verification_status = ?,
        verification_notes = ?,
        verified_by = ?,
        verified_at = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(
    verificationStatus,
    String(verificationNotes || ''),
    verifiedBy ? Number(verifiedBy) : null,
    verifiedAt,
    Number(id)
  );

  return getEmployeeDocument(id, workspaceId);
}

/**
 * Read the document file buffer from disk.
 */
export async function readEmployeeDocumentFile(storageKey) {
  const dest = localFilePath(storageKey);
  return fs.readFile(dest);
}

/**
 * Delete a document (soft delete or complete remove).
 */
export async function deleteEmployeeDocument(id, workspaceId = null, soft = true) {
  const doc = await getEmployeeDocument(id, workspaceId);
  if (!doc) return false;

  if (soft) {
    await db.prepare(`
      UPDATE employee_documents
      SET deleted_at = datetime('now'),
          updated_at = datetime('now')
      WHERE id = ?
    `).run(Number(id));
  } else {
    // Hard delete
    await db.prepare('DELETE FROM employee_documents WHERE id = ?').run(Number(id));
    try {
      await fs.unlink(localFilePath(doc.storage_key));
    } catch (err) {
      if (err.code !== 'ENOENT') console.error('Failed to unlink document file:', err.message);
    }
  }

  return true;
}


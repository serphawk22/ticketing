import fs from 'fs/promises';
import path from 'path';
import { db, isRemoteDatabase } from '../lib/db.js';
import { createEmployee, deleteEmployee } from '../lib/employees.js';
import {
  createEmployeeDocument,
  getEmployeeDocuments,
  getEmployeeDocument,
  updateDocumentVerification,
  readEmployeeDocumentFile,
  deleteEmployeeDocument,
  canAccessEmployeeDocuments,
  canVerifyEmployeeDocuments,
  ALLOWED_DOC_TYPES,
  MAX_DOC_SIZE_BYTES,
} from '../lib/employeeDocs.js';

async function runPhase4Tests() {
  console.log('--- Phase 4 Employee Document Management Tests ---');

  if (isRemoteDatabase()) {
    throw new Error('FATAL: Running against remote database instead of local SQLite!');
  }

  // Get or create workspace
  let ws = await db.prepare('SELECT id FROM workspaces ORDER BY id ASC LIMIT 1').get();
  if (!ws) {
    const wsRes = await db.prepare('INSERT INTO workspaces (key, name, description) VALUES (?, ?, ?)').run('DOCWS', 'Doc Test WS', 'Testing');
    ws = { id: wsRes.lastInsertRowid };
  }

  const timestamp = Date.now();

  console.log('1. Setting up test Employee and User...');
  const testEmail = `docuser_${timestamp}@example.com`;
  const userRes = await db.prepare(
    "INSERT INTO users (name, email, role, password) VALUES (?, ?, 'developer', 'dummyhash')"
  ).run('Doc Tester', testEmail);
  const testUserId = userRes.lastInsertRowid;

  const adminRes = await db.prepare(
    "INSERT INTO users (name, email, role, password) VALUES (?, ?, 'admin', 'dummyhash')"
  ).run('Doc Admin', `admin_${timestamp}@example.com`);
  const adminUserId = adminRes.lastInsertRowid;

  const emp = await createEmployee({
    workspaceId: ws.id,
    name: 'Doc Tester',
    email: testEmail,
    user_id: testUserId,
    employment_status: 'active',
  });

  console.log('2. Testing Document Upload and Local Storage...');
  const samplePdfContent = Buffer.from('%PDF-1.4 Test document content for SerpHawk HRMS Phase 4');
  const doc = await createEmployeeDocument({
    workspaceId: ws.id,
    employeeId: emp.id,
    docType: 'national_id',
    title: 'Passport Copy',
    fileName: 'passport_scan.pdf',
    fileSize: samplePdfContent.length,
    mimeType: 'application/pdf',
    buffer: samplePdfContent,
    uploadedBy: testUserId,
  });

  if (!doc || !doc.id) {
    throw new Error('FAIL: Document creation returned empty result');
  }
  if (doc.verification_status !== 'pending') {
    throw new Error(`FAIL: Initial verification status must be pending, got ${doc.verification_status}`);
  }
  if (doc.title !== 'Passport Copy' || doc.doc_type !== 'national_id') {
    throw new Error('FAIL: Document title or doc_type mismatch');
  }

  // Verify file was written to local storage
  const localDocsRoot = path.resolve(process.cwd(), 'data', 'attachments', 'employee-docs');
  const expectedDiskFile = path.resolve(localDocsRoot, doc.storage_key);
  const fileStat = await fs.stat(expectedDiskFile);
  if (!fileStat.isFile() || fileStat.size !== samplePdfContent.length) {
    throw new Error('FAIL: File was not created properly on local disk');
  }
  console.log('   PASSED: Document saved to database and isolated local disk storage.');

  console.log('3. Testing Document Listing & Filtering...');
  const docsList = await getEmployeeDocuments({ employeeId: emp.id, workspaceId: ws.id });
  if (docsList.length !== 1 || docsList[0].id !== doc.id) {
    throw new Error('FAIL: getEmployeeDocuments did not list the created document');
  }

  const filteredByType = await getEmployeeDocuments({
    employeeId: emp.id,
    workspaceId: ws.id,
    docType: 'national_id',
  });
  if (filteredByType.length !== 1) {
    throw new Error('FAIL: getEmployeeDocuments with docType filter failed');
  }

  const filteredByOtherType = await getEmployeeDocuments({
    employeeId: emp.id,
    workspaceId: ws.id,
    docType: 'education',
  });
  if (filteredByOtherType.length !== 0) {
    throw new Error('FAIL: getEmployeeDocuments returned documents for wrong type');
  }
  console.log('   PASSED: Document query and type filtering verified.');

  console.log('4. Testing Document Verification Workflow...');
  // Mark as verified
  const verifiedDoc = await updateDocumentVerification(doc.id, {
    workspaceId: ws.id,
    verificationStatus: 'verified',
    verificationNotes: 'Passport verified against government portal',
    verifiedBy: adminUserId,
  });

  if (verifiedDoc.verification_status !== 'verified') {
    throw new Error('FAIL: Document verification_status did not update to verified');
  }
  if (!verifiedDoc.verified_at || Number(verifiedDoc.verified_by) !== Number(adminUserId)) {
    throw new Error('FAIL: verified_at or verified_by not updated correctly');
  }

  // Mark as rejected with reason
  const rejectedDoc = await updateDocumentVerification(doc.id, {
    workspaceId: ws.id,
    verificationStatus: 'rejected',
    verificationNotes: 'Expired passport document',
    verifiedBy: adminUserId,
  });

  if (rejectedDoc.verification_status !== 'rejected') {
    throw new Error('FAIL: Document verification_status did not update to rejected');
  }
  if (rejectedDoc.verification_notes !== 'Expired passport document') {
    throw new Error('FAIL: Rejection notes not stored correctly');
  }
  console.log('   PASSED: Verification status transitions and notes verified.');

  console.log('5. Testing Secure Document File Streaming/Reading...');
  const readBuffer = await readEmployeeDocumentFile(doc.storage_key);
  if (readBuffer.toString('utf8') !== samplePdfContent.toString('utf8')) {
    throw new Error('FAIL: Read document buffer does not match uploaded content');
  }
  console.log('   PASSED: Document file binary stream verified.');

  console.log('6. Testing Document Authorization Guards (RBAC)...');
  const adminUser = { id: adminUserId, role: 'admin', email: 'admin@example.com' };
  const ownerUser = { id: testUserId, role: 'developer', email: testEmail };
  const peerUser = { id: 77777, role: 'developer', email: 'peer@example.com' };
  const clientUser = { id: 88888, role: 'client', email: 'client@example.com' };

  if (!canAccessEmployeeDocuments(adminUser, emp)) {
    throw new Error('FAIL: Admin should have access to employee documents');
  }
  if (!canAccessEmployeeDocuments(ownerUser, emp)) {
    throw new Error('FAIL: Owner employee should have access to their own documents');
  }
  if (canAccessEmployeeDocuments(peerUser, emp)) {
    throw new Error('FAIL: Peer developer should NOT have access to another employee documents');
  }
  if (canAccessEmployeeDocuments(clientUser, emp)) {
    throw new Error('FAIL: Client role should NOT have access to employee documents');
  }

  if (!canVerifyEmployeeDocuments(adminUser)) {
    throw new Error('FAIL: Admin should be authorized to verify documents');
  }
  if (canVerifyEmployeeDocuments(ownerUser) || canVerifyEmployeeDocuments(peerUser)) {
    throw new Error('FAIL: Non-admin should NOT be authorized to verify documents');
  }
  console.log('   PASSED: Authorization and permission checks verified.');

  console.log('7. Testing Document Deletion and Storage Cleanup...');
  // Soft delete
  await deleteEmployeeDocument(doc.id, ws.id, true);
  const afterSoftDel = await getEmployeeDocuments({ employeeId: emp.id, workspaceId: ws.id, includeDeleted: false });
  if (afterSoftDel.length !== 0) {
    throw new Error('FAIL: Soft deleted document should not appear in active documents');
  }

  // Hard delete
  await deleteEmployeeDocument(doc.id, ws.id, false);
  const afterHardDel = await getEmployeeDocument(doc.id, ws.id);
  if (afterHardDel !== null && afterHardDel !== undefined) {
    throw new Error('FAIL: Hard deleted document still found in database');
  }
  const fileExistsAfterDel = await fs.access(expectedDiskFile).then(() => true).catch(() => false);
  if (fileExistsAfterDel) {
    throw new Error('FAIL: File was not removed from local disk after hard delete');
  }
  console.log('   PASSED: Soft and hard document deletion verified.');

  console.log('8. Cleaning up test users and employee...');
  await deleteEmployee(emp.id, ws.id);
  await db.prepare('DELETE FROM users WHERE id IN (?, ?)').run(testUserId, adminUserId);
  console.log('   PASSED: Cleanup complete.');

  console.log('\n>>> ALL PHASE 4 TESTS PASSED SUCCESSFULLY! <<<');
}

runPhase4Tests().catch((err) => {
  console.error('\n*** TEST FAILED ***\n', err);
  process.exit(1);
});


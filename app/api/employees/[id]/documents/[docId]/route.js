import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getEmployee } from '@/lib/employees';
import {
  getEmployeeDocument,
  updateDocumentVerification,
  deleteEmployeeDocument,
  canAccessEmployeeDocuments,
  canVerifyEmployeeDocuments,
} from '@/lib/employeeDocs';

export const dynamic = 'force-dynamic';

export async function GET(request, { params }) {
  const session = await requireAuth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id, docId } = await params;
  const employeeId = Number(id);
  const documentId = Number(docId);

  const employee = await getEmployee(employeeId);
  if (!employee) {
    return NextResponse.json({ error: 'Employee not found.' }, { status: 404 });
  }

  if (!canAccessEmployeeDocuments(session.user, employee)) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
  }

  const document = await getEmployeeDocument(documentId, employee.workspace_id);
  if (!document || document.employee_id !== employeeId) {
    return NextResponse.json({ error: 'Document not found.' }, { status: 404 });
  }

  return NextResponse.json({ document });
}

export async function PATCH(request, { params }) {
  const session = await requireAuth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!canVerifyEmployeeDocuments(session.user)) {
    return NextResponse.json({ error: 'Forbidden: Only administrators can verify documents.' }, { status: 403 });
  }

  const { id, docId } = await params;
  const employeeId = Number(id);
  const documentId = Number(docId);

  const employee = await getEmployee(employeeId);
  if (!employee) {
    return NextResponse.json({ error: 'Employee not found.' }, { status: 404 });
  }

  const existing = await getEmployeeDocument(documentId, employee.workspace_id);
  if (!existing || existing.employee_id !== employeeId) {
    return NextResponse.json({ error: 'Document not found.' }, { status: 404 });
  }

  try {
    const body = await request.json();
    const { verification_status, verification_notes } = body;

    const updated = await updateDocumentVerification(documentId, {
      workspaceId: employee.workspace_id,
      verificationStatus: verification_status,
      verificationNotes: verification_notes,
      verifiedBy: session.user.id,
    });

    return NextResponse.json({ document: updated });
  } catch (err) {
    console.error('[api/employees/documents/[docId]] PATCH error:', err.message);
    return NextResponse.json({ error: err.message || 'Failed to update document status.' }, { status: 400 });
  }
}

export async function DELETE(request, { params }) {
  const session = await requireAuth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id, docId } = await params;
  const employeeId = Number(id);
  const documentId = Number(docId);

  const employee = await getEmployee(employeeId);
  if (!employee) {
    return NextResponse.json({ error: 'Employee not found.' }, { status: 404 });
  }

  const existing = await getEmployeeDocument(documentId, employee.workspace_id);
  if (!existing || existing.employee_id !== employeeId) {
    return NextResponse.json({ error: 'Document not found.' }, { status: 404 });
  }

  // Admin can delete any document; employee can delete their own only if still pending
  const isAdmin = session.user.role === 'admin';
  const isOwner = employee.user_id && Number(session.user.id) === Number(employee.user_id);
  if (!isAdmin && !(isOwner && existing.verification_status === 'pending')) {
    return NextResponse.json({ error: 'Forbidden: You cannot delete this document.' }, { status: 403 });
  }

  try {
    await deleteEmployeeDocument(documentId, employee.workspace_id, true);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[api/employees/documents/[docId]] DELETE error:', err.message);
    return NextResponse.json({ error: 'Failed to delete document.' }, { status: 500 });
  }
}


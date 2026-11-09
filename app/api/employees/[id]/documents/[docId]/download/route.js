import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getEmployee } from '@/lib/employees';
import {
  getEmployeeDocument,
  readEmployeeDocumentFile,
  canAccessEmployeeDocuments,
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
  if (!document || document.employee_id !== employeeId || document.deleted_at) {
    return NextResponse.json({ error: 'Document not found or removed.' }, { status: 404 });
  }

  try {
    const fileBuffer = await readEmployeeDocumentFile(document.storage_key);
    const safeFilename = String(document.file_name || 'document').replace(/[\r\n"]/g, '');

    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Type': document.mime_type || 'application/octet-stream',
        'Content-Length': String(fileBuffer.length),
        'Content-Disposition': `inline; filename="${safeFilename}"`,
        'Cache-Control': 'private, no-cache, no-store, must-revalidate',
      },
    });
  } catch (err) {
    console.error('[api/employees/documents/[docId]/download] Error:', err.message);
    return NextResponse.json({ error: 'Document file not found on storage.' }, { status: 404 });
  }
}


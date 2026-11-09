import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getEmployee } from '@/lib/employees';
import {
  getEmployeeDocuments,
  createEmployeeDocument,
  canAccessEmployeeDocuments,
  ALLOWED_DOC_TYPES,
  MAX_DOC_SIZE_BYTES,
} from '@/lib/employeeDocs';

export const dynamic = 'force-dynamic';

export async function GET(request, { params }) {
  const session = await requireAuth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const employeeId = Number(id);
  const employee = await getEmployee(employeeId);
  if (!employee) {
    return NextResponse.json({ error: 'Employee not found.' }, { status: 404 });
  }

  if (!canAccessEmployeeDocuments(session.user, employee)) {
    return NextResponse.json({ error: 'Forbidden: You do not have permission to view these documents.' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const docType = searchParams.get('doc_type') || null;
  const status = searchParams.get('status') || null;

  try {
    const documents = await getEmployeeDocuments({
      employeeId,
      workspaceId: employee.workspace_id,
      docType,
      verificationStatus: status,
    });
    return NextResponse.json({ documents });
  } catch (err) {
    console.error('[api/employees/documents] GET error:', err.message);
    return NextResponse.json({ error: 'Failed to fetch employee documents.' }, { status: 500 });
  }
}

export async function POST(request, { params }) {
  const session = await requireAuth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const employeeId = Number(id);
  const employee = await getEmployee(employeeId);
  if (!employee) {
    return NextResponse.json({ error: 'Employee not found.' }, { status: 404 });
  }

  if (!canAccessEmployeeDocuments(session.user, employee)) {
    return NextResponse.json({ error: 'Forbidden: You do not have permission to upload documents for this employee.' }, { status: 403 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get('file');
    const docType = formData.get('doc_type');
    const title = formData.get('title');

    if (!file || typeof file === 'string') {
      return NextResponse.json({ error: 'A file is required.' }, { status: 400 });
    }

    if (!docType || !ALLOWED_DOC_TYPES.includes(docType)) {
      return NextResponse.json({ error: `Invalid document type. Allowed types: ${ALLOWED_DOC_TYPES.join(', ')}` }, { status: 400 });
    }

    if (!title || !title.trim()) {
      return NextResponse.json({ error: 'Document title is required.' }, { status: 400 });
    }

    if (file.size > MAX_DOC_SIZE_BYTES) {
      return NextResponse.json({ error: 'File size exceeds maximum limit of 10MB.' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const document = await createEmployeeDocument({
      workspaceId: employee.workspace_id,
      employeeId,
      docType,
      title: title.trim(),
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type || 'application/octet-stream',
      buffer,
      uploadedBy: session.user.id,
    });

    return NextResponse.json({ document }, { status: 201 });
  } catch (err) {
    console.error('[api/employees/documents] POST error:', err.message);
    return NextResponse.json({ error: err.message || 'Failed to upload document.' }, { status: 500 });
  }
}


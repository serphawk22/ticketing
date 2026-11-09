'use client';

import { useState, useEffect, useRef } from 'react';

const DOC_TYPES = [
  { value: 'national_id', label: 'Identity / National ID' },
  { value: 'education', label: 'Educational Certificate' },
  { value: 'experience', label: 'Experience / Relieving Letter' },
  { value: 'offer_contract', label: 'Offer Letter / Contract' },
  { value: 'tax_finance', label: 'Tax / Financial Document' },
  { value: 'medical', label: 'Medical Certificate' },
  { value: 'other', label: 'Other Document' },
];

function formatBytes(bytes, decimals = 1) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function formatDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

export default function EmployeeDocumentsTab({ employeeId, isAdmin = false, currentUserId = null }) {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');

  // Upload state
  const [showUpload, setShowUpload] = useState(false);
  const [docType, setDocType] = useState('national_id');
  const [title, setTitle] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  // Reject state modal/dialog
  const [rejectingDocId, setRejectingDocId] = useState(null);
  const [rejectionNotes, setRejectionNotes] = useState('');

  async function loadDocuments() {
    if (!employeeId) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/employees/${employeeId}/documents`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load documents');
      setDocuments(data.documents || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDocuments();
  }, [employeeId]);

  async function handleUpload(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (!selectedFile) {
      setActionError('Please choose a file to upload.');
      return;
    }
    if (!title.trim()) {
      setActionError('Please enter a document title.');
      return;
    }

    setUploading(true);
    setActionError('');

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('doc_type', docType);
      formData.append('title', title.trim());

      const res = await fetch(`/api/employees/${employeeId}/documents`, {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to upload document');

      // Reset form
      setTitle('');
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      setShowUpload(false);
      await loadDocuments();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setUploading(false);
    }
  }

  async function handleVerify(docId) {
    setActionError('');
    try {
      const res = await fetch(`/api/employees/${employeeId}/documents/${docId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          verification_status: 'verified',
          verification_notes: '',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to verify document');
      await loadDocuments();
    } catch (err) {
      setActionError(err.message);
    }
  }

  async function handleRejectSubmit(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (!rejectingDocId) return;
    setActionError('');
    try {
      const res = await fetch(`/api/employees/${employeeId}/documents/${rejectingDocId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          verification_status: 'rejected',
          verification_notes: rejectionNotes.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to reject document');
      setRejectingDocId(null);
      setRejectionNotes('');
      await loadDocuments();
    } catch (err) {
      setActionError(err.message);
    }
  }

  async function handleDelete(docId) {
    if (!confirm('Are you sure you want to remove this document?')) return;
    setActionError('');
    try {
      const res = await fetch(`/api/employees/${employeeId}/documents/${docId}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete document');
      await loadDocuments();
    } catch (err) {
      setActionError(err.message);
    }
  }

  const getDocTypeLabel = (val) => {
    const item = DOC_TYPES.find((t) => t.value === val);
    return item ? item.label : val;
  };

  return (
    <div className="employee-docs-container" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header & Upload Toggle */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h4 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Employee Documents</h4>
          <span style={{ fontSize: 12, color: 'var(--text-subtle)' }}>
            Upload, verify, and track employment certificates and ID proofs
          </span>
        </div>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => {
            setShowUpload(!showUpload);
            setActionError('');
          }}
          style={{ fontSize: 12, padding: '4px 10px' }}
        >
          {showUpload ? 'Cancel Upload' : '+ Upload Document'}
        </button>
      </div>

      {actionError && (
        <div style={{ padding: '8px 12px', background: 'rgba(239, 68, 68, 0.1)', color: 'var(--danger, #ef4444)', borderRadius: 6, fontSize: 13 }}>
          {actionError}
        </div>
      )}

      {/* Upload Form Card */}
      {showUpload && (
        <div
          style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: 14,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          <div style={{ fontWeight: 600, fontSize: 13 }}>Upload New Document</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label style={{ fontSize: 12 }}>Document Type</label>
              <select
                value={docType}
                onChange={(e) => setDocType(e.target.value)}
                style={{ fontSize: 13, height: 34 }}
              >
                {DOC_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group" style={{ margin: 0 }}>
              <label style={{ fontSize: 12 }}>Document Title *</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleUpload(e);
                  }
                }}
                placeholder="e.g. Passport Copy or Degree"
                style={{ fontSize: 13, height: 34 }}
                required
              />
            </div>
          </div>

          <div className="form-group" style={{ margin: 0 }}>
            <label style={{ fontSize: 12 }}>Choose File (Max 10MB; PDF, PNG, JPG, DOCX)</label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx"
              onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
              style={{ fontSize: 12 }}
              required
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setShowUpload(false)}
              disabled={uploading}
              style={{ fontSize: 12, padding: '4px 10px' }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={handleUpload}
              disabled={uploading}
              style={{ fontSize: 12, padding: '4px 12px' }}
            >
              {uploading ? 'Uploading…' : 'Upload'}
            </button>
          </div>
        </div>
      )}

      {/* Reject Reason Modal / Inline Banner */}
      {rejectingDocId && (
        <div
          style={{
            background: 'rgba(239, 68, 68, 0.05)',
            border: '1px solid var(--danger, #ef4444)',
            borderRadius: 8,
            padding: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--danger, #ef4444)' }}>
            Reject Document Verification
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label style={{ fontSize: 12 }}>Rejection Reason / Notes for Employee</label>
            <input
              type="text"
              value={rejectionNotes}
              onChange={(e) => setRejectionNotes(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleRejectSubmit(e);
                }
              }}
              placeholder="e.g. Blurred document, missing page 2, expired"
              style={{ fontSize: 13, height: 34 }}
              required
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setRejectingDocId(null);
                setRejectionNotes('');
              }}
              style={{ fontSize: 12, padding: '3px 8px' }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleRejectSubmit}
              style={{
                background: 'var(--danger, #ef4444)',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                padding: '3px 10px',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              Confirm Rejection
            </button>
          </div>
        </div>
      )}

      {/* Documents List */}
      {loading ? (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-subtle)', fontSize: 13 }}>
          Loading employee documents…
        </div>
      ) : error ? (
        <div style={{ padding: 12, background: 'rgba(239, 68, 68, 0.1)', color: 'var(--danger, #ef4444)', borderRadius: 6, fontSize: 13 }}>
          {error}
        </div>
      ) : documents.length === 0 ? (
        <div
          style={{
            padding: 32,
            textAlign: 'center',
            border: '1px dashed var(--border)',
            borderRadius: 8,
            color: 'var(--text-subtle)',
            fontSize: 13,
          }}
        >
          No documents uploaded yet. Click "+ Upload Document" to add an identity or contract document.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {documents.map((doc) => {
            const isVerified = doc.verification_status === 'verified';
            const isRejected = doc.verification_status === 'rejected';
            const isPending = doc.verification_status === 'pending';

            const statusBg = isVerified
              ? 'rgba(34, 197, 94, 0.12)'
              : isRejected
              ? 'rgba(239, 68, 68, 0.12)'
              : 'rgba(234, 179, 8, 0.12)';
            const statusColor = isVerified
              ? '#15803d'
              : isRejected
              ? '#b91c1c'
              : '#b45309';

            return (
              <div
                key={doc.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 14px',
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  gap: 12,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{doc.title}</span>
                    <span
                      style={{
                        fontSize: 11,
                        background: 'var(--bg-hover)',
                        padding: '2px 6px',
                        borderRadius: 4,
                        color: 'var(--text-subtle)',
                      }}
                    >
                      {getDocTypeLabel(doc.doc_type)}
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        padding: '2px 8px',
                        borderRadius: 999,
                        background: statusBg,
                        color: statusColor,
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                      }}
                    >
                      {doc.verification_status}
                    </span>
                  </div>

                  <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 4 }}>
                    <span>{doc.file_name}</span> · <span>{formatBytes(doc.file_size)}</span> ·{' '}
                    <span>Uploaded {formatDate(doc.created_at)}</span>
                    {doc.verified_by_name && (
                      <span>
                        {' '}· {isVerified ? 'Verified by' : 'Rejected by'} {doc.verified_by_name}
                      </span>
                    )}
                  </div>

                  {isRejected && doc.verification_notes && (
                    <div style={{ fontSize: 12, color: 'var(--danger, #ef4444)', marginTop: 3 }}>
                      <strong>Reason:</strong> {doc.verification_notes}
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {/* Download */}
                  <a
                    href={`/api/employees/${employeeId}/documents/${doc.id}/download`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-secondary"
                    style={{ fontSize: 12, padding: '4px 8px', textDecoration: 'none' }}
                    title="View or download document"
                  >
                    View
                  </a>

                  {/* Admin Verification Controls */}
                  {isAdmin && (
                    <>
                      {!isVerified && (
                        <button
                          type="button"
                          onClick={() => handleVerify(doc.id)}
                          style={{
                            background: 'rgba(34, 197, 94, 0.15)',
                            color: '#15803d',
                            border: '1px solid rgba(34, 197, 94, 0.3)',
                            borderRadius: 4,
                            padding: '4px 8px',
                            fontSize: 12,
                            cursor: 'pointer',
                            fontWeight: 500,
                          }}
                          title="Mark verified"
                        >
                          Verify
                        </button>
                      )}
                      {!isRejected && (
                        <button
                          type="button"
                          onClick={() => {
                            setRejectingDocId(doc.id);
                            setRejectionNotes('');
                          }}
                          style={{
                            background: 'rgba(239, 68, 68, 0.1)',
                            color: '#b91c1c',
                            border: '1px solid rgba(239, 68, 68, 0.3)',
                            borderRadius: 4,
                            padding: '4px 8px',
                            fontSize: 12,
                            cursor: 'pointer',
                            fontWeight: 500,
                          }}
                          title="Reject document"
                        >
                          Reject
                        </button>
                      )}
                    </>
                  )}

                  {/* Delete */}
                  {(isAdmin || isPending) && (
                    <button
                      type="button"
                      onClick={() => handleDelete(doc.id)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--text-subtle)',
                        cursor: 'pointer',
                        padding: '4px',
                        fontSize: 14,
                      }}
                      title="Delete document"
                    >
                      ×
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}


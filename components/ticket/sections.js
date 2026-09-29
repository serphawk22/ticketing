'use client';

import { useRef, useState } from 'react';
import { formatShortDate, ticketKey, STATUS_META } from '../meta';
import { ChevronRight, PaperclipIcon, TrashIcon, UploadIcon } from './icons';

export function AttachmentsSection({ attachments, onUpload, onDelete, onOpen, canEdit, collapsed, onToggle }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');

  async function send(files) {
    const list = [...(files || [])];
    if (!list.length) return;
    setBusy(true);
    setError('');
    try {
      for (const file of list) await onUpload(file);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="tm-section">
      <button type="button" className="tm-section-toggle" onClick={onToggle} aria-expanded={!collapsed}>
        {collapsed ? <ChevronRight size={14} /> : <ChevronRight size={14} className="tm-rot90" />}
        <h3 className="tm-section-title">Attachments</h3>
        {attachments.length ? <span className="tm-count">{attachments.length}</span> : null}
      </button>

      {!collapsed && (
        <>
          {canEdit && (
            <div
              className={`tm-dropzone${dragging ? ' is-dragging' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                send(e.dataTransfer.files);
              }}
            >
              <input
                ref={inputRef}
                type="file"
                multiple
                className="tm-file-input"
                onChange={(e) => {
                  send(e.target.files);
                  e.target.value = '';
                }}
              />
              <button type="button" className="tm-dropzone-btn" onClick={() => inputRef.current?.click()} disabled={busy}>
                <UploadIcon size={16} />
                <span>{busy ? 'Uploading…' : 'Add attachment'}</span>
              </button>
              <span className="tm-hint">or drop files here</span>
            </div>
          )}

          {error && <p className="tm-error">{error}</p>}

          {attachments.length > 0 && (
            <ul className="tm-file-list">
              {attachments.map((file) => (
                <li key={file.id} className="tm-file">
                  <span className="tm-file-icon" aria-hidden="true">
                    <PaperclipIcon size={14} />
                  </span>
                  <button type="button" className="tm-file-name" onClick={() => onOpen(file)} title="Open attachment">
                    {file.filename}
                  </button>
                  <span className="tm-file-meta">
                    {formatShortDate(file.created_at)} · {Math.max(1, Math.round(file.size_bytes / 1024))} KB
                  </span>
                  {canEdit && (
                    <button
                      type="button"
                      className="tm-icon-btn tm-icon-danger"
                      onClick={() => onDelete(file)}
                      aria-label={`Remove ${file.filename}`}
                    >
                      <TrashIcon size={14} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

export function RelationsSection({
  title,
  items,
  emptyHint,
  relationLabel,
  onAdd,
  onRemove,
  onOpen,
  onToggle,
  collapsed,
  canEdit,
  addLabel,
  showAdd = true,
}) {
  return (
    <section className="tm-section">
      <button type="button" className="tm-section-toggle" onClick={onToggle} aria-expanded={!collapsed}>
        {collapsed ? <ChevronRight size={14} /> : <ChevronRight size={14} className="tm-rot90" />}
        <h3 className="tm-section-title">{title}</h3>
        {items.length ? <span className="tm-count">{items.length}</span> : null}
      </button>

      {!collapsed && (
        <>
          {canEdit && showAdd && (
            <button type="button" className="tm-add-link" onClick={onAdd}>
              {addLabel}
            </button>
          )}
          {items.length === 0 ? (
            <p className="tm-empty">{emptyHint}</p>
          ) : (
            <ul className="tm-link-list">
              {items.map((item) => (
                <li key={item.relation_id || item.id} className="tm-link-row">
                  <button type="button" className="tm-link-key" onClick={() => onOpen(item)}>
                    {ticketKey(item)}
                  </button>
                  <button type="button" className="tm-link-title tm-link-title-btn" onClick={() => onOpen(item)}>
                    {item.title}
                  </button>
                  {item.relation_type && (
                    <span className="tm-link-rel">{relationLabel(item.relation_type)}</span>
                  )}
                  <span className="tm-status-dot-wrap">
                    <span
                      className="tm-status-dot"
                      style={{ background: STATUS_META[item.status]?.color }}
                      title={STATUS_META[item.status]?.label}
                    />
                  </span>
                  {canEdit && onRemove && (
                    <button
                      type="button"
                      className="tm-icon-btn tm-icon-danger"
                      onClick={() => onRemove(item)}
                      aria-label={`Remove link to ${ticketKey(item)}`}
                    >
                      <TrashIcon size={14} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

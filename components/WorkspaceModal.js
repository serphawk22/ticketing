'use client';

import { useEffect, useState } from 'react';
import { PROJECT_COLORS } from './meta';

export default function WorkspaceModal({ workspace, onClose, onSave }) {
  const isEdit = Boolean(workspace);
  const [key, setKey] = useState(workspace?.key || '');
  const [name, setName] = useState(workspace?.name || '');
  const [description, setDescription] = useState(workspace?.description || '');
  const [color, setColor] = useState(workspace?.color || PROJECT_COLORS[0]);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      const res = await fetch(
        isEdit ? `/api/workspaces/${workspace.id}` : '/api/workspaces',
        {
          method: isEdit ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key, name, description, color }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save work space.');
      onSave(data.workspace);
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? 'Edit work space' : 'Create work space'}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header>
          <h3>
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path d="M3 10h18" />
            </svg>
            {isEdit ? 'Edit work space' : 'New work space'}
          </h3>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <form onSubmit={handleSubmit}>
          <div className="form-row">
            <div className="form-group form-group-narrow">
              <label htmlFor="workspace-key">Key</label>
              <input
                id="workspace-key"
                type="text"
                value={key}
                onChange={(e) => setKey(e.target.value.toUpperCase().slice(0, 6))}
                placeholder="SRP"
                maxLength={6}
                required
                autoFocus
                readOnly={isEdit}
              />
            </div>

            <div className="form-group">
              <label htmlFor="workspace-name">Name</label>
              <input
                id="workspace-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="SerpHawk"
                required
              />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="workspace-description">Description</label>
            <textarea
              id="workspace-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this work space cover?"
            />
          </div>

          <div className="form-group">
            <label id="workspace-color-label">Color</label>
            <div
              className="color-swatches"
              role="radiogroup"
              aria-labelledby="workspace-color-label"
            >
              {PROJECT_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={c === color}
                  aria-label={`Use color ${c}`}
                  className={`color-swatch${c === color ? ' selected' : ''}`}
                  style={{ background: c }}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
          </div>

          {error && <div className="error-text">{error}</div>}

          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting
                ? 'Saving…'
                : isEdit
                  ? 'Save changes'
                  : 'Create work space'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

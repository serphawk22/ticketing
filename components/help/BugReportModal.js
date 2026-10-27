'use client';

import { useState, useEffect, useRef } from 'react';

export default function BugReportModal({ open, onClose, onToast }) {
  const [reportType, setReportType] = useState('bug');
  const [priority, setPriority] = useState('medium');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [affectedUrl, setAffectedUrl] = useState('');
  const [screenshot, setScreenshot] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const fileInputRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    if (typeof window !== 'undefined') {
      setAffectedUrl(window.location.href);
    }
    setError('');
    setResult(null);

    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!screenshot) {
      setPreviewUrl('');
      return;
    }
    const url = URL.createObjectURL(screenshot);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [screenshot]);

  if (!open) return null;

  function handleFileChange(e) {
    setError('');
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      setError('Screenshot exceeds maximum size of 5 MB.');
      return;
    }

    if (!file.type.startsWith('image/')) {
      setError('Only image files (PNG, JPEG, WebP, GIF) are accepted.');
      return;
    }

    setScreenshot(file);
  }

  function handleRemoveScreenshot() {
    setScreenshot(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setResult(null);
    setLoading(true);

    try {
      const formData = new FormData();
      formData.append('type', reportType);
      formData.append('priority', priority);
      formData.append('title', title.trim());
      formData.append('description', description.trim());
      formData.append('affected_url', affectedUrl.trim());
      if (screenshot) {
        formData.append('screenshot', screenshot);
      }

      const res = await fetch('/api/feedback', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to submit bug report.');
      }

      setResult(data);
      onToast?.({
        message: data.duplicate
          ? `Duplicate detected: Tracked under ${data.ticket.key}.`
          : `Bug report logged as ${data.ticket.key}.`,
      });

      // Clear input fields on successful creation
      if (!data.duplicate) {
        setTitle('');
        setDescription('');
        handleRemoveScreenshot();
      }
    } catch (err) {
      setError(err.message || 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="bug-modal-title">
      <div className="modal-panel bug-modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-head-title-wrap">
            <h2 id="bug-modal-title" className="modal-title">
              {reportType === 'feedback' ? 'Send Feedback' : 'Report a Problem'}
            </h2>
            <p className="modal-subtitle">
              Help us improve Ticket Manager by reporting bugs or sharing your thoughts.
            </p>
          </div>
          <button type="button" className="icon-btn modal-close" onClick={onClose} aria-label="Close dialog">
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="bug-modal-form">
          {error && (
            <div className="auth-split-alert" role="alert">
              <span>{error}</span>
            </div>
          )}

          {result && (
            <div className={`bug-result-banner${result.duplicate ? ' is-duplicate' : ' is-success'}`}>
              <div className="bug-result-icon">
                {result.duplicate ? '⚠️' : '✓'}
              </div>
              <div className="bug-result-text">
                <strong>{result.duplicate ? 'Already Reported' : 'Report Logged'}</strong>
                <p>{result.message}</p>
                {result.attachmentWarning && (
                  <p className="bug-warning-text">{result.attachmentWarning}</p>
                )}
              </div>
            </div>
          )}

          <div className="bug-type-segmented" role="radiogroup" aria-label="Feedback type">
            <button
              type="button"
              className={`bug-type-btn${reportType === 'bug' ? ' is-active' : ''}`}
              onClick={() => setReportType('bug')}
            >
              🐛 Bug Report
            </button>
            <button
              type="button"
              className={`bug-type-btn${reportType === 'feedback' ? ' is-active' : ''}`}
              onClick={() => setReportType('feedback')}
            >
              💡 Suggestion / Feedback
            </button>
          </div>

          <div className="form-row-split">
            <div className="form-field flex-2">
              <label htmlFor="bug-title">Title / Summary</label>
              <input
                id="bug-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={reportType === 'feedback' ? 'Short summary of your suggestion' : 'Briefly summarize the issue'}
                required
                autoFocus
                disabled={loading}
              />
            </div>

            <div className="form-field flex-1">
              <label htmlFor="bug-priority">Severity</label>
              <select
                id="bug-priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                disabled={loading}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
          </div>

          <div className="form-field">
            <label htmlFor="bug-desc">Detailed Description</label>
            <textarea
              id="bug-desc"
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What steps did you take? What happened, and what did you expect to happen instead?"
              required
              disabled={loading}
            />
          </div>

          <div className="form-field">
            <label htmlFor="bug-url">Affected Page URL</label>
            <input
              id="bug-url"
              type="text"
              value={affectedUrl}
              onChange={(e) => setAffectedUrl(e.target.value)}
              placeholder="URL where the issue occurred"
              disabled={loading}
            />
          </div>

          <div className="form-field">
            <label>Screenshot (Optional, max 5MB)</label>
            <input
              type="file"
              ref={fileInputRef}
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={handleFileChange}
              style={{ display: 'none' }}
              disabled={loading}
            />

            {!screenshot ? (
              <button
                type="button"
                className="screenshot-drop-zone"
                onClick={() => fileInputRef.current?.click()}
                disabled={loading}
              >
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <polyline points="21 15 16 10 5 21" />
                </svg>
                <span>Click to attach a screenshot (PNG, JPEG, WebP)</span>
              </button>
            ) : (
              <div className="screenshot-preview-bar">
                {previewUrl && (
                  <img src={previewUrl} alt="Screenshot preview" className="screenshot-thumb" />
                )}
                <span className="screenshot-name">{screenshot.name}</span>
                <span className="screenshot-size">({(screenshot.size / 1024).toFixed(0)} KB)</span>
                <button
                  type="button"
                  className="icon-btn screenshot-remove-btn"
                  onClick={handleRemoveScreenshot}
                  disabled={loading}
                  title="Remove screenshot"
                >
                  ×
                </button>
              </div>
            )}
          </div>

          <div className="modal-foot">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={loading}>
              {result ? 'Done' : 'Cancel'}
            </button>
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? 'Submitting…' : reportType === 'feedback' ? 'Send Feedback' : 'Submit Bug Report'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}


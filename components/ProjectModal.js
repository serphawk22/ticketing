'use client';

import { useEffect, useState } from 'react';
import { PROJECT_COLORS } from './meta';

export default function ProjectModal({
  project,
  workspaces = [],
  clients = [],
  initialWorkspaceId = null,
  onClose,
  onSave,
}) {
  const isEdit = Boolean(project);
  const [key, setKey] = useState(project?.key || '');
  const [name, setName] = useState(project?.name || '');
  const [description, setDescription] = useState(project?.description || '');
  const [color, setColor] = useState(project?.color || PROJECT_COLORS[0]);
  const [clientId, setClientId] = useState(
    project?.client_id != null ? String(project.client_id) : ''
  );
  const [githubRepo, setGithubRepo] = useState(project?.github_repo || '');
  const [githubToken, setGithubToken] = useState('');
  const [clearGithubToken, setClearGithubToken] = useState(false);
  const tokenSaved = Number(project?.github_token_set) === 1;
  // A project created from inside a work space starts there rather than in the
  // "No work space" default, so the picker agrees with where the user clicked.
  const [workspaceId, setWorkspaceId] = useState(
    project?.workspace_id != null
      ? String(project.workspace_id)
      : initialWorkspaceId != null
        ? String(initialWorkspaceId)
        : ''
  );
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
        isEdit ? `/api/projects/${project.id}` : '/api/projects',
        {
          method: isEdit ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            key,
            name,
            description,
            color,
            workspace_id: workspaceId === '' ? null : Number(workspaceId),
            client_id: clientId === '' ? null : Number(clientId),
            github_repo: githubRepo.trim(),
            ...(githubToken.trim() ? { github_token: githubToken.trim() } : {}),
            ...(isEdit && clearGithubToken ? { clear_github_token: true } : {}),
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save project.');
      onSave(data.project);
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
        aria-label={isEdit ? 'Edit project' : 'Create project'}
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
              <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
            </svg>
            {isEdit ? 'Edit project' : 'New project'}
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
              <label htmlFor="project-key">Key</label>
              <input
                id="project-key"
                type="text"
                value={key}
                onChange={(e) => setKey(e.target.value.toUpperCase().slice(0, 6))}
                placeholder="WEB"
                maxLength={6}
                required
                autoFocus
                readOnly={isEdit}
              />
            </div>

            <div className="form-group">
              <label htmlFor="project-name">Name</label>
              <input
                id="project-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Web Platform"
                required
              />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="project-description">Description</label>
            <textarea
              id="project-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this project cover?"
            />
          </div>

          {workspaces.length > 0 && (
            <div className="form-group">
              <label htmlFor="project-workspace">Work space</label>
              <select
                id="project-workspace"
                value={workspaceId}
                onChange={(e) => setWorkspaceId(e.target.value)}
              >
                <option value="">No work space</option>
                {workspaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="form-group">
            <label htmlFor="project-client">Client (optional)</label>
            <select
              id="project-client"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              disabled={clients.length === 0}
            >
              <option value="">No client</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.email ? `${c.name} — ${c.email}` : c.name}
                </option>
              ))}
            </select>
            {clients.length === 0 && (
              <p className="field-hint">
                Add a client account from the Employees page to assign one here.
              </p>
            )}
          </div>

          <div className="form-group">
            <label htmlFor="project-github-repo">GitHub repo</label>
            <input
              id="project-github-repo"
              type="text"
              value={githubRepo}
              onChange={(e) => setGithubRepo(e.target.value)}
              placeholder="owner/repo or owner/a, owner/b"
              autoComplete="off"
              spellCheck={false}
            />
            <p className="field-hint">
              Task-sheet activity for this project is searched only in these
              repos. Example: serphawk22/ticketing
            </p>
          </div>

          <div className="form-group">
            <label htmlFor="project-github-token">GitHub token</label>
            <input
              id="project-github-token"
              type="password"
              value={githubToken}
              onChange={(e) => {
                setGithubToken(e.target.value);
                if (e.target.value.trim()) setClearGithubToken(false);
              }}
              placeholder={
                tokenSaved
                  ? 'Token saved — paste a new one to replace it'
                  : 'github_pat_… or ghp_…'
              }
              autoComplete="new-password"
              spellCheck={false}
              disabled={clearGithubToken}
            />
            <p className="field-hint">
              Used only on the server to read this project&apos;s pull requests
              and commits. It is not shown again after you save.
            </p>
            {isEdit && tokenSaved && (
              <label className="field-hint" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={clearGithubToken}
                  onChange={(e) => {
                    setClearGithubToken(e.target.checked);
                    if (e.target.checked) setGithubToken('');
                  }}
                />
                Remove the saved token
              </label>
            )}
          </div>

          <div className="form-group">
            <label id="project-color-label">Color</label>
            <div className="color-swatches" role="radiogroup" aria-labelledby="project-color-label">
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
              {submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Create project'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

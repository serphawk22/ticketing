'use client';

import { useEffect, useState } from 'react';
import { PROJECT_COLORS } from './meta';
import { isValidProjectKey } from '@/lib/projectValidation';

export default function ProjectModal({
  project,
  workspaces = [],
  // Callers that already have the client accounts (the Projects page) pass
  // them in. Every other entry point (board, sidebar) leaves this undefined
  // and the modal loads the list itself, so the picker is never empty
  // just because of where it was opened from.
  clients,
  initialWorkspaceId = null,
  onClose,
  onSave,
  onWorkspaceCreated,
}) {
  const isEdit = Boolean(project);
  const [localWorkspaces, setLocalWorkspaces] = useState(workspaces);
  const [key, setKey] = useState(project?.key || '');
  const [name, setName] = useState(project?.name || '');
  const [description, setDescription] = useState(project?.description || '');
  const [color, setColor] = useState(project?.color || PROJECT_COLORS[0]);
  const [clientId, setClientId] = useState(
    project?.client_id != null ? String(project.client_id) : ''
  );
  const [githubRepo, setGithubRepo] = useState(project?.github_repo || '');
  const [targetEndDate, setTargetEndDate] = useState(
    project?.target_end_date ? String(project.target_end_date).slice(0, 10) : ''
  );
  // A project created from inside a work space starts there rather than in the
  // "No work space" default, so the picker agrees with where the user clicked.
  const [workspaceId, setWorkspaceId] = useState(
    project?.workspace_id != null
      ? String(project.workspace_id)
      : initialWorkspaceId != null
        ? String(initialWorkspaceId)
        : workspaces[0]?.id != null
          ? String(workspaces[0].id)
          : ''
  );
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [fetchedClients, setFetchedClients] = useState(null);
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [newWorkspaceKey, setNewWorkspaceKey] = useState('');
  const [workspaceKeyEdited, setWorkspaceKeyEdited] = useState(false);
  const [workspaceCreating, setWorkspaceCreating] = useState(false);
  const [workspaceError, setWorkspaceError] = useState('');

  // Multi-repository management state for existing projects
  const [repositories, setRepositories] = useState([]);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [newRepoInput, setNewRepoInput] = useState('');
  const [repoActionLoading, setRepoActionLoading] = useState(false);
  const [repoError, setRepoError] = useState('');
  const [repoSuccess, setRepoSuccess] = useState('');

  const loadProjectRepos = async () => {
    if (!project?.id) return;
    setLoadingRepos(true);
    try {
      const res = await fetch(`/api/projects/${project.id}/repositories?includeInactive=true`);
      if (res.ok) {
        const data = await res.json();
        setRepositories(data.repositories || []);
      }
    } catch {
      // ignore
    } finally {
      setLoadingRepos(false);
    }
  };

  useEffect(() => {
    if (isEdit && project?.id) {
      loadProjectRepos();
    }
  }, [isEdit, project?.id]);

  const handleAddRepo = async (e) => {
    e?.preventDefault();
    setRepoError('');
    setRepoSuccess('');
    const trimmed = newRepoInput.trim();
    if (!trimmed) {
      setRepoError('Enter repository in owner/repo format.');
      return;
    }
    setRepoActionLoading(true);
    try {
      const res = await fetch(`/api/projects/${project.id}/repositories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRepoError(data.error || 'Failed to add repository.');
      } else {
        setRepoSuccess(`Repository ${trimmed} added and verified.`);
        setNewRepoInput('');
        loadProjectRepos();
      }
    } catch {
      setRepoError('Network error adding repository.');
    } finally {
      setRepoActionLoading(false);
    }
  };

  const handleToggleRepoActive = async (repo) => {
    setRepoError('');
    setRepoSuccess('');
    setRepoActionLoading(true);
    try {
      const res = await fetch(`/api/projects/${project.id}/repositories/${repo.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: repo.is_active ? 0 : 1 }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRepoError(data.error || 'Failed to update repository status.');
      } else {
        loadProjectRepos();
      }
    } catch {
      setRepoError('Network error updating repository.');
    } finally {
      setRepoActionLoading(false);
    }
  };

  const handleDeleteRepo = async (repo) => {
    setRepoError('');
    setRepoSuccess('');
    if (!window.confirm(`Are you sure you want to delete ${repo.github_owner}/${repo.github_repo}? If tickets reference it, you will need to deactivate it instead.`)) {
      return;
    }
    setRepoActionLoading(true);
    try {
      const res = await fetch(`/api/projects/${project.id}/repositories/${repo.id}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) {
        setRepoError(data.error || 'Failed to delete repository.');
      } else {
        setRepoSuccess('Repository deleted successfully.');
        loadProjectRepos();
      }
    } catch {
      setRepoError('Network error deleting repository.');
    } finally {
      setRepoActionLoading(false);
    }
  };

  useEffect(() => {
    setLocalWorkspaces(workspaces);
  }, [workspaces]);

  // The workspace list can arrive after the modal mounts. A select with no value
  // would visually show its first option while submitting no workspace, so keep
  // the state aligned with the option the browser is showing.
  useEffect(() => {
    if (isEdit || initialWorkspaceId != null) return;
    setWorkspaceId((current) =>
      current || (workspaces[0]?.id != null ? String(workspaces[0].id) : '')
    );
  }, [workspaces, isEdit, initialWorkspaceId]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Only client accounts can be picked, and only admins can read them. A
  // non-admin (or a failed fetch) simply keeps the picker empty.
  useEffect(() => {
    if (clients !== undefined) return;
    let live = true;
    (async () => {
      try {
        const res = await fetch('/api/users');
        if (!res.ok) return;
        const data = await res.json();
        if (live) {
          setFetchedClients((data.users || []).filter((u) => u.role === 'client'));
        }
      } catch {
        // Picker stays on "No client".
      }
    })();
    return () => {
      live = false;
    };
  }, [clients]);

  const clientOptions = clients !== undefined ? clients : fetchedClients || [];

  function suggestWorkspaceKey(value) {
    const words = value
      .trim()
      .split(/\s+/)
      .map((word) => word.replace(/[^a-z0-9]/gi, ''))
      .filter(Boolean);
    if (!words.length) return '';
    if (words.length === 1) return words[0].slice(0, 6).toUpperCase();
    return words
      .map((word) => word[0])
      .join('')
      .slice(0, 6)
      .toUpperCase();
  }

  function openWorkspaceCreator() {
    setCreatingWorkspace(true);
    setWorkspaceError('');
    setNewWorkspaceName('');
    setNewWorkspaceKey('');
    setWorkspaceKeyEdited(false);
  }

  async function handleCreateWorkspace(e) {
    e?.preventDefault();
    e?.stopPropagation();
    setWorkspaceError('');

    const trimmedName = newWorkspaceName.trim();
    const trimmedKey = newWorkspaceKey.trim().toUpperCase();

    if (!trimmedName) {
      setWorkspaceError('Workspace name is required.');
      return;
    }
    if (!isValidProjectKey(trimmedKey)) {
      setWorkspaceError('Workspace key must be 2-6 letters or numbers.');
      return;
    }
    if (
      localWorkspaces.some(
        (w) => String(w.name || '').trim().toLowerCase() === trimmedName.toLowerCase()
      )
    ) {
      setWorkspaceError('A workspace with that name already exists.');
      return;
    }
    if (
      localWorkspaces.some(
        (w) => String(w.key || '').trim().toUpperCase() === trimmedKey
      )
    ) {
      setWorkspaceError(`Workspace key ${trimmedKey} is already in use.`);
      return;
    }

    setWorkspaceCreating(true);
    try {
      const res = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmedName,
          key: trimmedKey,
          description: '',
          color,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create workspace.');

      const created = data.workspace;
      setLocalWorkspaces((prev) => [...prev, created]);
      setWorkspaceId(String(created.id));
      setCreatingWorkspace(false);
      setNewWorkspaceName('');
      setNewWorkspaceKey('');
      await onWorkspaceCreated?.(created);
    } catch (err) {
      setWorkspaceError(err.message);
    } finally {
      setWorkspaceCreating(false);
    }
  }

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
            target_end_date: targetEndDate.trim() || null,
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

          <div className="form-group">
            <label htmlFor="project-workspace">Workspace</label>
            <select
              id="project-workspace"
              value={workspaceId}
              onChange={(e) => {
                if (e.target.value === '__create') {
                  openWorkspaceCreator();
                  return;
                }
                setWorkspaceId(e.target.value);
              }}
            >
              {(localWorkspaces.length === 0 || (isEdit && project?.workspace_id == null)) && (
                <option value="">
                  {isEdit ? 'No workspace (legacy)' : 'No workspace yet'}
                </option>
              )}
              {localWorkspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
              <option value="__create">+ Create new workspace</option>
            </select>

            {creatingWorkspace && (
              <div className="workspace-create-panel">
                <div className="workspace-create-fields">
                  <div className="form-group">
                    <label htmlFor="new-workspace-name">Name</label>
                    <input
                      id="new-workspace-name"
                      type="text"
                      value={newWorkspaceName}
                      onChange={(e) => {
                        const value = e.target.value;
                        setNewWorkspaceName(value);
                        if (!workspaceKeyEdited) setNewWorkspaceKey(suggestWorkspaceKey(value));
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleCreateWorkspace(e);
                      }}
                      placeholder="Operations"
                      autoFocus
                    />
                  </div>
                  <div className="form-group form-group-narrow">
                    <label htmlFor="new-workspace-key">Key</label>
                    <input
                      id="new-workspace-key"
                      type="text"
                      value={newWorkspaceKey}
                      onChange={(e) => {
                        setWorkspaceKeyEdited(true);
                        setNewWorkspaceKey(e.target.value.toUpperCase().slice(0, 6));
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleCreateWorkspace(e);
                      }}
                      placeholder="OPS"
                      maxLength={6}
                    />
                  </div>
                </div>
                {workspaceError && <p className="form-error">{workspaceError}</p>}
                <div className="workspace-create-actions">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      setCreatingWorkspace(false);
                      setWorkspaceError('');
                    }}
                    disabled={workspaceCreating}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={handleCreateWorkspace}
                    disabled={workspaceCreating}
                  >
                    {workspaceCreating ? 'Creating...' : 'Create workspace'}
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="form-group">
            <label htmlFor="project-client">Client (optional)</label>
            <select
              id="project-client"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              disabled={clientOptions.length === 0}
            >
              <option value="">No client</option>
              {clientOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.email ? `${c.name} — ${c.email}` : c.name}
                </option>
              ))}
            </select>
            {clientOptions.length === 0 && (
              <p className="field-hint">
                Add a client account from the Employees page to assign one here.
              </p>
            )}
          </div>

          <div className="form-group">
            <label htmlFor="project-target-end-date">Target Delivery Date (optional)</label>
            <input
              id="project-target-end-date"
              type="date"
              value={targetEndDate}
              onChange={(e) => setTargetEndDate(e.target.value)}
            />
            <p className="field-hint">
              Overall project delivery target date (independent of individual ticket due dates).
            </p>
          </div>

          {isEdit ? (
            <div className="form-group" style={{ borderTop: '1px solid var(--border, #dfe1e6)', paddingTop: '16px', marginTop: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <label style={{ margin: 0, fontWeight: 600 }}>GitHub Repositories</label>
                <span style={{ fontSize: '12px', color: 'var(--muted, #666)' }}>
                  {repositories.length} configured
                </span>
              </div>
              <p className="field-hint" style={{ marginTop: 0, marginBottom: '12px' }}>
                All tickets in this project must be assigned to one of the active repositories below.
              </p>

              {loadingRepos ? (
                <div style={{ fontSize: '13px', color: 'var(--muted, #666)', padding: '12px 0' }}>Loading repositories…</div>
              ) : repositories.length === 0 ? (
                <div style={{ fontSize: '13px', color: '#de350b', padding: '8px 0', background: '#ffebe6', borderRadius: '4px', textAlign: 'center', marginBottom: '12px' }}>
                  No repositories configured yet. Add at least one repository so team members can create tickets.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
                  {repositories.map((r) => (
                    <div
                      key={r.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '8px 12px',
                        background: r.is_active ? 'var(--subtle, #f4f5f7)' : '#f9f9f9',
                        border: '1px solid var(--border, #dfe1e6)',
                        borderRadius: '6px',
                        opacity: r.is_active ? 1 : 0.65,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <a
                          href={r.repository_url || `https://github.com/${r.github_owner}/${r.github_repo}`}
                          target="_blank"
                          rel="noreferrer"
                          style={{ fontWeight: 600, color: 'var(--link, #0c66e4)', textDecoration: 'none', fontSize: '13px' }}
                        >
                          {r.github_owner}/{r.github_repo}
                        </a>
                        <span
                          style={{
                            fontSize: '11px',
                            padding: '1px 6px',
                            borderRadius: '10px',
                            background: r.verification_status === 'verified' ? '#e3fcef' : '#fffae6',
                            color: r.verification_status === 'verified' ? '#216e4e' : '#974f0c',
                            fontWeight: 500,
                          }}
                        >
                          {r.verification_status === 'verified' ? 'Verified' : 'Unverified'}
                        </span>
                        {!r.is_active && (
                          <span
                            style={{
                              fontSize: '11px',
                              padding: '1px 6px',
                              borderRadius: '10px',
                              background: '#ebecf0',
                              color: '#5e6c84',
                            }}
                          >
                            Deactivated
                          </span>
                        )}
                        <span style={{ fontSize: '11px', color: 'var(--muted, #666)' }}>
                          {r.ticket_count || 0} ticket{r.ticket_count === 1 ? '' : 's'}
                        </span>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <button
                          type="button"
                          className="btn-secondary"
                          style={{ fontSize: '11px', padding: '3px 8px', height: 'auto' }}
                          disabled={repoActionLoading}
                          onClick={() => handleToggleRepoActive(r)}
                          title={r.is_active ? 'Deactivate repo so it cannot be selected for new tickets' : 'Re-activate repo'}
                        >
                          {r.is_active ? 'Deactivate' : 'Activate'}
                        </button>
                        <button
                          type="button"
                          className="btn-secondary"
                          style={{ fontSize: '11px', padding: '3px 8px', height: 'auto', color: '#de350b' }}
                          disabled={repoActionLoading}
                          onClick={() => handleDeleteRepo(r)}
                          title="Delete repository (only allowed if no tickets reference it)"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ background: 'var(--subtle, #f4f5f7)', padding: '12px', borderRadius: '6px' }}>
                <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                  Add Repository
                </label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="text"
                    value={newRepoInput}
                    onChange={(e) => setNewRepoInput(e.target.value)}
                    placeholder="e.g. facebook/react or owner/repo"
                    style={{ flex: 1, fontSize: '13px' }}
                    disabled={repoActionLoading}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={handleAddRepo}
                    disabled={repoActionLoading || !newRepoInput.trim()}
                    style={{ whiteSpace: 'nowrap' }}
                  >
                    {repoActionLoading ? 'Verifying…' : 'Add Repository'}
                  </button>
                </div>
                {repoError && (
                  <div style={{ color: '#de350b', fontSize: '12px', marginTop: '6px' }}>{repoError}</div>
                )}
                {repoSuccess && (
                  <div style={{ color: '#216e4e', fontSize: '12px', marginTop: '6px' }}>{repoSuccess}</div>
                )}
              </div>
            </div>
          ) : (
            <div className="form-group">
              <label htmlFor="project-github-repo">GitHub repo (optional)</label>
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
                Enter one or more comma-separated GitHub repositories (e.g. facebook/react, org/backend).
                You can manage and verify additional repositories anytime after creation.
              </p>
            </div>
          )}

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

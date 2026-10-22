'use client';

import { useEffect, useState } from 'react';

function formatWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function stateLabel(state) {
  if (state === 'merged') return 'Merged';
  if (state === 'closed') return 'Closed';
  return 'Open';
}

/**
 * Pull requests and commits that mention a linked task key (e.g. TM-594).
 * Renders under each selected card on the daily work form.
 */
export default function TaskSheetGithubActivity({ ticketKey, projectId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ticketKey) return undefined;

    const controller = new AbortController();
    setLoading(true);
    setError('');
    setData(null);

    const params = new URLSearchParams({ ticketKey });
    if (projectId != null) params.set('projectId', String(projectId));

    fetch(`/api/github/activity?${params}`, { signal: controller.signal })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || 'Could not load GitHub activity.');
        return body;
      })
      .then((body) => {
        if (!controller.signal.aborted) setData(body);
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        if (!controller.signal.aborted) setError(err.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [ticketKey, projectId]);

  const pulls = data?.pulls || [];
  const commits = data?.commits || [];
  const empty =
    data?.configured &&
    !data.message &&
    pulls.length === 0 &&
    commits.length === 0;

  return (
    <div className="ts-github" role="region" aria-label={`GitHub activity for ${ticketKey}`}>
      <div className="ts-github-header">
        <span className="ts-github-title">GitHub activity</span>
        <span className="ts-github-key">mentions {ticketKey}</span>
      </div>

      {loading && <p className="ts-github-status">Loading pulls and commits…</p>}

      {!loading && error && (
        <p className="ts-github-status is-error" role="alert">
          {error}
        </p>
      )}

      {!loading && !error && data?.message && (
        <p className="ts-github-status">{data.message}</p>
      )}

      {!loading && !error && empty && (
        <p className="ts-github-status">
          No pull requests or commits mention {ticketKey} yet. Include the key
          in PR titles or commit messages to surface them here.
        </p>
      )}

      {!loading && !error && pulls.length > 0 && (
        <ul className="ts-github-list">
          {pulls.map((pr) => (
            <li key={`pr-${pr.id}`} className="ts-github-item">
              <span className={`ts-github-badge is-${pr.state}`}>{stateLabel(pr.state)}</span>
              <a href={pr.url} target="_blank" rel="noreferrer" className="ts-github-link">
                #{pr.number} {pr.title}
              </a>
              <span className="ts-github-meta">
                {pr.author ? `${pr.author} · ` : ''}
                {formatWhen(pr.updatedAt)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {!loading && !error && commits.length > 0 && (
        <ul className="ts-github-list">
          {commits.map((c) => (
            <li key={`c-${c.sha}`} className="ts-github-item">
              <span className="ts-github-badge is-commit">{c.shortSha}</span>
              <a href={c.url} target="_blank" rel="noreferrer" className="ts-github-link">
                {c.message || '(no message)'}
              </a>
              <span className="ts-github-meta">
                {c.author ? `${c.author} · ` : ''}
                {formatWhen(c.date)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

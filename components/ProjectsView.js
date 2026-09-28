'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AppShell from '@/components/AppShell';
import ProjectModal from '@/components/ProjectModal';
import ConfirmModal from '@/components/ConfirmModal';

export default function ProjectsView({ initialProjects, currentUser, myIssuesCount }) {
  const [projects, setProjects] = useState(initialProjects);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [error, setError] = useState('');
  const router = useRouter();

  const isAdmin = currentUser.role === 'admin';

  async function refresh() {
    const res = await fetch('/api/projects');
    const data = await res.json();
    if (res.ok) setProjects(data.projects);
  }

  async function handleSave() {
    setEditing(null);
    await refresh();
    router.refresh();
  }

  async function handleDelete() {
    setError('');
    try {
      const res = await fetch(`/api/projects/${deleting.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete project.');
      setDeleting(null);
      await refresh();
      router.refresh();
    } catch (e) {
      setDeleting(null);
      setError(e.message);
    }
  }

  return (
    <AppShell
      currentUser={currentUser}
      projects={projects}
      projectCounts={null}
      myIssuesCount={myIssuesCount}
      view="projects"
      filter="all"
      onFilterChange={() => router.push('/')}
      projectId="all"
      onProjectChange={() => router.push('/')}
      onCreate={isAdmin ? () => setEditing({ isNew: true }) : null}
    >
      <div className="board">
        {error && (
          <div className="error-banner">
            <strong>Error:</strong> {error}
            <button type="button" onClick={() => setError('')}>
              Dismiss
            </button>
          </div>
        )}

        <div className="board-toolbar">
          <div className="toolbar-title">
            <nav className="breadcrumb" aria-label="Breadcrumb">
              <Link href="/projects">Projects</Link>
            </nav>
            <h1>Projects</h1>
            <p className="board-subtitle">
              {projects.length} {projects.length === 1 ? 'project' : 'projects'}
            </p>
          </div>

          {isAdmin && (
            <div className="toolbar-actions">
              <button
                className="btn-primary"
                onClick={() => setEditing({ isNew: true })}
              >
                <svg
                  viewBox="0 0 24 24"
                  width="15"
                  height="15"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <path d="M12 5v14M5 12h14" />
                </svg>
                New project
              </button>
            </div>
          )}
        </div>

        <div className="projects-scroll">
          {projects.length === 0 ? (
            <div className="projects-empty">
              No projects yet.{' '}
              {isAdmin ? 'Create one to group tickets.' : 'Ask an admin to create one.'}
            </div>
          ) : (
            <div className="project-grid">
              {projects.map((p) => (
                <article key={p.id} className="project-card">
                  <header className="project-card-head">
                    <span
                      className="project-dot project-dot-lg"
                      style={{ background: p.color }}
                      aria-hidden="true"
                    />
                    <div className="project-card-title">
                      <h2>{p.name}</h2>
                      <span className="project-key">{p.key}</span>
                    </div>
                  </header>

                  {p.description && <p className="project-card-desc">{p.description}</p>}

                  <div className="project-stats">
                    <div className="project-stat">
                      <span className="project-stat-value">{p.open_count}</span>
                      <span className="project-stat-label">Open</span>
                    </div>
                    <div className="project-stat">
                      <span className="project-stat-value">{p.ticket_count}</span>
                      <span className="project-stat-label">Total</span>
                    </div>
                  </div>

                  <footer className="project-card-foot">
                    <button
                      className="btn-ghost"
                      onClick={() => router.push(`/?project=${p.id}`)}
                    >
                      View board
                    </button>
                    {isAdmin && (
                      <div className="project-card-actions">
                        <button
                          className="btn-ghost"
                          onClick={() => setEditing(p)}
                        >
                          Edit
                        </button>
                        <button
                          className="btn-ghost btn-danger"
                          onClick={() => setDeleting(p)}
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </footer>
                </article>
              ))}
            </div>
          )}
        </div>
      </div>

      {editing && (
        <ProjectModal
          project={editing.isNew ? null : editing}
          onClose={() => setEditing(null)}
          onSave={handleSave}
        />
      )}

      {deleting && (
        <ConfirmModal
          title="Delete project"
          message={
            deleting.ticket_count > 0
              ? `${deleting.name} has ${deleting.ticket_count} ${
                  deleting.ticket_count === 1 ? 'ticket' : 'tickets'
                }. They will be kept but become unassigned from any project.`
              : `${deleting.name} has no tickets. This cannot be undone.`
          }
          confirmLabel="Delete project"
          onCancel={() => setDeleting(null)}
          onConfirm={handleDelete}
        />
      )}
    </AppShell>
  );
}

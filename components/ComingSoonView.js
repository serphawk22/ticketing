'use client';

import { useRouter } from 'next/navigation';
import AppShell from './AppShell';
import PageHeader from './PageHeader';
import ProjectTabs from './ProjectTabs';
import EmptyState from './EmptyState';

const ART = {
  timeline: (
    <>
      <rect x="8" y="16" width="26" height="3" rx="1.5" fill="#DFE1E6" />
      <rect x="30" y="9" width="22" height="3" rx="1.5" fill="#EBECF0" />
      <rect x="30" y="23" width="18" height="3" rx="1.5" fill="#EBECF0" />
      <rect x="30" y="16" width="26" height="3" rx="1.5" fill="#F4F5F7" />
      <circle cx="46" cy="32" r="11" fill="#E9F2FF" />
      <path d="M46 27.5v9M42.5 32h7" stroke="#0C66E4" strokeWidth="2.5" strokeLinecap="round" />
    </>
  ),
  reports: (
    <>
      <rect x="12" y="26" width="7" height="12" rx="2" fill="#DFE1E6" />
      <rect x="24" y="18" width="7" height="20" rx="2" fill="#EBECF0" />
      <rect x="36" y="10" width="7" height="28" rx="2" fill="#F4F5F7" />
      <circle cx="46" cy="32" r="11" fill="#E9F2FF" />
      <path d="M46 27.5v9M42.5 32h7" stroke="#0C66E4" strokeWidth="2.5" strokeLinecap="round" />
    </>
  ),
  docs: (
    <>
      <rect x="16" y="6" width="24" height="30" rx="4" fill="#F4F5F7" />
      <rect x="21" y="14" width="14" height="3" rx="1.5" fill="#DFE1E6" />
      <rect x="21" y="21" width="11" height="3" rx="1.5" fill="#EBECF0" />
      <circle cx="46" cy="32" r="11" fill="#E9F2FF" />
      <path d="M46 27.5v9M42.5 32h7" stroke="#0C66E4" strokeWidth="2.5" strokeLinecap="round" />
    </>
  ),
  attachments: (
    <>
      <path
        d="M24 8v14a5 5 0 0010 0V10a3 3 0 00-6 0v11"
        stroke="#DFE1E6"
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M20 26l-2 6 6-2"
        stroke="#DFE1E6"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <circle cx="46" cy="32" r="11" fill="#E9F2FF" />
      <path d="M46 27.5v9M42.5 32h7" stroke="#0C66E4" strokeWidth="2.5" strokeLinecap="round" />
    </>
  ),
};

/**
 * Placeholder for the project views that are still to be built. It exists so
 * the tab strip can stay uniform: every tab is a working link that looks the
 * same, and the unbuilt ones simply say so instead of pretending to be
 * disabled.
 */
export default function ComingSoonView({ tab, label, project, projects, projectCounts, currentUser }) {
  const router = useRouter();

  return (
    <AppShell
      currentUser={currentUser}
      projects={projects}
      projectCounts={projectCounts}
      projectId={project.id}
      onProjectChange={(id) => router.push(`/projects/${id}/summary`)}
    >
      <div className="board">
        <PageHeader
          breadcrumb={[
            { label: 'Projects', href: '/projects' },
            { label: project.name },
            { label },
          ]}
          title={label}
          project={project}
          subtitle={`${label} is not built yet. This tab is wired up so the navigation stays consistent while it is on its way.`}
        />

        <ProjectTabs projectId={project.id} active={tab} />

        <EmptyState
          icon={
            <svg viewBox="0 0 64 48" width="64" height="48" aria-hidden="true">
              {ART[tab]}
            </svg>
          }
          title={`${label} is coming soon`}
          text="Nothing to show here yet. Use Summary, Board, List or Calendar in the meantime."
        />
      </div>
    </AppShell>
  );
}
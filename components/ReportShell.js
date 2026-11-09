'use client';

import { useRouter } from 'next/navigation';
import AppShell from './AppShell';
import PageHeader from './PageHeader';
import ProjectTabs from './ProjectTabs';

export default function ReportShell({
  project,
  projects,
  projectCounts,
  myIssuesCount,
  currentUser,
  title,
  subtitle,
  breadcrumb,
  projectPath = (id) => `/projects/${id}/reports`,
  clientRequests = false,
  children,
}) {
  const router = useRouter();

  return (
    <AppShell
      currentUser={currentUser}
      projects={projects}
      projectCounts={projectCounts}
      myIssuesCount={myIssuesCount}
      view={clientRequests ? 'client-requests' : undefined}
      projectId={String(project.id)}
      onProjectChange={(id) =>
        router.push(clientRequests ? '/client-requests/reports' : projectPath(id))
      }
    >
      <div className="board">
        <PageHeader breadcrumb={breadcrumb} title={title} project={project} subtitle={subtitle} />
        <ProjectTabs projectId={project.id} active="reports" clientRequests={clientRequests} />
        {children}
      </div>
    </AppShell>
  );
}

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
  children,
}) {
  const router = useRouter();

  return (
    <AppShell
      currentUser={currentUser}
      projects={projects}
      projectCounts={projectCounts}
      myIssuesCount={myIssuesCount}
      projectId={project.id}
      onProjectChange={(id) => router.push(projectPath(id))}
    >
      <div className="board">
        <PageHeader breadcrumb={breadcrumb} title={title} project={project} subtitle={subtitle} />
        <ProjectTabs projectId={project.id} active="reports" />
        {children}
      </div>
    </AppShell>
  );
}

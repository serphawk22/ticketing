import requireTeamUser from '@/lib/requireTeamUser';
import { notFound, redirect } from 'next/navigation';
import { getAllProjects, getProject } from '@/lib/projects';
import { getAllTickets } from '@/lib/tickets';
import ComingSoonView from '@/components/ComingSoonView';

// Only the tabs with no page yet are served here; the built views have their
// own static routes, which take precedence over this one.
const PLACEHOLDER_TABS = {
  timeline: 'Timeline',
  docs: 'Docs',
};

export const dynamic = 'force-dynamic';

export default async function ProjectPlaceholderPage({ params }) {
  const session = await requireTeamUser();

  const { projectId, tab } = await params;
  if (!Object.hasOwn(PLACEHOLDER_TABS, tab)) notFound();

  const project = await getProject(projectId);
  if (!project) notFound();

  const [projects, allTickets] = await Promise.all([getAllProjects(), getAllTickets()]);

  const projectCounts = {};
  for (const t of allTickets) {
    if (t.project_id == null) continue;
    projectCounts[t.project_id] = (projectCounts[t.project_id] || 0) + 1;
  }

  return (
    <ComingSoonView
      tab={tab}
      label={PLACEHOLDER_TABS[tab]}
      project={project}
      projects={projects}
      projectCounts={projectCounts}
      currentUser={session.user}
    />
  );
}
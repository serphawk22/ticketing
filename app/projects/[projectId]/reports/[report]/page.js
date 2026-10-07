import requireTeamUser from '@/lib/requireTeamUser';
import { notFound } from 'next/navigation';
import { getAllProjects, getProject } from '@/lib/projects';
import { getAllTickets } from '@/lib/tickets';
import { getEmployees } from '@/lib/employees';
import { getReport, parseReportOptions } from '@/lib/reportCatalog';
import { buildReport } from '@/lib/reportMath';
import { getReportSource } from '@/lib/reports';
import ReportView from '@/components/ReportView';

export const dynamic = 'force-dynamic';

export default async function ProjectReportPage({ params, searchParams }) {
  const session = await requireTeamUser();
  const { projectId, report: slug } = await params;
  const report = getReport(slug);
  if (!report) notFound();

  const project = await getProject(projectId);
  if (!project) notFound();

  const query = await searchParams;
  const options = parseReportOptions(report.slug, query);

  const [projects, tickets, employees, source] = await Promise.all([
    getAllProjects(),
    getAllTickets(),
    getEmployees(),
    getReportSource(project.id),
  ]);

  const userId = session.user.id;
  const myIssuesCount = tickets.filter(
    (ticket) => ticket.created_by === userId || ticket.assigned_to === userId
  ).length;

  const projectCounts = {};
  for (const ticket of tickets) {
    if (ticket.project_id == null) continue;
    projectCounts[ticket.project_id] = (projectCounts[ticket.project_id] || 0) + 1;
  }

  const result = buildReport(report.slug, source, options);

  return (
    <ReportView
      project={project}
      projects={projects}
      projectCounts={projectCounts}
      myIssuesCount={myIssuesCount}
      currentUser={session.user}
      employees={employees}
      report={report}
      options={options}
      result={result}
      tickets={source.tickets}
    />
  );
}

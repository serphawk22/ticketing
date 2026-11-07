import requireAdminUser from '@/lib/requireAdminUser';
import { notFound } from 'next/navigation';
import { getAllProjects } from '@/lib/projects';
import { getAllTickets } from '@/lib/tickets';
import { getEmployees } from '@/lib/employees';
import { getReport, parseReportOptions } from '@/lib/reportCatalog';
import { buildReport } from '@/lib/reportMath';
import { getClientRequestReportSource } from '@/lib/reports';
import { getClientBoxUsageData } from '@/lib/clientUsageReport';
import { CLIENT_REQUESTS_PROJECT } from '@/lib/clientRequestsProject';
import ReportView from '@/components/ReportView';

export const dynamic = 'force-dynamic';

export default async function ClientRequestsReportPage({ params, searchParams }) {
  const session = await requireAdminUser();
  const { report: slug } = await params;
  const report = getReport(slug);
  if (!report) notFound();

  const query = await searchParams;
  const options = parseReportOptions(report.slug, query);

  const [projects, allTickets, employees, source] = await Promise.all([
    getAllProjects(),
    getAllTickets(),
    getEmployees(),
    getClientRequestReportSource(),
  ]);

  const userId = session.user.id;
  const myIssuesCount = allTickets.filter(
    (ticket) => ticket.created_by === userId || ticket.assigned_to === userId
  ).length;

  const projectCounts = {};
  for (const ticket of allTickets) {
    if (ticket.project_id == null) continue;
    projectCounts[ticket.project_id] = (projectCounts[ticket.project_id] || 0) + 1;
  }

  if (slug === 'client-box-usage') {
    const clientBoxData = await getClientBoxUsageData({
      days: options.days,
      clientUserId: session.user.role === 'client' ? session.user.id : null,
    });
    source.clientBoxes = clientBoxData.clientBoxes;
    source.clientBoxSummary = clientBoxData.summary;
  }

  const result = buildReport(report.slug, source, options);

  return (
    <ReportView
      project={CLIENT_REQUESTS_PROJECT}
      projects={projects}
      projectCounts={projectCounts}
      myIssuesCount={myIssuesCount}
      currentUser={session.user}
      employees={employees}
      report={report}
      options={options}
      result={result}
      tickets={report.slug === 'client-box-usage' ? allTickets : source.tickets}
      clientRequests
    />
  );
}

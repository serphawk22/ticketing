import requireTeamUser from '@/lib/requireTeamUser';
import { notFound, redirect } from 'next/navigation';
import { getAllProjects } from '@/lib/projects';
import { getEmployees } from '@/lib/employees';
import { getSectionBySlug, getReportBySlug } from '@/lib/reportMasterCatalog';
import { getReportExecutionData } from '@/lib/analytics';
import ReportDetailClient from '@/components/reports/ReportDetailClient';

export const dynamic = 'force-dynamic';

export default async function ReportDetailPage({ params, searchParams }) {
  const session = await requireTeamUser();
  const { section: sectionSlug, report: reportSlug } = await params;

  const section = getSectionBySlug(sectionSlug);
  const reportDef = getReportBySlug(reportSlug);
  if (!section || !reportDef || reportDef.sectionSlug !== sectionSlug) {
    notFound();
  }

  // Permission Check
  if (
    session.user.role !== 'admin' &&
    (sectionSlug === 'salary-payroll-and-cost' || sectionSlug === 'finance-and-startup-expense')
  ) {
    redirect('/reports');
  }

  const query = await searchParams;
  const filters = {
    preset: query?.preset || 'this_month',
    startDate: query?.startDate || '',
    endDate: query?.endDate || '',
    projectId: query?.projectId || 'all',
    employeeId: query?.employeeId || 'all',
    department: query?.department || 'all',
    status: query?.status || 'all',
    priority: query?.priority || 'all',
    search: query?.search || '',
  };

  const [initialData, projects, employees] = await Promise.all([
    getReportExecutionData({
      reportSlug,
      filters,
      currentUser: session.user,
    }),
    getAllProjects(),
    getEmployees(),
  ]);

  return (
    <ReportDetailClient
      section={section}
      reportDef={reportDef}
      initialData={initialData}
      projects={projects}
      employees={employees}
      currentUser={session.user}
    />
  );
}


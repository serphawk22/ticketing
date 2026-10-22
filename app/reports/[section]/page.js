import requireTeamUser from '@/lib/requireTeamUser';
import { notFound, redirect } from 'next/navigation';
import { getAllProjects } from '@/lib/projects';
import { getEmployees } from '@/lib/employees';
import { getSectionBySlug, getReportsBySection } from '@/lib/reportMasterCatalog';
import SectionReportsClient from '@/components/reports/SectionReportsClient';

export const dynamic = 'force-dynamic';

export default async function SectionReportsPage({ params }) {
  const session = await requireTeamUser();
  const { section: sectionSlug } = await params;

  const section = getSectionBySlug(sectionSlug);
  if (!section) notFound();

  // Permission Check
  if (
    session.user.role !== 'admin' &&
    (sectionSlug === 'salary-payroll-and-cost' || sectionSlug === 'finance-and-startup-expense')
  ) {
    redirect('/reports');
  }

  const reports = getReportsBySection(sectionSlug);
  const [projects, employees] = await Promise.all([
    getAllProjects(),
    getEmployees(),
  ]);

  return (
    <SectionReportsClient
      section={section}
      reports={reports}
      projects={projects}
      employees={employees}
      currentUser={session.user}
    />
  );
}


import requireTeamUser from '@/lib/requireTeamUser';
import { getAllProjects } from '@/lib/projects';
import { getEmployees } from '@/lib/employees';
import { REPORT_SECTIONS, MASTER_REPORTS } from '@/lib/reportMasterCatalog';
import ReportsHubClient from '@/components/reports/ReportsHubClient';

export const dynamic = 'force-dynamic';

export default async function ReportsHubPage() {
  const session = await requireTeamUser();

  const [projects, employees] = await Promise.all([
    getAllProjects(),
    getEmployees(),
  ]);

  return (
    <ReportsHubClient
      sections={REPORT_SECTIONS}
      reports={MASTER_REPORTS}
      projects={projects}
      employees={employees}
      currentUser={session.user}
    />
  );
}


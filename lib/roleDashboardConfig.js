/**
 * Role-Based Dashboard Configuration & Access Profiles
 *
 * Central permission definitions for preview profiles within the Admin Dashboard:
 * - Admin: Full governance, all 7 sections, all KPIs, charts, exceptions, and exports.
 * - Manager: Delivery progress, team velocity, task assignments, overdue items, blockers.
 *            Restricted from salary, payroll, and sensitive finances.
 * - HR: Workforce directory, attendance, leaves, timesheets, department staffing, capacity.
 *       Restricted from company financial accounts, profit/loss, and ticket debugging.
 * - Finance: Salary summaries, payroll register, employee costs, project budgets, and expenses.
 *            Restricted from detailed developer tasks and private employee personal logs.
 *
 * NOTE: These are preview profiles within the Admin Dashboard to preview and configure role-based
 * access. They can directly power real backend authorization once separate roles are enabled.
 */

export const DASHBOARD_PROFILES = [
  {
    id: 'admin',
    name: 'Admin',
    badge: 'Executive Governance',
    tagline: 'Company-wide executive overview with unrestricted access to all 7 reporting modules',
    description:
      'Complete administrative visibility across all business domains including company-wide finances, payroll liabilities, operational exceptions, delivery metrics, and governance audit trails.',
    allowedSectionSlugs: [
      'employee-and-workforce',
      'ticket-and-task',
      'project-and-client-delivery',
      'salary-payroll-and-cost',
      'productivity-and-performance',
      'finance-and-startup-expense',
      'management-risk-and-compliance',
    ],
    kpiKeys: [
      'totalTickets',
      'completionRate',
      'overdueCount',
      'loggedHours',
      'totalMonthlyPayroll',
      'activeProjectsCount',
    ],
    widgets: [
      'status_chart',
      'priority_chart',
      'project_progress',
      'overdue_exceptions',
      'approvals_exceptions',
      'blockers_exceptions',
      'modules_directory',
    ],
    hideFinancials: false,
    hideTickets: false,
    permissionsSummary: 'Full administrative access across all 76 reports and financial records.',
  },
  {
    id: 'manager',
    name: 'Manager',
    badge: 'Delivery & Team Operations',
    tagline: 'Team performance, project milestones, task delivery, workload, and operational blockers',
    description:
      'Operational management preview focused on ticket throughput, delivery progress, overdue tasks, task sheet blockers, and team workload distribution. Company-wide salary, payroll registers, and bank details are strictly hidden.',
    allowedSectionSlugs: [
      'ticket-and-task',
      'project-and-client-delivery',
      'productivity-and-performance',
      'management-risk-and-compliance',
    ],
    kpiKeys: [
      'totalTickets',
      'completionRate',
      'overdueCount',
      'loggedHours',
      'blockersCount',
      'activeProjectsCount',
    ],
    widgets: [
      'status_chart',
      'priority_chart',
      'project_progress',
      'overdue_exceptions',
      'blockers_exceptions',
      'modules_directory',
    ],
    hideFinancials: true,
    hideTickets: false,
    permissionsSummary: 'Operational view: Delivery, tasks, and productivity visible. Salary, payroll, and business expenses hidden.',
  },
  {
    id: 'hr',
    name: 'HR',
    badge: 'People & Workforce',
    tagline: 'Workforce staffing, department allocation, attendance, timesheets, and capacity',
    description:
      'Human Resources preview focused on the employee directory, workforce capacity, department staffing, timesheet logging compliance, and employee onboarding. Financial accounts, revenue reports, and technical ticket debugging are hidden.',
    allowedSectionSlugs: [
      'employee-and-workforce',
      'productivity-and-performance',
    ],
    kpiKeys: [
      'activeEmployeesCount',
      'departmentsCount',
      'loggedHours',
      'distinctLoggers',
      'taskSheetHours',
      'unassignedCount',
    ],
    widgets: [
      'department_workforce_chart',
      'project_progress',
      'blockers_exceptions',
      'modules_directory',
    ],
    hideFinancials: true,
    hideTickets: true,
    permissionsSummary: 'People & HR view: Directory, capacity, and attendance visible. Detailed company finance and ticket engineering queues hidden.',
  },
  {
    id: 'finance',
    name: 'Finance',
    badge: 'Payroll & Expenses',
    tagline: 'Compensation liabilities, payroll register, project budgets, and departmental costs',
    description:
      'Finance & Accounting preview focused on monthly payroll liabilities, department compensation allocation, payment disbursement status, project budget consumption, and expense summaries. Developer-specific ticket logs are hidden.',
    allowedSectionSlugs: [
      'salary-payroll-and-cost',
      'finance-and-startup-expense',
      'project-and-client-delivery',
    ],
    kpiKeys: [
      'totalMonthlyPayroll',
      'activeEmployeesCount',
      'activeProjectsCount',
      'totalProjectBudgets',
      'paidEmployeesCount',
      'pendingPayrollCount',
    ],
    widgets: [
      'department_salary_chart',
      'payment_status_chart',
      'project_progress',
      'modules_directory',
    ],
    hideFinancials: false,
    hideTickets: true,
    permissionsSummary: 'Finance view: Salary, payroll, expenses, and project budgets visible. Technical development queues and personal employee details hidden.',
  },
];

/**
 * Get profile configuration by ID ('admin', 'manager', 'hr', 'finance')
 */
export function getProfileConfig(profileId = 'admin') {
  const norm = String(profileId || 'admin').toLowerCase().trim();
  return DASHBOARD_PROFILES.find((p) => p.id === norm) || DASHBOARD_PROFILES[0];
}

/**
 * Filter sections based on profile permissions
 */
export function filterSectionsForProfile(sections = [], profileId = 'admin') {
  const config = getProfileConfig(profileId);
  const allowedSet = new Set(config.allowedSectionSlugs);
  return sections.filter((s) => allowedSet.has(s.slug));
}

/**
 * Check if a specific report is permitted for a profile
 */
export function isReportPermittedForProfile(reportSlug, sectionSlug, profileId = 'admin') {
  const config = getProfileConfig(profileId);
  return config.allowedSectionSlugs.includes(sectionSlug);
}


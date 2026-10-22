'use client';

import { useState, useMemo, useRef } from 'react';
import Link from 'next/link';
import AppShell from './AppShell';
import KpiCard from './reports/KpiCard';
import { DonutChart, BarChart } from './reports/ReportCharts';
import ReportFilterBar from './reports/ReportFilterBar';
import { REPORT_SECTIONS } from '@/lib/reportMasterCatalog';
import {
  DASHBOARD_PROFILES,
  getProfileConfig,
  filterSectionsForProfile,
} from '@/lib/roleDashboardConfig';

export default function AdminDashboard({
  initialSummary,
  projects,
  employees,
  currentUser,
}) {
  const [summary, setSummary] = useState(initialSummary);
  const [selectedProfile, setSelectedProfile] = useState('admin');
  const [filters, setFilters] = useState({
    preset: initialSummary.dateRange?.preset || 'this_month',
    startDate: initialSummary.dateRange?.startDate || '',
    endDate: initialSummary.dateRange?.endDate || '',
    projectId: initialSummary.selectedProjectId || 'all',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const reqSeqRef = useRef(0);

  const activeProfile = useMemo(() => {
    return getProfileConfig(selectedProfile);
  }, [selectedProfile]);

  const visibleSections = useMemo(() => {
    return filterSectionsForProfile(REPORT_SECTIONS, selectedProfile);
  }, [selectedProfile]);

  async function handleFilterChange(nextFilters) {
    const seq = ++reqSeqRef.current;
    setFilters(nextFilters);
    setLoading(true);
    setError('');

    try {
      const query = new URLSearchParams({
        preset: nextFilters.preset || 'this_month',
        startDate: nextFilters.startDate || '',
        endDate: nextFilters.endDate || '',
        projectId: nextFilters.projectId || 'all',
      });

      const res = await fetch(`/api/reports/dashboard-summary?${query.toString()}`);
      if (!res.ok) throw new Error('Failed to refresh dashboard metrics');
      const data = await res.json();
      if (seq === reqSeqRef.current) {
        setSummary(data);
      }
    } catch (err) {
      if (seq === reqSeqRef.current) {
        setError(err.message);
      }
    } finally {
      if (seq === reqSeqRef.current) {
        setLoading(false);
      }
    }
  }

  const kpis = summary.kpis || {};
  const charts = summary.charts || {};
  const exceptions = summary.exceptions || {};

  return (
    <AppShell
      currentUser={currentUser}
      projects={projects}
      projectCounts={{}}
      view="admin-dashboard"
    >
      <div className="rpt-dashboard-page">
        {/* Top Header with Role-Based Dashboard Access Selector */}
        <div className="rpt-page-header">
          <div>
            <div className="rpt-page-subtitle">Serp Hawk Analytics & Governance</div>
            <h1 className="rpt-page-title">Executive Admin Dashboard</h1>
          </div>
          <div className="rpt-header-actions" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {/* Role-Based Dashboard Access Selector */}
            <div className="rpt-role-selector-group" title="Preview dashboard & reports configuration as different roles">
              <label htmlFor="dashboard-role-selector" className="rpt-role-selector-label">
                Preview Dashboard As:
              </label>
              <select
                id="dashboard-role-selector"
                className="rpt-role-selector-select"
                value={selectedProfile}
                onChange={(e) => setSelectedProfile(e.target.value)}
              >
                {DASHBOARD_PROFILES.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            <Link href="/reports" className="btn-secondary">
              Explore All 76 Reports →
            </Link>
          </div>
        </div>

        {/* Role Preview Banner (shown when previewing as Manager, HR, or Finance) */}
        {selectedProfile !== 'admin' && (
          <div className="rpt-preview-banner">
            <div className="rpt-preview-info">
              <span className="rpt-preview-pill">Previewing as {activeProfile.name}</span>
              <div>
                <div className="rpt-preview-tagline">{activeProfile.tagline}</div>
                <div className="rpt-preview-desc">
                  {activeProfile.permissionsSummary} (
                  <strong>Note:</strong> You remain logged in as an authorized Administrator. This preview only simulates the viewable dashboard configuration for this role).
                </div>
              </div>
            </div>
            <button
              type="button"
              className="rpt-preview-reset-btn"
              onClick={() => setSelectedProfile('admin')}
              title="Return to full Executive Admin view"
            >
              ← Return to Admin View
            </button>
          </div>
        )}

        {/* Global Filter Bar */}
        <ReportFilterBar
          filters={filters}
          onChange={handleFilterChange}
          projects={projects}
          supportedFilters={['date_range', 'project']}
        />

        {error && <div className="rpt-alert rpt-alert-error">{error}</div>}
        {loading && <div className="rpt-loading-indicator">Refreshing company metrics...</div>}

        {/* Section Navigation Quick Bar (scoped to active profile) */}
        <div className="rpt-section-quicknav">
          <div className="rpt-quicknav-title">
            {selectedProfile === 'admin'
              ? 'Report Categories (All 7):'
              : `${activeProfile.name} Visible Categories (${visibleSections.length}):`}
          </div>
          <div className="rpt-quicknav-pills">
            {visibleSections.map((sec) => (
              <Link
                key={sec.slug}
                href={`/reports/${sec.slug}`}
                className="rpt-quicknav-pill"
                style={{ borderLeftColor: sec.color }}
              >
                <span className="rpt-quicknav-badge">Sec {sec.id}</span>
                <span className="rpt-quicknav-name">{sec.shortTitle}</span>
              </Link>
            ))}
          </div>
        </div>

        {/* ========================================================= */}
        {/* Profile-Tailored KPI Grid                                  */}
        {/* ========================================================= */}
        <div className="rpt-kpi-grid">
          {/* ADMIN VIEW KPIS */}
          {selectedProfile === 'admin' && (
            <>
              <KpiCard
                title="Total Tickets"
                value={kpis.totalTickets ?? 0}
                subtitle={`${kpis.openTickets ?? 0} Open, ${kpis.inProgressTickets ?? 0} In Progress`}
              />
              <KpiCard
                title="Delivery Completion Rate"
                value={`${kpis.completionRate ?? 0}%`}
                subtitle={`${kpis.resolvedTickets ?? 0} of ${kpis.totalTickets ?? 0} completed`}
                tone={kpis.completionRate > 70 ? 'pos' : 'warn'}
              />
              <KpiCard
                title="Overdue Tasks"
                value={kpis.overdueCount ?? 0}
                subtitle={`${kpis.urgentCount ?? 0} urgent priority`}
                tone={kpis.overdueCount > 0 ? 'neg' : 'good'}
              />
              <KpiCard
                title="Logged Work Hours"
                value={`${kpis.loggedHours ?? 0}h`}
                subtitle={`${kpis.distinctLoggers ?? 0} active team members`}
              />
              <KpiCard
                title="Monthly Payroll Obligation"
                value={`$${(kpis.totalMonthlyPayroll ?? 0).toLocaleString()}`}
                subtitle={`${kpis.activeEmployeesCount ?? 0} active employees`}
              />
              <KpiCard
                title="Active Projects"
                value={kpis.activeProjectsCount ?? 0}
                subtitle={`${kpis.pendingApprovalsCount ?? 0} pending product reviews`}
              />
            </>
          )}

          {/* MANAGER VIEW KPIS (Zero salary/payroll shown!) */}
          {selectedProfile === 'manager' && (
            <>
              <KpiCard
                title="Total Tickets"
                value={kpis.totalTickets ?? 0}
                subtitle={`${kpis.openTickets ?? 0} Open, ${kpis.inProgressTickets ?? 0} In Progress`}
              />
              <KpiCard
                title="Delivery Completion Rate"
                value={`${kpis.completionRate ?? 0}%`}
                subtitle={`${kpis.resolvedTickets ?? 0} of ${kpis.totalTickets ?? 0} completed`}
                tone={kpis.completionRate > 70 ? 'pos' : 'warn'}
              />
              <KpiCard
                title="Overdue Tasks"
                value={kpis.overdueCount ?? 0}
                subtitle={`${kpis.urgentCount ?? 0} urgent priority`}
                tone={kpis.overdueCount > 0 ? 'neg' : 'good'}
              />
              <KpiCard
                title="Logged Work Hours"
                value={`${kpis.loggedHours ?? 0}h`}
                subtitle={`${kpis.distinctLoggers ?? 0} active loggers`}
              />
              <KpiCard
                title="Active Task Sheet Blockers"
                value={kpis.blockersCount ?? 0}
                subtitle="Items requiring manager unblocking"
                tone={kpis.blockersCount > 0 ? 'warn' : 'good'}
              />
              <KpiCard
                title="Active Projects"
                value={kpis.activeProjectsCount ?? 0}
                subtitle="Monitored delivery streams"
              />
            </>
          )}

          {/* HR VIEW KPIS (Workforce, capacity, attendance, zero financials) */}
          {selectedProfile === 'hr' && (
            <>
              <KpiCard
                title="Active Workforce Staff"
                value={kpis.activeEmployeesCount ?? 0}
                subtitle="Total registered active employees"
                tone="good"
              />
              <KpiCard
                title="Departments Represented"
                value={kpis.departmentsCount ?? 0}
                subtitle="Active organizational units"
              />
              <KpiCard
                title="Total Logged Work Time"
                value={`${kpis.loggedHours ?? 0}h`}
                subtitle="Recorded in ticketing system"
              />
              <KpiCard
                title="Active Team Loggers"
                value={kpis.distinctLoggers ?? 0}
                subtitle="Employees logging time this period"
              />
              <KpiCard
                title="Task Sheet Recorded Hours"
                value={`${kpis.taskSheetHours ?? 0}h`}
                subtitle="Daily standup logs submitted"
              />
              <KpiCard
                title="Unassigned Work Items"
                value={kpis.unassignedCount ?? 0}
                subtitle="Awaiting capacity allocation"
                tone={kpis.unassignedCount > 0 ? 'warn' : 'good'}
              />
            </>
          )}

          {/* FINANCE VIEW KPIS (Payroll, budgets, liability, zero ticket triage) */}
          {selectedProfile === 'finance' && (
            <>
              <KpiCard
                title="Monthly Payroll Liability"
                value={`$${(kpis.totalMonthlyPayroll ?? 0).toLocaleString()}`}
                subtitle={`${kpis.activeEmployeesCount ?? 0} active employees`}
                tone="pos"
              />
              <KpiCard
                title="Active Staff on Payroll"
                value={kpis.activeEmployeesCount ?? 0}
                subtitle="Salaried employee base"
              />
              <KpiCard
                title="Monitored Delivery Projects"
                value={kpis.activeProjectsCount ?? 0}
                subtitle="Active revenue & cost centers"
              />
              <KpiCard
                title="Total Project Budgets"
                value={`$${(kpis.totalProjectBudgets ?? 0).toLocaleString()}`}
                subtitle="Aggregate allocated project budgets"
              />
              <KpiCard
                title="Disbursed / Paid Staff"
                value={kpis.paidEmployeesCount ?? 0}
                subtitle="Payroll marked as disbursed"
                tone="good"
              />
              <KpiCard
                title="Pending Payroll Disbursements"
                value={kpis.pendingPayrollCount ?? 0}
                subtitle="Awaiting disbursement processing"
                tone={kpis.pendingPayrollCount > 0 ? 'warn' : 'good'}
              />
            </>
          )}
        </div>

        {/* ========================================================= */}
        {/* Main Content Grid: Profile-Tailored Charts & Summaries    */}
        {/* ========================================================= */}
        <div className="rpt-dashboard-grid">
          {/* ADMIN & MANAGER: Status Distribution */}
          {(selectedProfile === 'admin' || selectedProfile === 'manager') && (
            <div className="rpt-card">
              <div className="rpt-card-head">
                <h3 className="rpt-card-title">Ticket Status Distribution</h3>
                <Link href="/reports/ticket-and-task/task-summary" className="rpt-card-link">
                  View Task Summary →
                </Link>
              </div>
              <div className="rpt-card-body">
                <DonutChart data={charts.statusCounts || []} size={180} />
              </div>
            </div>
          )}

          {/* ADMIN & MANAGER: Workload by Priority */}
          {(selectedProfile === 'admin' || selectedProfile === 'manager') && (
            <div className="rpt-card">
              <div className="rpt-card-head">
                <h3 className="rpt-card-title">Workload by Priority</h3>
                <Link href="/reports/ticket-and-task/task-assignment" className="rpt-card-link">
                  View Assignments →
                </Link>
              </div>
              <div className="rpt-card-body">
                <BarChart data={charts.priorityCounts || []} height={200} />
              </div>
            </div>
          )}

          {/* HR VIEW: Department Staffing Distribution */}
          {selectedProfile === 'hr' && (
            <div className="rpt-card">
              <div className="rpt-card-head">
                <h3 className="rpt-card-title">Workforce Staffing by Department</h3>
                <Link href="/reports/employee-and-workforce/employee-directory" className="rpt-card-link">
                  Employee Directory →
                </Link>
              </div>
              <div className="rpt-card-body">
                <DonutChart data={charts.deptEmployeeCounts || []} size={180} />
              </div>
            </div>
          )}

          {/* FINANCE VIEW: Department Salary Allocation */}
          {selectedProfile === 'finance' && (
            <div className="rpt-card">
              <div className="rpt-card-head">
                <h3 className="rpt-card-title">Monthly Salary Allocation by Department ($)</h3>
                <Link href="/reports/salary-payroll-and-cost/department-salary-report" className="rpt-card-link">
                  Department Salary Report →
                </Link>
              </div>
              <div className="rpt-card-body">
                <BarChart data={charts.deptSalaryCounts || []} height={200} />
              </div>
            </div>
          )}

          {/* FINANCE VIEW: Payment Status Disbursement */}
          {selectedProfile === 'finance' && (
            <div className="rpt-card">
              <div className="rpt-card-head">
                <h3 className="rpt-card-title">Disbursement & Payment Status</h3>
                <Link href="/reports/salary-payroll-and-cost/payroll-payment-status" className="rpt-card-link">
                  Payment Status Report →
                </Link>
              </div>
              <div className="rpt-card-body">
                <DonutChart data={charts.paymentStatusCounts || []} size={180} />
              </div>
            </div>
          )}

          {/* ALL PROFILES: Project Delivery Progress (Scoped/Styled appropriately) */}
          <div className="rpt-card rpt-card-wide">
            <div className="rpt-card-head">
              <h3 className="rpt-card-title">
                {selectedProfile === 'finance' ? 'Project Budget & Milestone Progress' : 'Project Delivery Progress'}
              </h3>
              <Link href="/reports/project-and-client-delivery/project-overview" className="rpt-card-link">
                All Projects Report →
              </Link>
            </div>
            <div className="rpt-card-body">
              <div className="rpt-project-progress-list">
                {(charts.projectStats || []).map((p) => (
                  <div key={p.id} className="rpt-project-progress-row">
                    <div className="rpt-proj-info">
                      <Link href={`/projects/${p.id}/summary`} className="rpt-proj-name">
                        {p.name} ({p.key})
                      </Link>
                      <span className="rpt-proj-meta">
                        {p.doneTickets} / {p.totalTickets} tickets completed
                        {selectedProfile === 'finance' && (
                          <span style={{ fontWeight: 600, color: '#006644', marginLeft: 6 }}>
                            · Budget: ${(p.budget || 0).toLocaleString()}
                          </span>
                        )}
                        {selectedProfile !== 'finance' && p.overdueTickets > 0 && (
                          <span className="rpt-proj-overdue"> · {p.overdueTickets} overdue</span>
                        )}
                      </span>
                    </div>
                    <div className="rpt-proj-bar-wrap">
                      <div className="rpt-proj-bar">
                        <div
                          className="rpt-proj-fill"
                          style={{
                            width: `${p.progressPct}%`,
                            backgroundColor: p.color || '#0c66e4',
                          }}
                        />
                      </div>
                      <span className="rpt-proj-pct">{p.progressPct}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ========================================================= */}
        {/* Operational Exceptions & Approvals (Profile-Tailored)     */}
        {/* ========================================================= */}
        {selectedProfile !== 'finance' && (
          <div className="rpt-exceptions-section">
            <h2 className="rpt-section-heading">
              {selectedProfile === 'hr' ? 'Workforce Activity & Standup Exceptions' : 'Operational Exceptions & Approvals'}
            </h2>
            <div className="rpt-exceptions-grid">
              {/* Overdue Items (Admin & Manager) */}
              {(selectedProfile === 'admin' || selectedProfile === 'manager') && (
                <div className="rpt-card">
                  <div className="rpt-card-head">
                    <h3 className="rpt-card-title">🚨 Overdue Work Items</h3>
                    <span className="rpt-badge badge-danger">{exceptions.overdueTickets?.length || 0}</span>
                  </div>
                  <div className="rpt-card-body rpt-compact-list">
                    {!exceptions.overdueTickets?.length ? (
                      <div className="rpt-empty-compact">No overdue tasks in this period.</div>
                    ) : (
                      exceptions.overdueTickets.map((t) => (
                        <div key={t.id} className="rpt-exception-row">
                          <Link href={`/t/${encodeURIComponent(t.key)}`} className="rpt-exception-title">
                            <strong>[{t.key}]</strong> {t.title}
                          </Link>
                          <div className="rpt-exception-sub">
                            <span>Due: {t.dueDate}</span> · <span>Assignee: {t.employeeName}</span> ·{' '}
                            <span className={`priority-${t.priority}`}>{t.priority}</span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* Pending Approvals (Admin only) */}
              {selectedProfile === 'admin' && (
                <div className="rpt-card">
                  <div className="rpt-card-head">
                    <h3 className="rpt-card-title">⏳ Product Inclusion Reviews</h3>
                    <span className="rpt-badge badge-warning">{exceptions.pendingApprovals?.length || 0}</span>
                  </div>
                  <div className="rpt-card-body rpt-compact-list">
                    {!exceptions.pendingApprovals?.length ? (
                      <div className="rpt-empty-compact">No pending inclusion reviews.</div>
                    ) : (
                      exceptions.pendingApprovals.map((t) => (
                        <div key={t.id} className="rpt-exception-row">
                          <Link href={`/t/${encodeURIComponent(t.key)}`} className="rpt-exception-title">
                            <strong>[{t.key}]</strong> {t.title}
                          </Link>
                          <div className="rpt-exception-sub">
                            <span>Project: {t.projectName}</span> · <span>Awaiting Review</span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* Task Sheet Blockers (Admin, Manager, HR) */}
              <div className="rpt-card">
                <div className="rpt-card-head">
                  <h3 className="rpt-card-title">🛑 Task Sheet Blockers</h3>
                  <span className="rpt-badge badge-neutral">{exceptions.blockers?.length || 0}</span>
                </div>
                <div className="rpt-card-body rpt-compact-list">
                  {!exceptions.blockers?.length ? (
                    <div className="rpt-empty-compact">No active blockers flagged today.</div>
                  ) : (
                    exceptions.blockers.map((b) => (
                      <div key={b.id} className="rpt-exception-row">
                        <div className="rpt-exception-title">
                          <strong>{b.name}</strong> ({b.project}): {b.taskTitle}
                        </div>
                        <div className="rpt-blocker-note">Blocker: {b.blocker}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* Reporting Modules Directory (Scoped to Active Profile)    */}
        {/* ========================================================= */}
        <div className="rpt-all-sections-grid">
          <h2 className="rpt-section-heading">
            {selectedProfile === 'admin'
              ? 'All Seven Reporting Modules'
              : `${activeProfile.name} Permitted Reporting Modules (${visibleSections.length} of 7)`}
          </h2>
          <div className="rpt-modules-cards">
            {visibleSections.map((sec) => (
              <div key={sec.slug} className="rpt-module-card">
                <div className="rpt-module-head">
                  <div className="rpt-module-number">Section {sec.id}</div>
                  <h3 className="rpt-module-title">{sec.title}</h3>
                </div>
                <p className="rpt-module-desc">{sec.description}</p>
                <div className="rpt-module-footer">
                  <span className="rpt-module-count">{sec.reportCount} Reports ({sec.reportNumbers})</span>
                  <Link href={`/reports/${sec.slug}`} className="rpt-module-btn">
                    Open Section →
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

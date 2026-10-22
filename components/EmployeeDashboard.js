'use client';

import { useState } from 'react';
import Link from 'next/link';
import AppShell from './AppShell';
import KpiCard from './reports/KpiCard';
import ReportFilterBar from './reports/ReportFilterBar';
import { ticketKey } from '@/lib/ticketMeta';

export default function EmployeeDashboard({
  initialSummary,
  projects,
  currentUser,
}) {
  const [summary, setSummary] = useState(initialSummary);
  const [activeTab, setActiveTab] = useState('tickets'); // 'tickets' | 'logs' | 'sheets' | 'blockers'
  const [filters, setFilters] = useState({
    preset: initialSummary.dateRange?.preset || 'this_month',
    startDate: initialSummary.dateRange?.startDate || '',
    endDate: initialSummary.dateRange?.endDate || '',
    projectId: initialSummary.selectedProjectId || 'all',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleFilterChange(nextFilters) {
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

      const res = await fetch(`/api/reports/employee-summary?${query.toString()}`);
      if (!res.ok) throw new Error('Failed to refresh your dashboard metrics');
      const data = await res.json();
      setSummary(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const kpis = summary.kpis || {};
  const sections = summary.sections || {};

  return (
    <AppShell
      currentUser={currentUser}
      projects={projects}
      projectCounts={{}}
      view="employee-dashboard"
    >
      <div className="rpt-dashboard-page">
        {/* Welcome Header */}
        <div className="rpt-page-header">
          <div>
            <div className="rpt-page-subtitle">Welcome back, {currentUser.name}</div>
            <h1 className="rpt-page-title">Developer Workspace & Personal Dashboard</h1>
          </div>
          <div className="rpt-header-actions">
            <Link href="/task-sheet" className="btn-secondary">
              + File Task Sheet
            </Link>
          </div>
        </div>

        {/* Global Filter Bar */}
        <ReportFilterBar
          filters={filters}
          onChange={handleFilterChange}
          projects={projects}
          supportedFilters={['date_range', 'project']}
        />

        {error && <div className="rpt-alert rpt-alert-error">{error}</div>}
        {loading && <div className="rpt-loading-indicator">Updating your work data...</div>}

        {/* Personal KPIs */}
        <div className="rpt-kpi-grid">
          <KpiCard
            title="My Assigned Tasks"
            value={kpis.assignedTotal ?? 0}
            subtitle={`${kpis.todoCount ?? 0} to do, ${kpis.completedCount ?? 0} completed`}
          />
          <KpiCard
            title="Due Today"
            value={kpis.dueTodayCount ?? 0}
            subtitle={kpis.dueTodayCount > 0 ? 'Requires attention today' : 'No items due today'}
            tone={kpis.dueTodayCount > 0 ? 'warn' : 'pos'}
          />
          <KpiCard
            title="Overdue Tasks"
            value={kpis.overdueCount ?? 0}
            subtitle={kpis.overdueCount > 0 ? 'Past deadline' : 'On track!'}
            tone={kpis.overdueCount > 0 ? 'neg' : 'good'}
          />
          <KpiCard
            title="Logged Work Time"
            value={`${kpis.loggedHours ?? 0}h`}
            subtitle="Ticket time tracking"
          />
          <KpiCard
            title="Task Sheet Hours"
            value={`${kpis.taskSheetHours ?? 0}h`}
            subtitle="Daily submissions"
          />
          <KpiCard
            title="Completion Rate"
            value={`${kpis.completionRate ?? 0}%`}
            subtitle={`${kpis.completedCount ?? 0} of ${kpis.assignedTotal ?? 0} tickets`}
            tone={kpis.completionRate >= 80 ? 'pos' : 'warn'}
          />
        </div>

        {/* Dashboard Navigation Tabs */}
        <div className="rpt-tab-bar">
          <button
            type="button"
            className={`rpt-tab-btn${activeTab === 'tickets' ? ' active' : ''}`}
            onClick={() => setActiveTab('tickets')}
          >
            My Work Items ({kpis.assignedTotal ?? 0})
          </button>
          <button
            type="button"
            className={`rpt-tab-btn${activeTab === 'logs' ? ' active' : ''}`}
            onClick={() => setActiveTab('logs')}
          >
            My Work Logs ({sections.recentTimeLogs?.length || 0})
          </button>
          <button
            type="button"
            className={`rpt-tab-btn${activeTab === 'sheets' ? ' active' : ''}`}
            onClick={() => setActiveTab('sheets')}
          >
            My Task Sheets ({sections.recentTaskSheets?.length || 0})
          </button>
          <button
            type="button"
            className={`rpt-tab-btn${activeTab === 'blockers' ? ' active' : ''}`}
            onClick={() => setActiveTab('blockers')}
          >
            My Blockers ({kpis.blockersCount ?? 0})
          </button>
        </div>

        {/* Tab 1: My Tickets */}
        {activeTab === 'tickets' && (
          <div className="rpt-my-tickets-grid">
            {/* Overdue / Due Today */}
            {sections.overdue?.length > 0 && (
              <div className="rpt-card rpt-border-danger">
                <div className="rpt-card-head">
                  <h3 className="rpt-card-title">⚠️ Overdue Tasks</h3>
                  <span className="rpt-badge badge-danger">{sections.overdue.length}</span>
                </div>
                <div className="rpt-card-body rpt-compact-list">
                  {sections.overdue.map((t) => (
                    <div key={t.id} className="rpt-ticket-row">
                      <Link href={`/t/${encodeURIComponent(ticketKey(t))}`} className="rpt-ticket-link">
                        <strong>[{ticketKey(t)}]</strong> {t.title}
                      </Link>
                      <div className="rpt-ticket-meta">
                        <span>Project: {t.project_name}</span> ·{' '}
                        <span className="rpt-danger-text">Due: {t.due_date}</span> ·{' '}
                        <span className={`priority-${t.priority}`}>{t.priority}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* To Do */}
            <div className="rpt-card">
              <div className="rpt-card-head">
                <h3 className="rpt-card-title">📥 Open & In Progress Work</h3>
                <span className="rpt-badge badge-open">{sections.todo?.length || 0}</span>
              </div>
              <div className="rpt-card-body rpt-compact-list">
                {!sections.todo?.length ? (
                  <div className="rpt-empty-compact">No open work items assigned to you.</div>
                ) : (
                  sections.todo.map((t) => (
                    <div key={t.id} className="rpt-ticket-row">
                      <Link href={`/t/${encodeURIComponent(ticketKey(t))}`} className="rpt-ticket-link">
                        <strong>[{ticketKey(t)}]</strong> {t.title}
                      </Link>
                      <div className="rpt-ticket-meta">
                        <span>Project: {t.project_name}</span> ·{' '}
                        <span>Status: {t.status}</span> ·{' '}
                        <span className={`priority-${t.priority}`}>{t.priority}</span>
                        {t.due_date && <span> · Due: {t.due_date}</span>}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Completed */}
            <div className="rpt-card">
              <div className="rpt-card-head">
                <h3 className="rpt-card-title">✅ Recently Completed</h3>
                <span className="rpt-badge badge-resolved">{sections.completed?.length || 0}</span>
              </div>
              <div className="rpt-card-body rpt-compact-list">
                {!sections.completed?.length ? (
                  <div className="rpt-empty-compact">No completed tickets yet.</div>
                ) : (
                  sections.completed.map((t) => (
                    <div key={t.id} className="rpt-ticket-row">
                      <Link href={`/t/${encodeURIComponent(ticketKey(t))}`} className="rpt-ticket-link">
                        <strong>[{ticketKey(t)}]</strong> {t.title}
                      </Link>
                      <div className="rpt-ticket-meta">
                        <span>Project: {t.project_name}</span> · <span>Status: {t.status}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: My Work Logs */}
        {activeTab === 'logs' && (
          <div className="rpt-card">
            <div className="rpt-card-head">
              <h3 className="rpt-card-title">Recent Time Tracking Submissions</h3>
              <span className="rpt-card-meta">{sections.recentTimeLogs?.length || 0} entries</span>
            </div>
            <div className="rpt-card-body">
              {!sections.recentTimeLogs?.length ? (
                <div className="rpt-empty-compact">No time logs submitted in this period.</div>
              ) : (
                <div className="rpt-table-wrapper">
                  <table className="rpt-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Ticket</th>
                        <th>Duration</th>
                        <th>Work Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sections.recentTimeLogs.map((l) => (
                        <tr key={l.id}>
                          <td>{l.work_date || (l.created_at || '').slice(0, 10)}</td>
                          <td>
                            <Link href={`/t/${encodeURIComponent(l.project_key ? `${l.project_key}-${l.ticket_id}` : l.ticket_id)}`} className="rpt-drilldown-link">
                              {l.ticket_title}
                            </Link>
                          </td>
                          <td>
                            <strong>
                              {Math.round((l.duration_minutes || Math.round(Number(l.seconds || 0) / 60)))}m
                            </strong>
                          </td>
                          <td>{l.note || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tab 3: My Task Sheets */}
        {activeTab === 'sheets' && (
          <div className="rpt-card">
            <div className="rpt-card-head">
              <h3 className="rpt-card-title">Task Sheet Submissions History</h3>
              <Link href="/task-sheet/history" className="rpt-card-link">
                View Full Team Sheet History →
              </Link>
            </div>
            <div className="rpt-card-body">
              {!sections.recentTaskSheets?.length ? (
                <div className="rpt-empty-compact">No Task Sheet submissions found.</div>
              ) : (
                <div className="rpt-table-wrapper">
                  <table className="rpt-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Project</th>
                        <th>Task</th>
                        <th>Hours</th>
                        <th>State</th>
                        <th>Blocker</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sections.recentTaskSheets.map((s) => (
                        <tr key={s.id}>
                          <td>{(s.created_at || '').slice(0, 10)}</td>
                          <td>{s.project}</td>
                          <td>{s.task_title}</td>
                          <td>{Number(s.hours_worked || 0).toFixed(1)}h</td>
                          <td>
                            <span
                              className={`rpt-badge ${
                                s.task_state === 'completed' ? 'badge-resolved' : 'badge-open'
                              }`}
                            >
                              {s.task_state === 'completed' ? 'Completed' : 'Pending'}
                            </span>
                          </td>
                          <td>{s.blocker || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tab 4: My Blockers */}
        {activeTab === 'blockers' && (
          <div className="rpt-card">
            <div className="rpt-card-head">
              <h3 className="rpt-card-title">Reported Blockers</h3>
            </div>
            <div className="rpt-card-body">
              {!sections.blockers?.length ? (
                <div className="rpt-empty-compact">
                  🎉 You have no active blockers reported in your task sheets!
                </div>
              ) : (
                <div className="rpt-compact-list">
                  {sections.blockers.map((b) => (
                    <div key={b.id} className="rpt-exception-row">
                      <div className="rpt-exception-title">
                        <strong>Project {b.project}:</strong> {b.task_title}
                      </div>
                      <div className="rpt-blocker-note">
                        <strong>Blocker:</strong> {b.blocker}
                      </div>
                      <div className="rpt-exception-sub">
                        Reported on {(b.created_at || '').slice(0, 10)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Notice on Leave & Attendance */}
        <div className="rpt-unavailable-box" style={{ marginTop: '24px' }}>
          <div className="rpt-unavailable-icon">ℹ️</div>
          <div className="rpt-unavailable-text">
            <h4>Attendance & Leave Status</h4>
            <p>
              Your personal work hours and daily task submissions are tracked above. Clock-in
              attendance and approved leave balances will appear here once the attendance hardware
              integration is enabled by your administrator.
            </p>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

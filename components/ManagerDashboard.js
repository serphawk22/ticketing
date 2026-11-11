'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AppShell from './AppShell';
import PageHeader from './PageHeader';
import { BarChartIcon } from './AppShellIcons';
import {
  BlockersAndReconciliationPanel,
  EmployeeEffortTable,
  MonitoringKpiGrid,
  MonitoringOverviewSpotlight,
  MonitoringWindowBar,
  ProjectEffortTable,
  StageBottlenecksPanel,
} from './MonitoringPanels';

export default function ManagerDashboard({
  initialOverview,
  projects = [],
  currentUser,
}) {
  const router = useRouter();
  const [overview, setOverview] = useState(initialOverview);
  const [preset, setPreset] = useState(initialOverview?.window?.preset || 'this_month');
  const [activeTab, setActiveTab] = useState('overview');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function refreshWindow(nextPreset, customRange = null) {
    setPreset(customRange ? 'custom' : nextPreset);
    setLoading(true);
    setError('');
    try {
      const qs = new URLSearchParams();
      if (customRange?.from && customRange?.to) {
        qs.set('preset', 'custom');
        qs.set('from', customRange.from);
        qs.set('to', customRange.to);
      } else {
        qs.set('preset', nextPreset);
      }
      const res = await fetch(`/api/monitoring/manager-overview?${qs.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load team overview.');
      setOverview(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const alertsCount =
    (overview?.reconciliationSummary?.missingTaskSheetCount || 0) +
    (overview?.reconciliationSummary?.largeGapCount || 0) +
    (overview?.reconciliationSummary?.loggedWithoutAttendanceCount || 0);
  const stuckCount = (overview?.stuckTickets || []).length;

  const tabs = [
    { id: 'overview', label: 'Overview', count: null },
    { id: 'projects', label: 'Projects', count: (overview?.projectEffort || []).length },
    { id: 'employees', label: 'Team Members', count: (overview?.employeeDistribution || []).length },
    { id: 'stages', label: 'Stages & Bottlenecks', count: stuckCount, alert: stuckCount > 0 },
    { id: 'reconciliation', label: 'Reconciliation & Blockers', count: alertsCount, alert: alertsCount > 0 },
  ];

  return (
    <AppShell
      currentUser={currentUser}
      projects={projects}
      view="admin-dashboard"
      onProjectChange={(id) => router.push(`/?project=${id}`)}
      onCreate={() => {}}
    >
      <div className="board m360-page">
        <PageHeader
          breadcrumb={[{ label: 'Monitoring' }, { label: 'Team 360°' }]}
          title="Team & Project 360° Dashboard"
          icon={<BarChartIcon />}
          subtitle="Scoped strictly to your direct/indirect reportees and assigned project memberships (IST)."
          actions={
            <Link href="/reports" className="btn btn-secondary" style={{ fontSize: 13 }}>
              Scoped Reports
            </Link>
          }
        />

        {error && (
          <div className="ts-banner" role="alert">
            <strong>Notice:</strong> {error}
          </div>
        )}

        <MonitoringWindowBar
          preset={preset}
          onPresetChange={(p) => refreshWindow(p)}
          onCustomRangeApply={(range) => refreshWindow('custom', range)}
          loading={loading}
          windowRange={overview?.window}
        />

        <MonitoringKpiGrid
          totals={overview?.teamTotals}
          reconciliationSummary={overview?.reconciliationSummary}
          onCardClick={(tabKey) => setActiveTab(tabKey)}
          extraCards={[
            {
              key: 'scope',
              tabKey: 'employees',
              title: 'Management Scope',
              value: `${overview?.scopedEmployeeIds?.length ?? 0} Team`,
              subtitle: `${overview?.scopedProjectIds?.length ?? 0} assigned projects`,
              tone: 'pos',
            },
          ]}
        />

        <div className="m360-tabs-bar m360-animate-in" role="tablist" aria-label="Team 360 Monitoring sections">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={activeTab === t.id}
              className={`m360-tab-btn${activeTab === t.id ? ' is-active' : ''}`}
              onClick={() => setActiveTab(t.id)}
            >
              <span>{t.label}</span>
              {t.count !== null && (
                <span className={`m360-tab-badge${t.alert ? ' is-alert' : ''}`}>
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>

        <div key={activeTab}>
          {activeTab === 'overview' && (
            <MonitoringOverviewSpotlight
              totals={overview?.teamTotals}
              projectEffort={overview?.projectEffort}
              employeeDistribution={overview?.employeeDistribution}
              categoryDistribution={overview?.categoryDistribution}
              stageBottlenecks={overview?.stageBottlenecks}
              stuckTickets={overview?.stuckTickets}
              reconciliationAlerts={overview?.reconciliationAlerts}
              recentBlockers={overview?.recentBlockers}
              loading={loading}
              onNavigateTab={(tabId) => setActiveTab(tabId)}
            />
          )}

          {activeTab === 'projects' && (
            <ProjectEffortTable rows={overview?.projectEffort} loading={loading} />
          )}

          {activeTab === 'employees' && (
            <EmployeeEffortTable rows={overview?.employeeDistribution} loading={loading} />
          )}

          {activeTab === 'stages' && (
            <StageBottlenecksPanel
              stageBottlenecks={overview?.stageBottlenecks}
              stuckTickets={overview?.stuckTickets}
              loading={loading}
            />
          )}

          {activeTab === 'reconciliation' && (
            <BlockersAndReconciliationPanel
              categoryDistribution={overview?.categoryDistribution}
              reconciliationAlerts={overview?.reconciliationAlerts}
              recentBlockers={overview?.recentBlockers}
              loading={loading}
            />
          )}
        </div>
      </div>
    </AppShell>
  );
}

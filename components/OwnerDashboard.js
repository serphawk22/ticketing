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

export default function OwnerDashboard({
  initialOverview,
  projects = [],
  currentUser,
}) {
  const router = useRouter();
  const [overview, setOverview] = useState(initialOverview);
  const [preset, setPreset] = useState(initialOverview?.window?.preset || 'this_month');
  const [activeTab, setActiveTab] = useState('overview');
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState('');
  const [verifiedNotice, setVerifiedNotice] = useState('');

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
      const res = await fetch(`/api/monitoring/owner-overview?${qs.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load owner overview.');
      setOverview(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function confirmScheduleBaseline() {
    setVerifying(true);
    setError('');
    setVerifiedNotice('');
    try {
      const res = await fetch('/api/admin/business-schedule/verify-baseline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scheduleId: overview?.scheduleBaseline?.activeScheduleId,
          effective_from: overview?.scheduleBaseline?.effectiveFrom,
          notes: 'Verified by Owner/Admin via 360 Executive Dashboard',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to verify schedule baseline.');
      setVerifiedNotice('Baseline working schedule verified cleanly.');
      await refreshWindow(preset, preset === 'custom' ? {
        from: overview?.window?.fromDate,
        to: overview?.window?.toDate,
      } : null);
    } catch (err) {
      setError(err.message);
    } finally {
      setVerifying(false);
    }
  }

  const baseline = overview?.scheduleBaseline;
  const isProvisional = baseline?.sourceConfidence !== 'verified';
  const unmappedCount = overview?.companyTotals?.unmappedLegacyCount ?? 0;
  const alertsCount =
    (overview?.reconciliationSummary?.missingTaskSheetCount || 0) +
    (overview?.reconciliationSummary?.largeGapCount || 0) +
    (overview?.reconciliationSummary?.loggedWithoutAttendanceCount || 0);
  const stuckCount = (overview?.stuckTickets || []).length;

  const tabs = [
    { id: 'overview', label: 'Overview', count: null },
    { id: 'projects', label: 'Projects', count: (overview?.projectEffort || []).length },
    { id: 'employees', label: 'Employees', count: (overview?.employeeDistribution || []).length },
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
          breadcrumb={[{ label: 'Monitoring' }, { label: currentUser?.role === 'owner' ? 'Owner 360°' : 'Admin 360°' }]}
          title="SerpHawk 360° Executive Monitoring"
          icon={<BarChartIcon />}
          subtitle="Interactive overview of employee effort, stage bottlenecks, blockers, and attendance reconciliation (IST)."
          actions={
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <Link href="/task-sheet/history?tab=tokens" className="btn btn-secondary" style={{ fontSize: 13 }}>
                Shared Links & Legacy Map
              </Link>
              <Link href="/task-sheet/history" className="btn btn-secondary" style={{ fontSize: 13 }}>
                Sheet History
              </Link>
              <Link href="/reports" className="btn btn-primary" style={{ fontSize: 13 }}>
                Reports Hub (76)
              </Link>
            </div>
          }
        />

        {error && (
          <div className="ts-banner" role="alert">
            <strong>Notice:</strong> {error}
          </div>
        )}

        {verifiedNotice && (
          <div className="m360-baseline-banner is-verified m360-animate-in" role="status">
            <span>
              <span className="m360-pulse-dot is-ok" aria-hidden="true" />
              <strong>{verifiedNotice}</strong>
            </span>
          </div>
        )}

        {baseline && (
          <div className={`m360-baseline-banner m360-animate-in ${isProvisional ? 'is-provisional' : 'is-verified'}`}>
            <div>
              <span className={`m360-pulse-dot ${isProvisional ? 'is-warn' : 'is-ok'}`} aria-hidden="true" />
              <strong>Business Schedule Baseline ({baseline.effectiveFrom || 'Current'}):</strong>{' '}
              {baseline.workStartTime}–{baseline.workEndTime} IST · Days [{baseline.workingDays}] · Status:{' '}
              <strong>{isProvisional ? 'Provisional (Inferred from settings)' : 'Verified'}</strong>
            </div>
            {isProvisional && (
              <button
                type="button"
                className="btn btn-primary"
                disabled={verifying}
                onClick={confirmScheduleBaseline}
                style={{ fontSize: 12, padding: '6px 12px' }}
              >
                {verifying ? 'Confirming…' : 'Confirm Baseline Schedule'}
              </button>
            )}
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
          totals={overview?.companyTotals}
          reconciliationSummary={overview?.reconciliationSummary}
          onCardClick={(tabKey) => setActiveTab(tabKey)}
          extraCards={[
            {
              key: 'legacy',
              href: '/task-sheet/history?tab=legacy',
              title: 'Unmapped Legacy Sheets',
              value: `${unmappedCount}`,
              subtitle: `${overview?.companyTotals?.activeEmployeesCount ?? 0} active employees · ${overview?.companyTotals?.activeProjectsCount ?? 0} projects`,
              tone: unmappedCount > 0 ? 'warn' : 'pos',
            },
          ]}
        />

        {/* Interactive View Tabs */}
        <div className="m360-tabs-bar m360-animate-in" role="tablist" aria-label="360 Monitoring sections">
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

        {/* Active Tab Content */}
        <div key={activeTab}>
          {activeTab === 'overview' && (
            <MonitoringOverviewSpotlight
              totals={overview?.companyTotals}
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

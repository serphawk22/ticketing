'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import KpiCard from './reports/KpiCard';
import { DonutChart } from './reports/ReportCharts';

export function fmtMinutes(mins) {
  const m = Math.round(Number(mins || 0));
  const sign = m < 0 ? '-' : '';
  const abs = Math.abs(m);
  const h = Math.floor(abs / 60);
  const rem = abs % 60;
  if (h === 0) return `${sign}${rem}m`;
  return rem === 0 ? `${sign}${h}h` : `${sign}${h}h ${rem}m`;
}

export function fmtSeconds(sec) {
  const s = Math.max(0, Math.round(Number(sec || 0)));
  if (s < 60) return `${s}s`;
  const mins = Math.round(s / 60);
  if (mins < 60) return `${mins}m`;
  const h = (s / 3600).toFixed(1);
  return `${h}h`;
}

function useAnimatedNumber(targetValue, durationMs = 450) {
  const num = Number(targetValue || 0);
  const [display, setDisplay] = useState(num);

  useEffect(() => {
    if (!Number.isFinite(num)) {
      setDisplay(0);
      return undefined;
    }
    const startVal = display;
    if (startVal === num) return undefined;
    const startTime = performance.now();
    let rafId;
    const step = (now) => {
      const elapsed = now - startTime;
      const t = Math.min(1, elapsed / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(startVal + (num - startVal) * eased));
      if (t < 1) {
        rafId = requestAnimationFrame(step);
      }
    };
    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
    // Intentionally animate from previous display on target change only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [num]);

  return display;
}

function KpiClockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15.5 14" />
    </svg>
  );
}

function KpiTicketIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M8 10h8M8 14h5" />
    </svg>
  );
}

function KpiAlertIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function KpiBlockerIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <line x1="5.6" y1="5.6" x2="18.4" y2="18.4" />
    </svg>
  );
}

function KpiArchiveIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="4" rx="1" />
      <path d="M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8" />
      <line x1="10" y1="12" x2="14" y2="12" />
    </svg>
  );
}

export function PrecisionBadge({ precision }) {
  const labels = {
    verified: { text: 'Verified Schedule', cls: 'm360-pill-ok' },
    provisional_baseline: { text: 'Provisional Baseline', cls: 'm360-pill-warn' },
    estimated_pre_schedule: { text: 'Estimated Pre-Schedule', cls: 'm360-pill-danger' },
    mixed_estimated: { text: 'Mixed / Partial Est.', cls: 'm360-pill-info' },
  };
  const meta = labels[precision] || labels.provisional_baseline;
  return <span className={`m360-pill ${meta.cls}`}>{meta.text}</span>;
}

export function ReconciliationBadge({ status }) {
  const map = {
    reconciled: { text: 'Reconciled', cls: 'm360-pill-ok' },
    missing_task_sheet: { text: 'Missing Task Sheet', cls: 'm360-pill-danger' },
    large_unaccounted_gap: { text: 'Large Unaccounted Gap', cls: 'm360-pill-warn' },
    logged_without_attendance: { text: 'Logged Without Attendance', cls: 'm360-pill-info' },
    on_leave_or_holiday: { text: 'Leave / Holiday', cls: 'm360-pill-muted' },
    absent_no_log: { text: 'Absent / No Log', cls: 'm360-pill-muted' },
  };
  const meta = map[status] || { text: status, cls: 'm360-pill-muted' };
  return <span className={`m360-pill ${meta.cls}`}>{meta.text}</span>;
}

export function MonitoringWindowBar({
  preset,
  onPresetChange,
  onCustomRangeApply,
  loading,
  windowRange,
}) {
  const presets = [
    { id: 'today', label: 'Today' },
    { id: 'yesterday', label: 'Yesterday' },
    { id: 'this_week', label: 'This Week' },
    { id: 'this_month', label: 'This Month' },
    { id: 'last_month', label: 'Last Month' },
    { id: 'last_30_days', label: 'Last 30 Days' },
  ];

  const [showCustom, setShowCustom] = useState(preset === 'custom');
  const [fromDate, setFromDate] = useState(windowRange?.fromDate || '');
  const [toDate, setToDate] = useState(windowRange?.toDate || '');

  useEffect(() => {
    if (windowRange?.fromDate) setFromDate(windowRange.fromDate);
    if (windowRange?.toDate) setToDate(windowRange.toDate);
  }, [windowRange?.fromDate, windowRange?.toDate]);

  function handlePresetClick(id) {
    setShowCustom(false);
    onPresetChange?.(id);
  }

  function handleApplyCustom(e) {
    e.preventDefault();
    if (!fromDate || !toDate || fromDate > toDate) return;
    onCustomRangeApply?.({ from: fromDate, to: toDate });
  }

  return (
    <div className="m360-window-bar m360-animate-in">
      <div className="m360-preset-pills" role="group" aria-label="IST time presets">
        {presets.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`m360-preset-pill${preset === p.id && !showCustom ? ' is-active' : ''}`}
            disabled={loading}
            onClick={() => handlePresetClick(p.id)}
          >
            {p.label}
          </button>
        ))}
        {onCustomRangeApply && (
          <button
            type="button"
            className={`m360-preset-pill${showCustom || preset === 'custom' ? ' is-active' : ''}`}
            disabled={loading}
            onClick={() => setShowCustom((v) => !v)}
          >
            Custom Range
          </button>
        )}
      </div>

      <div className="m360-window-meta">
        {showCustom && onCustomRangeApply && (
          <form onSubmit={handleApplyCustom} className="m360-custom-dates">
            <input
              type="date"
              className="m360-date-input"
              aria-label="From date (IST)"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              required
            />
            <span>to</span>
            <input
              type="date"
              className="m360-date-input"
              aria-label="To date (IST)"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              required
            />
            <button
              type="submit"
              className="btn btn-primary"
              style={{ fontSize: 12, padding: '4px 10px', height: 30 }}
              disabled={loading || !fromDate || !toDate || fromDate > toDate}
            >
              Apply
            </button>
          </form>
        )}

        {windowRange && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {loading && <span className="m360-spinner" aria-hidden="true" />}
            <span>
              IST: <strong>{windowRange.fromDate}</strong> → <strong>{windowRange.toDate}</strong>
            </span>
          </span>
        )}
      </div>
    </div>
  );
}

export function MonitoringKpiGrid({
  totals,
  reconciliationSummary,
  extraCards = [],
  onCardClick,
}) {
  const animLoggedMins = useAnimatedNumber(totals?.totalLoggedMinutes || 0);
  const animOpenTickets = useAnimatedNumber(totals?.openTickets || 0);
  const alertsCount =
    (reconciliationSummary?.missingTaskSheetCount || 0) +
    (reconciliationSummary?.largeGapCount || 0) +
    (reconciliationSummary?.loggedWithoutAttendanceCount || 0);
  const animAlerts = useAnimatedNumber(alertsCount);
  const animBlockers = useAnimatedNumber(totals?.blockersCount || 0);

  const overdueCount = totals?.overdueTickets || 0;

  const cards = [
    {
      key: 'effort',
      tabKey: 'overview',
      title: 'Canonical Logged Work',
      value: fmtMinutes(animLoggedMins),
      subtitle: `Tickets: ${fmtMinutes(totals?.ticketWorkMinutes || 0)} · Company: ${fmtMinutes(totals?.companyActivityMinutes || 0)}`,
      tone: 'pos',
      icon: KpiClockIcon,
    },
    {
      key: 'tickets',
      tabKey: 'stages',
      title: 'Open / Overdue Tickets',
      value: `${animOpenTickets}`,
      subtitle: overdueCount > 0 ? `${overdueCount} overdue active tickets` : 'All active tickets within due date',
      tone: overdueCount > 0 ? 'warn' : 'pos',
      icon: KpiTicketIcon,
    },
    {
      key: 'reconciliation',
      tabKey: 'reconciliation',
      title: 'Reconciliation Alerts',
      value: `${animAlerts}`,
      subtitle: `Missing TS: ${reconciliationSummary?.missingTaskSheetCount || 0} · Gap: ${reconciliationSummary?.largeGapCount || 0}`,
      tone: alertsCount > 0 ? 'neg' : 'pos',
      icon: KpiAlertIcon,
    },
    {
      key: 'blockers',
      tabKey: 'reconciliation',
      title: 'Active Blockers Logged',
      value: `${animBlockers}`,
      subtitle: `Attendance Net: ${fmtMinutes(reconciliationSummary?.totalAttendanceMinutes || 0)}`,
      tone: (totals?.blockersCount || 0) > 0 ? 'warn' : undefined,
      icon: KpiBlockerIcon,
    },
    ...extraCards.map((c, idx) => ({
      key: c.key || `extra-${idx}`,
      tabKey: c.tabKey || null,
      href: c.href || null,
      title: c.title || c.label,
      value: c.value,
      subtitle: c.subtitle || c.sub,
      tone: c.tone,
      icon: c.icon || KpiArchiveIcon,
    })),
  ];

  return (
    <div className="m360-kpi-grid">
      {cards.map((card, i) => {
        const delayCls = `m360-animate-in m360-delay-${Math.min(4, i + 1)}`;
        const inner = (
          <KpiCard
            title={card.title}
            value={card.value}
            subtitle={card.subtitle}
            tone={card.tone}
            icon={card.icon}
          />
        );

        if (card.href) {
          return (
            <Link
              key={card.key}
              href={card.href}
              className={`m360-kpi-btn ${delayCls}`}
              style={{ textDecoration: 'none' }}
              title="Click to inspect details"
            >
              {inner}
            </Link>
          );
        }

        if (onCardClick && card.tabKey) {
          return (
            <button
              key={card.key}
              type="button"
              className={`m360-kpi-btn ${delayCls}`}
              onClick={() => onCardClick(card.tabKey)}
              title={`Open ${card.tabKey} view`}
            >
              {inner}
            </button>
          );
        }

        return (
          <div key={card.key} className={`m360-kpi-static ${delayCls}`}>
            {inner}
          </div>
        );
      })}
    </div>
  );
}

const STAGE_ORDER_LABELS = {
  open: 'To Do',
  in_progress: 'In Progress',
  resolved: 'QA Testing',
  closed: 'Closed / Done',
};

export function MonitoringOverviewSpotlight({
  totals,
  projectEffort = [],
  employeeDistribution = [],
  categoryDistribution = [],
  stageBottlenecks = [],
  stuckTickets = [],
  reconciliationAlerts = [],
  recentBlockers = [],
  loading = false,
  onNavigateTab,
}) {
  const [donutMode, setDonutMode] = useState('category');

  const categoryDonutData = useMemo(
    () =>
      categoryDistribution.slice(0, 7).map((c) => ({
        label: c.label,
        count: Math.round((Number(c.minutes || 0) / 60) * 10) / 10,
      })),
    [categoryDistribution]
  );

  const splitDonutData = useMemo(() => {
    const ticketH = Math.round((Number(totals?.ticketWorkMinutes || 0) / 60) * 10) / 10;
    const companyH = Math.round((Number(totals?.companyActivityMinutes || 0) / 60) * 10) / 10;
    return [
      { label: 'Ticket Work', count: ticketH, color: '#0c66e4' },
      { label: 'Company / Non-Ticket', count: companyH, color: '#6554c0' },
    ].filter((d) => d.count > 0);
  }, [totals?.ticketWorkMinutes, totals?.companyActivityMinutes]);

  const maxStageSec = useMemo(
    () => Math.max(1, ...stageBottlenecks.map((s) => Math.max(s.avgCalendarSeconds || 0, s.avgBusinessSeconds || 0))),
    [stageBottlenecks]
  );

  const topProjects = useMemo(() => projectEffort.slice(0, 5), [projectEffort]);
  const maxProjMins = useMemo(() => Math.max(1, ...topProjects.map((p) => p.loggedMinutes || 0)), [topProjects]);

  const topEmployees = useMemo(() => employeeDistribution.slice(0, 5), [employeeDistribution]);
  const maxEmpMins = useMemo(() => Math.max(1, ...topEmployees.map((e) => e.totalMinutes || 0)), [topEmployees]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="m360-two-col">
        {/* Interactive Donut Chart */}
        <section className={`m360-panel m360-animate-in${loading ? ' is-loading' : ''}`}>
          <div className="m360-panel-head">
            <div>
              <h2 className="m360-panel-title">Effort Distribution</h2>
              <div className="m360-panel-sub">Hover any slice to inspect logged hours</div>
            </div>
            <div className="m360-chip-filter">
              <button
                type="button"
                className={`m360-chip${donutMode === 'category' ? ' is-active' : ''}`}
                onClick={() => setDonutMode('category')}
              >
                By Category
              </button>
              <button
                type="button"
                className={`m360-chip${donutMode === 'split' ? ' is-active' : ''}`}
                onClick={() => setDonutMode('split')}
              >
                Ticket vs Company
              </button>
            </div>
          </div>
          <div className="m360-panel-body">
            <DonutChart
              data={donutMode === 'category' ? categoryDonutData : splitDonutData}
              size={190}
              innerRadius={56}
              centerLabel="Logged Hours"
              unit="h"
            />
          </div>
        </section>

        {/* Visual Stage Dwell Comparison */}
        <section className={`m360-panel m360-animate-in m360-delay-1${loading ? ' is-loading' : ''}`}>
          <div className="m360-panel-head">
            <div>
              <h2 className="m360-panel-title">Workflow Stage Dwell (Avg Hours)</h2>
              <div className="m360-panel-sub">Calendar time vs Business working hours</div>
            </div>
            {onNavigateTab && (
              <button
                type="button"
                className="btn btn-secondary"
                style={{ fontSize: 12, padding: '4px 10px' }}
                onClick={() => onNavigateTab('stages')}
              >
                Inspect Bottlenecks →
              </button>
            )}
          </div>
          <div className="m360-panel-body">
            {stageBottlenecks.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--text-subtle)' }}>No stage history recorded in this scope yet.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {stageBottlenecks.map((s) => {
                  const calPct = Math.round(((s.avgCalendarSeconds || 0) / maxStageSec) * 100);
                  const busPct = Math.round(((s.avgBusinessSeconds || 0) / maxStageSec) * 100);
                  return (
                    <div key={s.status}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12.5, marginBottom: 5 }}>
                        <span>
                          <strong>{s.label || STAGE_ORDER_LABELS[s.status] || s.status}</strong>{' '}
                          <span style={{ color: 'var(--text-subtle)' }}>
                            ({s.visitCount} visits · {s.activeCount} active)
                          </span>
                        </span>
                        <span style={{ fontSize: 12 }}>
                          <span style={{ color: '#6554c0', fontWeight: 600 }}>{fmtSeconds(s.avgCalendarSeconds)} cal</span>
                          {' · '}
                          <span style={{ color: '#0c66e4', fontWeight: 700 }}>{fmtSeconds(s.avgBusinessSeconds)} bus</span>
                        </span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <div className="m360-bar-track" style={{ height: 6 }} title={`Avg Calendar: ${fmtSeconds(s.avgCalendarSeconds)}`}>
                          <div className="m360-bar-fill" style={{ width: `${calPct}%`, background: '#8777d9' }} />
                        </div>
                        <div className="m360-bar-track" style={{ height: 6 }} title={`Avg Business: ${fmtSeconds(s.avgBusinessSeconds)}`}>
                          <div className="m360-bar-fill" style={{ width: `${busPct}%`, background: '#0c66e4' }} />
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div style={{ display: 'flex', gap: 16, fontSize: 11.5, color: 'var(--text-subtle)', paddingTop: 4 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ width: 10, height: 6, borderRadius: 4, background: '#8777d9', display: 'inline-block' }} />
                    Avg Calendar Time
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ width: 10, height: 6, borderRadius: 4, background: '#0c66e4', display: 'inline-block' }} />
                    Avg Business Time
                  </span>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Bottom 3-column Spotlight */}
      <div className="m360-three-col">
        {/* Top Projects */}
        <section className={`m360-panel m360-animate-in m360-delay-2${loading ? ' is-loading' : ''}`}>
          <div className="m360-panel-head">
            <h2 className="m360-panel-title">Top Active Projects</h2>
            {onNavigateTab && (
              <button
                type="button"
                className="m360-sort-btn"
                style={{ fontSize: 12 }}
                onClick={() => onNavigateTab('projects')}
              >
                View all ({projectEffort.length}) →
              </button>
            )}
          </div>
          <div className="m360-panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {topProjects.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--text-subtle)' }}>No project effort logged in this window.</p>
            ) : (
              topProjects.map((p) => {
                const pct = Math.max(4, Math.round(((p.loggedMinutes || 0) / maxProjMins) * 100));
                return (
                  <div key={p.projectId}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 4 }}>
                      <Link href={`/projects/${p.projectId}/monitoring`} className="m360-link">
                        {p.projectKey ? `[${p.projectKey}] ` : ''}{p.projectName}
                      </Link>
                      <span>
                        <strong>{fmtMinutes(p.loggedMinutes)}</strong>
                        {p.overdueTickets > 0 && (
                          <span className="m360-pill m360-pill-danger" style={{ marginLeft: 6 }}>
                            {p.overdueTickets} overdue
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="m360-bar-track">
                      <div className="m360-bar-fill" style={{ width: `${pct}%`, background: p.projectColor || '#0c66e4' }} />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* Top Contributors */}
        <section className={`m360-panel m360-animate-in m360-delay-3${loading ? ' is-loading' : ''}`}>
          <div className="m360-panel-head">
            <h2 className="m360-panel-title">Top Contributors</h2>
            {onNavigateTab && (
              <button
                type="button"
                className="m360-sort-btn"
                style={{ fontSize: 12 }}
                onClick={() => onNavigateTab('employees')}
              >
                View all ({employeeDistribution.length}) →
              </button>
            )}
          </div>
          <div className="m360-panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {topEmployees.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--text-subtle)' }}>No employee work logs in this window.</p>
            ) : (
              topEmployees.map((e) => {
                const pct = Math.max(4, Math.round(((e.totalMinutes || 0) / maxEmpMins) * 100));
                return (
                  <div key={e.employeeId}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 4 }}>
                      <Link href={`/monitoring/employees/${e.employeeId}`} className="m360-link">
                        {e.employeeName}
                      </Link>
                      <span>
                        <strong>{fmtMinutes(e.totalMinutes)}</strong>
                        <span style={{ color: 'var(--text-subtle)', marginLeft: 6, fontSize: 11.5 }}>
                          ({e.projectCount} proj)
                        </span>
                      </span>
                    </div>
                    <div className="m360-bar-track">
                      <div className="m360-bar-fill" style={{ width: `${pct}%`, background: '#00875a' }} />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* Attention Queue */}
        <section className={`m360-panel m360-animate-in m360-delay-4${loading ? ' is-loading' : ''}`}>
          <div className="m360-panel-head">
            <h2 className="m360-panel-title">Attention Queue</h2>
            {onNavigateTab && (
              <button
                type="button"
                className="m360-sort-btn"
                style={{ fontSize: 12 }}
                onClick={() => onNavigateTab('reconciliation')}
              >
                Triage all →
              </button>
            )}
          </div>
          <div className="m360-panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {stuckTickets.slice(0, 2).map((t) => (
              <div key={`stuck-${t.ticketId}`} className="m360-feed-item">
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12 }}>
                  <strong>{t.key} · {t.title}</strong>
                  <span className="m360-pill m360-pill-warn">{t.calendarHours}h stuck</span>
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--text-subtle)', marginTop: 2 }}>
                  {t.projectName} · {t.assigneeName} · {STAGE_ORDER_LABELS[t.currentStage] || t.currentStage}
                </div>
              </div>
            ))}
            {reconciliationAlerts.slice(0, 2).map((r) => (
              <div key={`rec-${r.employeeId}-${r.workDate}`} className="m360-feed-item">
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12 }}>
                  <Link href={`/monitoring/employees/${r.employeeId}`} className="m360-link">
                    {r.employeeName} · {r.workDate}
                  </Link>
                  <ReconciliationBadge status={r.reconciliationStatus} />
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--text-subtle)', marginTop: 2 }}>
                  Attendance {fmtMinutes(r.attendanceNetMinutes)} vs Logged {fmtMinutes(r.totalLoggedMinutes)}
                </div>
              </div>
            ))}
            {recentBlockers.slice(0, 2).map((b, idx) => (
              <div key={`blk-${idx}`} className="m360-feed-item">
                <div style={{ fontSize: 12 }}>
                  <strong>{b.employeeName}</strong> · {b.workDate}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--danger)', marginTop: 2 }}>{b.blocker}</div>
              </div>
            ))}
            {stuckTickets.length === 0 && reconciliationAlerts.length === 0 && recentBlockers.length === 0 && (
              <p style={{ fontSize: 13, color: 'var(--success)', margin: 0 }}>
                All tickets, attendance logs, and blockers look healthy in this window.
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

export function ProjectEffortTable({ rows = [], loading = false }) {
  const [search, setSearch] = useState('');
  const [healthFilter, setHealthFilter] = useState('all');
  const [sortBy, setSortBy] = useState('loggedMinutes');
  const [sortDir, setSortDir] = useState('desc');

  function toggleSort(col) {
    if (sortBy === col) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortBy(col);
      setSortDir('desc');
    }
  }

  const maxMinutes = useMemo(() => Math.max(1, ...rows.map((r) => r.loggedMinutes || 0)), [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter((p) => {
        if (q) {
          const text = `${p.projectKey || ''} ${p.projectName || ''}`.toLowerCase();
          if (!text.includes(q)) return false;
        }
        if (healthFilter === 'logged' && !(p.loggedMinutes > 0)) return false;
        if (healthFilter === 'overdue' && !(p.overdueTickets > 0)) return false;
        return true;
      })
      .sort((a, b) => {
        const av = Number(a[sortBy] || 0);
        const bv = Number(b[sortBy] || 0);
        return sortDir === 'asc' ? av - bv : bv - av;
      });
  }, [rows, search, healthFilter, sortBy, sortDir]);

  const sortArrow = (col) => (sortBy === col ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '');

  return (
    <section className={`m360-panel m360-animate-in${loading ? ' is-loading' : ''}`}>
      <div className="m360-panel-head">
        <div>
          <h2 className="m360-panel-title">Project Effort & Delivery Health ({filtered.length})</h2>
          <div className="m360-panel-sub">Click any project to inspect ticket-level effort, stage dwell & team members</div>
        </div>
        <div className="m360-controls-row">
          <input
            type="search"
            className="m360-search-input"
            placeholder="Search projects…"
            aria-label="Search projects"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="m360-filter-select"
            aria-label="Filter projects"
            value={healthFilter}
            onChange={(e) => setHealthFilter(e.target.value)}
          >
            <option value="all">All Projects</option>
            <option value="logged">With Logged Effort</option>
            <option value="overdue">With Overdue Tickets</option>
          </select>
        </div>
      </div>

      <div className="m360-panel-body" style={{ padding: 0 }}>
        {filtered.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--text-subtle)', padding: 18, margin: 0 }}>
            No matching projects in this window.
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="m360-table">
              <thead>
                <tr>
                  <th align="left">Project</th>
                  <th align="left" style={{ minWidth: 180 }}>
                    <button type="button" className={`m360-sort-btn${sortBy === 'loggedMinutes' ? ' is-sorted' : ''}`} onClick={() => toggleSort('loggedMinutes')}>
                      Logged Work{sortArrow('loggedMinutes')}
                    </button>
                  </th>
                  <th align="right">
                    <button type="button" className={`m360-sort-btn${sortBy === 'contributorCount' ? ' is-sorted' : ''}`} onClick={() => toggleSort('contributorCount')}>
                      Team{sortArrow('contributorCount')}
                    </button>
                  </th>
                  <th align="right">
                    <button type="button" className={`m360-sort-btn${sortBy === 'openTickets' ? ' is-sorted' : ''}`} onClick={() => toggleSort('openTickets')}>
                      Open{sortArrow('openTickets')}
                    </button>
                  </th>
                  <th align="right">
                    <button type="button" className={`m360-sort-btn${sortBy === 'overdueTickets' ? ' is-sorted' : ''}`} onClick={() => toggleSort('overdueTickets')}>
                      Overdue{sortArrow('overdueTickets')}
                    </button>
                  </th>
                  <th align="right">
                    <button type="button" className={`m360-sort-btn${sortBy === 'closedTickets' ? ' is-sorted' : ''}`} onClick={() => toggleSort('closedTickets')}>
                      Closed{sortArrow('closedTickets')}
                    </button>
                  </th>
                  <th align="right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => {
                  const pct = p.loggedMinutes > 0 ? Math.max(4, Math.round((p.loggedMinutes / maxMinutes) * 100)) : 0;
                  return (
                    <tr key={p.projectId}>
                      <td>
                        <Link href={`/projects/${p.projectId}/monitoring`} className="m360-link">
                          {p.projectKey ? `[${p.projectKey}] ` : ''}{p.projectName}
                        </Link>
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <strong style={{ minWidth: 56 }}>{fmtMinutes(p.loggedMinutes)}</strong>
                          <div className="m360-bar-track" style={{ maxWidth: 130 }}>
                            <div className="m360-bar-fill" style={{ width: `${pct}%`, background: p.projectColor || '#0c66e4' }} />
                          </div>
                        </div>
                      </td>
                      <td align="right">{p.contributorCount}</td>
                      <td align="right">{p.openTickets}</td>
                      <td align="right">
                        {p.overdueTickets > 0 ? (
                          <span className="m360-pill m360-pill-danger">{p.overdueTickets}</span>
                        ) : (
                          <span style={{ color: 'var(--text-subtle)' }}>0</span>
                        )}
                      </td>
                      <td align="right">{p.closedTickets}</td>
                      <td align="right" style={{ whiteSpace: 'nowrap' }}>
                        <Link href={`/projects/${p.projectId}/monitoring`} className="m360-link" style={{ fontSize: 12, marginRight: 10 }}>
                          360°
                        </Link>
                        <Link href={`/projects/${p.projectId}/summary`} className="m360-link" style={{ fontSize: 12, color: 'var(--text-subtle)' }}>
                          Summary
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

export function EmployeeEffortTable({ rows = [], loading = false }) {
  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState('all');
  const [sortBy, setSortBy] = useState('totalMinutes');
  const [sortDir, setSortDir] = useState('desc');

  const departments = useMemo(() => {
    const set = new Set(rows.map((r) => r.department).filter(Boolean));
    return Array.from(set).sort();
  }, [rows]);

  function toggleSort(col) {
    if (sortBy === col) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortBy(col);
      setSortDir('desc');
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter((e) => {
        if (q && !String(e.employeeName || '').toLowerCase().includes(q)) return false;
        if (department !== 'all' && e.department !== department) return false;
        return true;
      })
      .sort((a, b) => {
        const av = Number(a[sortBy] || 0);
        const bv = Number(b[sortBy] || 0);
        return sortDir === 'asc' ? av - bv : bv - av;
      });
  }, [rows, search, department, sortBy, sortDir]);

  const sortArrow = (col) => (sortBy === col ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '');

  return (
    <section className={`m360-panel m360-animate-in${loading ? ' is-loading' : ''}`}>
      <div className="m360-panel-head">
        <div>
          <h2 className="m360-panel-title">Employee Effort & Time Distribution ({filtered.length})</h2>
          <div className="m360-panel-sub">Ticket work (blue) vs company/non-ticket work (purple) · Click a name for full ledger & reconciliation</div>
        </div>
        <div className="m360-controls-row">
          <input
            type="search"
            className="m360-search-input"
            placeholder="Search employees…"
            aria-label="Search employees"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {departments.length > 0 && (
            <select
              className="m360-filter-select"
              aria-label="Filter by department"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
            >
              <option value="all">All Departments</option>
              {departments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      <div className="m360-panel-body" style={{ padding: 0 }}>
        {filtered.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--text-subtle)', padding: 18, margin: 0 }}>
            No matching employee work logs in this window.
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="m360-table">
              <thead>
                <tr>
                  <th align="left">Employee</th>
                  <th align="left">Department</th>
                  <th align="right">
                    <button type="button" className={`m360-sort-btn${sortBy === 'totalMinutes' ? ' is-sorted' : ''}`} onClick={() => toggleSort('totalMinutes')}>
                      Total Logged{sortArrow('totalMinutes')}
                    </button>
                  </th>
                  <th align="left" style={{ minWidth: 150 }}>Work Mix</th>
                  <th align="right">
                    <button type="button" className={`m360-sort-btn${sortBy === 'ticketMinutes' ? ' is-sorted' : ''}`} onClick={() => toggleSort('ticketMinutes')}>
                      Ticket{sortArrow('ticketMinutes')}
                    </button>
                  </th>
                  <th align="right">
                    <button type="button" className={`m360-sort-btn${sortBy === 'companyActivityMinutes' ? ' is-sorted' : ''}`} onClick={() => toggleSort('companyActivityMinutes')}>
                      Non-Ticket{sortArrow('companyActivityMinutes')}
                    </button>
                  </th>
                  <th align="right">
                    <button type="button" className={`m360-sort-btn${sortBy === 'projectCount' ? ' is-sorted' : ''}`} onClick={() => toggleSort('projectCount')}>
                      Projects{sortArrow('projectCount')}
                    </button>
                  </th>
                  <th align="right">
                    <button type="button" className={`m360-sort-btn${sortBy === 'blockerCount' ? ' is-sorted' : ''}`} onClick={() => toggleSort('blockerCount')}>
                      Blockers{sortArrow('blockerCount')}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => {
                  const total = Math.max(1, e.totalMinutes || 0);
                  const ticketPct = Math.round(((e.ticketMinutes || 0) / total) * 100);
                  const compPct = 100 - ticketPct;
                  return (
                    <tr key={e.employeeId}>
                      <td>
                        <Link href={`/monitoring/employees/${e.employeeId}`} className="m360-link">
                          {e.employeeName}
                        </Link>
                      </td>
                      <td style={{ color: 'var(--text-subtle)' }}>{e.department || '—'}</td>
                      <td align="right"><strong>{fmtMinutes(e.totalMinutes)}</strong></td>
                      <td>
                        <div className="m360-split-bar" title={`Ticket ${ticketPct}% · Non-Ticket ${compPct}%`}>
                          <div className="m360-split-seg" style={{ width: `${ticketPct}%`, background: '#0c66e4' }} />
                          <div className="m360-split-seg" style={{ width: `${compPct}%`, background: '#8777d9' }} />
                        </div>
                      </td>
                      <td align="right">{fmtMinutes(e.ticketMinutes)}</td>
                      <td align="right">{fmtMinutes(e.companyActivityMinutes)}</td>
                      <td align="right">{e.projectCount}</td>
                      <td align="right">
                        {e.blockerCount > 0 ? (
                          <span className="m360-pill m360-pill-warn">{e.blockerCount}</span>
                        ) : (
                          <span style={{ color: 'var(--text-subtle)' }}>0</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

export function StageBottlenecksPanel({ stageBottlenecks = [], stuckTickets = [], loading = false }) {
  const [stageFilter, setStageFilter] = useState('all');
  const [ticketQuery, setTicketQuery] = useState('');

  const filteredStuck = useMemo(() => {
    const q = ticketQuery.trim().toLowerCase();
    return stuckTickets.filter((t) => {
      if (stageFilter !== 'all' && t.currentStage !== stageFilter) return false;
      if (q) {
        const hay = `${t.key || ''} ${t.title || ''} ${t.projectName || ''} ${t.assigneeName || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [stuckTickets, stageFilter, ticketQuery]);

  return (
    <div className="m360-two-col">
      <section className={`m360-panel m360-animate-in${loading ? ' is-loading' : ''}`}>
        <div className="m360-panel-head">
          <div>
            <h2 className="m360-panel-title">Ticket Stage Dwell (Calendar vs Business Time)</h2>
            <div className="m360-panel-sub">Average stage residence across workflow transitions</div>
          </div>
        </div>
        <div className="m360-panel-body" style={{ padding: 0 }}>
          {stageBottlenecks.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--text-subtle)', padding: 18, margin: 0 }}>
              No stage history recorded yet.
            </p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="m360-table">
                <thead>
                  <tr>
                    <th align="left">Stage</th>
                    <th align="right">Visits</th>
                    <th align="right">Avg Calendar</th>
                    <th align="right">Avg Business</th>
                    <th align="left">Precision</th>
                  </tr>
                </thead>
                <tbody>
                  {stageBottlenecks.map((s) => (
                    <tr key={s.status}>
                      <td><strong>{s.label}</strong></td>
                      <td align="right">{s.visitCount} ({s.activeCount} active)</td>
                      <td align="right">{fmtSeconds(s.avgCalendarSeconds)}</td>
                      <td align="right"><strong>{fmtSeconds(s.avgBusinessSeconds)}</strong></td>
                      <td>
                        <PrecisionBadge precision={s.precisions?.[0] || 'provisional_baseline'} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <section className={`m360-panel m360-animate-in m360-delay-1${loading ? ' is-loading' : ''}`}>
        <div className="m360-panel-head">
          <div>
            <h2 className="m360-panel-title">Stuck Tickets (&gt;48h in Active Stage) ({filteredStuck.length})</h2>
            <div className="m360-panel-sub">Click a ticket to jump straight to it</div>
          </div>
          <div className="m360-controls-row">
            <input
              type="search"
              className="m360-search-input"
              style={{ minWidth: 150 }}
              placeholder="Filter key, assignee…"
              value={ticketQuery}
              onChange={(e) => setTicketQuery(e.target.value)}
            />
          </div>
        </div>
        <div className="m360-panel-body">
          <div className="m360-chip-filter" style={{ marginBottom: 12 }}>
            {[
              { id: 'all', label: 'All Stages' },
              { id: 'open', label: 'To Do' },
              { id: 'in_progress', label: 'In Progress' },
              { id: 'resolved', label: 'QA Testing' },
            ].map((st) => (
              <button
                key={st.id}
                type="button"
                className={`m360-chip${stageFilter === st.id ? ' is-active' : ''}`}
                onClick={() => setStageFilter(st.id)}
              >
                {st.label}
              </button>
            ))}
          </div>

          {filteredStuck.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--success)', margin: 0 }}>
              No active tickets matching this filter are stuck beyond 48 calendar hours.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 340, overflowY: 'auto' }}>
              {filteredStuck.slice(0, 20).map((t) => {
                const href = t.projectId
                  ? `/projects/${t.projectId}/list?selectedIssue=${encodeURIComponent(t.key)}`
                  : `/work-items?selectedIssue=${encodeURIComponent(t.key)}`;
                return (
                  <div key={t.ticketId} className="m360-feed-item" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                    <div style={{ minWidth: 0 }}>
                      <Link href={href} className="m360-link" style={{ fontSize: 12.5 }}>
                        {t.key}
                      </Link>{' '}
                      <span style={{ fontSize: 12.5, fontWeight: 500 }}>{t.title}</span>
                      <div style={{ fontSize: 11.5, color: 'var(--text-subtle)', marginTop: 2 }}>
                        {t.projectName} · Assignee: {t.assigneeName} · {STAGE_ORDER_LABELS[t.currentStage] || t.currentStage}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <span className="m360-pill m360-pill-danger">{t.calendarHours}h cal</span>
                      <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 2 }}>
                        {t.businessHours}h bus
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

export function BlockersAndReconciliationPanel({
  recentBlockers = [],
  reconciliationAlerts = [],
  categoryDistribution = [],
  loading = false,
}) {
  const [alertStatus, setAlertStatus] = useState('all');
  const [alertSearch, setAlertSearch] = useState('');
  const [blockerSearch, setBlockerSearch] = useState('');

  const filteredAlerts = useMemo(() => {
    const q = alertSearch.trim().toLowerCase();
    return reconciliationAlerts.filter((r) => {
      if (alertStatus !== 'all' && r.reconciliationStatus !== alertStatus) return false;
      if (q && !`${r.employeeName || ''} ${r.workDate || ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [reconciliationAlerts, alertStatus, alertSearch]);

  const filteredBlockers = useMemo(() => {
    const q = blockerSearch.trim().toLowerCase();
    if (!q) return recentBlockers;
    return recentBlockers.filter((b) =>
      `${b.employeeName || ''} ${b.projectName || ''} ${b.blocker || ''}`.toLowerCase().includes(q)
    );
  }, [recentBlockers, blockerSearch]);

  return (
    <div className="m360-three-col">
      {/* Work Categories */}
      <section className={`m360-panel m360-animate-in${loading ? ' is-loading' : ''}`}>
        <div className="m360-panel-head">
          <div>
            <h2 className="m360-panel-title">Work Category Distribution</h2>
            <div className="m360-panel-sub">Share of canonical effort per category</div>
          </div>
        </div>
        <div className="m360-panel-body">
          {categoryDistribution.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--text-subtle)', margin: 0 }}>No categorized work entries yet.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {categoryDistribution.map((c) => (
                <div key={c.code} style={{ fontSize: 13 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span>{c.label}</span>
                    <span>
                      <strong>{fmtMinutes(c.minutes)}</strong>{' '}
                      <span style={{ color: 'var(--text-subtle)' }}>({c.sharePercent}%)</span>
                    </span>
                  </div>
                  <div className="m360-bar-track">
                    <div
                      className="m360-bar-fill"
                      style={{ width: `${Math.min(100, c.sharePercent)}%`, background: 'var(--primary)' }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Reconciliation Alerts */}
      <section className={`m360-panel m360-animate-in m360-delay-1${loading ? ' is-loading' : ''}`}>
        <div className="m360-panel-head">
          <div>
            <h2 className="m360-panel-title">Attendance vs Task Sheet ({filteredAlerts.length})</h2>
            <div className="m360-panel-sub">IST daily discrepancy alerts</div>
          </div>
          <input
            type="search"
            className="m360-search-input"
            style={{ minWidth: 140 }}
            placeholder="Filter employee…"
            value={alertSearch}
            onChange={(e) => setAlertSearch(e.target.value)}
          />
        </div>
        <div className="m360-panel-body">
          <div className="m360-chip-filter" style={{ marginBottom: 12 }}>
            {[
              { id: 'all', label: 'All' },
              { id: 'missing_task_sheet', label: 'Missing TS' },
              { id: 'large_unaccounted_gap', label: 'Gap' },
              { id: 'logged_without_attendance', label: 'No Attendance' },
            ].map((f) => (
              <button
                key={f.id}
                type="button"
                className={`m360-chip${alertStatus === f.id ? ' is-active' : ''}`}
                onClick={() => setAlertStatus(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>

          {filteredAlerts.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--success)', margin: 0 }}>
              All attendance and Task Sheet logs reconciled for this filter.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 320, overflowY: 'auto' }}>
              {filteredAlerts.slice(0, 20).map((r) => (
                <div key={`${r.employeeId}-${r.workDate}`} className="m360-feed-item">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, fontSize: 12 }}>
                    <Link href={`/monitoring/employees/${r.employeeId}`} className="m360-link">
                      {r.employeeName} · {r.workDate}
                    </Link>
                    <ReconciliationBadge status={r.reconciliationStatus} />
                  </div>
                  <div style={{ color: 'var(--text-subtle)', marginTop: 3, fontSize: 11.5 }}>
                    Attendance: {fmtMinutes(r.attendanceNetMinutes)} · Logged Work: {fmtMinutes(r.totalLoggedMinutes)} · Gap: {fmtMinutes(r.unaccountedGapMinutes)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Blockers */}
      <section className={`m360-panel m360-animate-in m360-delay-2${loading ? ' is-loading' : ''}`}>
        <div className="m360-panel-head">
          <div>
            <h2 className="m360-panel-title">Recent Reported Blockers ({filteredBlockers.length})</h2>
            <div className="m360-panel-sub">Submitted from Daily Task Sheets</div>
          </div>
          <input
            type="search"
            className="m360-search-input"
            style={{ minWidth: 140 }}
            placeholder="Search blockers…"
            value={blockerSearch}
            onChange={(e) => setBlockerSearch(e.target.value)}
          />
        </div>
        <div className="m360-panel-body">
          {filteredBlockers.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--text-subtle)', margin: 0 }}>No matching blockers reported in this window.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 320, overflowY: 'auto' }}>
              {filteredBlockers.slice(0, 20).map((b, i) => (
                <div key={i} className="m360-feed-item">
                  <div style={{ fontSize: 12 }}>
                    <strong>{b.employeeName}</strong> · {b.workDate}
                    {b.projectName ? ` · ${b.projectName}` : ''}
                  </div>
                  <div style={{ color: 'var(--danger)', marginTop: 3, fontSize: 12 }}>{b.blocker}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import AppShell from './AppShell';
import PageHeader from './PageHeader';
import { CalendarReportIcon, ClipboardIcon } from './AppShellIcons';
import { useToasts, Toaster } from './Toaster';

function StatusBadge({ status }) {
  const meta = {
    sent: { label: 'Delivered', bg: '#dcfce7', text: '#15803d' },
    partial_delivery: { label: 'Partial Delivery', bg: '#fef9c3', text: '#854d0e' },
    failed: { label: 'Failed', bg: '#fee2e2', text: '#b91c1c' },
    generated: { label: 'Report Generated', bg: '#e0f2fe', text: '#0369a1' },
    pending: { label: 'Pending', bg: '#f1f5f9', text: '#475467' },
  };

  const current = meta[status] || { label: status || 'Unknown', bg: '#f1f5f9', text: '#475467' };

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '2px 8px',
        borderRadius: '12px',
        fontSize: '11px',
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '.04em',
        background: current.bg,
        color: current.text,
      }}
    >
      {current.label}
    </span>
  );
}

export default function EndOfDayReportView({
  currentUser,
  projects = [],
  projectCounts = {},
  myIssuesCount = 0,
  initialDate,
  initialReport,
  initialHistory = [],
}) {
  const [reportDate, setReportDate] = useState(initialDate);
  const [report, setReport] = useState(initialReport);
  const [history, setHistory] = useState(initialHistory);
  const [activeTab, setActiveTab] = useState('overview'); // 'overview' | 'employees' | 'tickets' | 'history'
  const [expandedEmployees, setExpandedEmployees] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [sendingEmails, setSendingEmails] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState('all');
  const { toasts, push, dismiss, pause, resume } = useToasts();

  const isAdmin = currentUser?.role === 'admin';

  // Load report when date changes
  async function handleDateChange(newDate) {
    setReportDate(newDate);
    setLoading(true);
    try {
      const res = await fetch(`/api/reports/end-of-day?date=${encodeURIComponent(newDate)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch report.');
      setReport(data.report || null);
      if (data.history) setHistory(data.history);
      setExpandedEmployees(new Set());
      setSelectedProjectId('all');
    } catch (err) {
      push({ message: err.message, tone: 'error' });
    } finally {
      setLoading(false);
    }
  }

  // Generate or regenerate report (Admin-only)
  async function handleGenerate({ regenerate = false, sendEmails = false } = {}) {
    if (!isAdmin || loading || sendingEmails) return;
    setLoading(true);
    try {
      const res = await fetch('/api/reports/end-of-day', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reportDate,
          regenerate,
          sendEmails,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate report.');

      setReport(data.report);

      // Refresh history list
      const histRes = await fetch('/api/reports/end-of-day');
      const histData = await histRes.json();
      if (histData.history) setHistory(histData.history);

      if (sendEmails) {
        push({
          message: 'Report generated and emails sent successfully to all recipients.',
          tone: 'success',
        });
      } else {
        push({
          message: `End of Day Report generated successfully (Version ${data.report.version}).`,
          tone: 'success',
        });
      }
    } catch (err) {
      push({ message: err.message || 'Report generation failed.', tone: 'error' });
    } finally {
      setLoading(false);
    }
  }

  // Send emails to team (Admin-only)
  async function handleSendEmails() {
    if (!isAdmin || !report?.id || sendingEmails) return;
    setSendingEmails(true);
    try {
      const res = await fetch('/api/reports/end-of-day/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reportId: report.id,
          retryOnly: false,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Email delivery failed.');

      // Refresh report data
      const refreshRes = await fetch(`/api/reports/end-of-day?date=${encodeURIComponent(reportDate)}`);
      const refreshData = await refreshRes.json();
      if (refreshData.report) setReport(refreshData.report);

      const totalSent = Number(data.totalSent) || 0;
      const totalFailed = Number(data.totalFailed) || 0;

      if (totalFailed > 0 && totalSent > 0) {
        push({
          message: `Emails sent to ${totalSent} recipient${totalSent === 1 ? '' : 's'}; ${totalFailed} failed.`,
          tone: 'error',
        });
      } else if (totalFailed > 0 && totalSent === 0) {
        push({
          message: `Failed to send emails (${totalFailed} failed).`,
          tone: 'error',
        });
      } else if (totalSent > 0) {
        push({
          message: 'Emails sent successfully to all recipients.',
          tone: 'success',
        });
      } else {
        push({
          message: 'No active recipients available for email delivery.',
          tone: 'info',
        });
      }
    } catch (err) {
      push({ message: err.message || 'Failed to send emails.', tone: 'error' });
    } finally {
      setSendingEmails(false);
    }
  }

  function toggleEmployeeExpand(id) {
    setExpandedEmployees((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function expandAll() {
    if (!report?.employees) return;
    setExpandedEmployees(new Set(report.employees.map((e) => e.id)));
  }

  function collapseAll() {
    setExpandedEmployees(new Set());
  }

  const metrics = report?.metrics || {};
  const teamSummary = report?.teamSummary || {};
  const managementSummary = report?.managementSummary || {};
  const projectSummaries = report?.projectSummaries || [];
  const employees = report?.employees || [];
  const highPriorityTickets = report?.highPriorityTickets || [];
  const overdueTickets = report?.overdueTickets || [];

  // Dynamic projects list for the High Priority & Overdue tab filter
  const availableProjects = useMemo(() => {
    const map = new Map();

    // From project prop
    if (Array.isArray(projects)) {
      for (const p of projects) {
        if (p?.id != null && p?.name) {
          map.set(String(p.id), { id: String(p.id), name: String(p.name).trim() });
        }
      }
    }

    // From report project summaries
    if (Array.isArray(projectSummaries)) {
      for (const ps of projectSummaries) {
        if (ps?.projectId != null && ps?.projectName) {
          map.set(String(ps.projectId), { id: String(ps.projectId), name: String(ps.projectName).trim() });
        }
      }
    }

    // From high priority and overdue tickets
    const allTickets = [...highPriorityTickets, ...overdueTickets];
    for (const t of allTickets) {
      if (t?.projectId != null && t?.projectName) {
        map.set(String(t.projectId), { id: String(t.projectId), name: String(t.projectName).trim() });
      } else if (t?.projectName && !map.has(t.projectName)) {
        map.set(t.projectName, { id: t.projectName, name: String(t.projectName).trim() });
      }
    }

    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [projects, projectSummaries, highPriorityTickets, overdueTickets]);

  // Client-side filtered high-priority tickets
  const filteredHighPriorityTickets = useMemo(() => {
    if (selectedProjectId === 'all') return highPriorityTickets;
    return highPriorityTickets.filter(
      (t) =>
        String(t.projectId) === String(selectedProjectId) ||
        String(t.projectName || '').toLowerCase() === String(selectedProjectId).toLowerCase()
    );
  }, [highPriorityTickets, selectedProjectId]);

  // Client-side filtered overdue tickets
  const filteredOverdueTickets = useMemo(() => {
    if (selectedProjectId === 'all') return overdueTickets;
    return overdueTickets.filter(
      (t) =>
        String(t.projectId) === String(selectedProjectId) ||
        String(t.projectName || '').toLowerCase() === String(selectedProjectId).toLowerCase()
    );
  }, [overdueTickets, selectedProjectId]);

  const teamVelocityBullets = useMemo(() => {
    if (Array.isArray(teamSummary.summaryBullets) && teamSummary.summaryBullets.length > 0) {
      return teamSummary.summaryBullets.slice(0, 5);
    }
    const text = teamSummary.summaryText || teamSummary.overview || '';
    if (!text) return ['Team members carried forward active work items across all monitored projects.'];
    const lines = text
      .split(/\r?\n|•/)
      .map((s) => s.replace(/^[\s\-*\d\.]+\s*/, '').trim())
      .filter((s) => s.length > 3);
    return lines.length > 0 ? lines.slice(0, 5) : [text];
  }, [teamSummary]);

  const managementRecommendations = useMemo(() => {
    if (Array.isArray(managementSummary.recommendations) && managementSummary.recommendations.length > 0) {
      return managementSummary.recommendations
        .map((r) => String(r).replace(/^[•\-\*\d\.]+\s*/, '').trim())
        .filter(Boolean);
    }
    return ['Maintain current delivery pace and verify milestone deliverables.'];
  }, [managementSummary]);

  const blockerRiskItems = useMemo(() => {
    if (Array.isArray(managementSummary.blockerRiskBullets) && managementSummary.blockerRiskBullets.length > 0) {
      return managementSummary.blockerRiskBullets
        .map((b) => String(b).replace(/^[•\-\*]+\s*/, '').trim())
        .filter(Boolean);
    }
    const raw = managementSummary.blockerRiskAnalysis || '';
    if (!raw) return ['No active operational blockers or delivery risks reported.'];
    const lines = raw
      .split(/\r?\n|•/)
      .map((s) => s.replace(/^[\s\-*\d\.]+\s*/, '').trim())
      .filter((s) => s.length > 3);
    return lines.length > 0 ? lines : [raw];
  }, [managementSummary]);

  return (
    <AppShell
      currentUser={currentUser}
      projects={projects}
      projectCounts={projectCounts}
      myIssuesCount={myIssuesCount}
      view="end-of-day-report"
      onProjectChange={() => {}}
      onCreate={() => {}}
    >
      <div className="board eod-report-container" style={{ padding: '0 24px 36px', maxWidth: '1440px', margin: '0 auto' }}>
        <PageHeader
          breadcrumb={[
            { label: 'Issues', href: '/' },
            { label: 'Reports', href: '/reports' },
            { label: 'End of Day Report' },
          ]}
          title="End of Day Report"
          icon={<CalendarReportIcon />}
          subtitle="AI-synthesized daily operational review, employee work summaries, and team progress"
          actions={
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <label className="ts-filter-date" style={{ margin: 0 }}>
                <span className="visually-hidden">Report Date</span>
                <input
                  type="date"
                  value={reportDate}
                  aria-label="Report date"
                  disabled={loading || sendingEmails}
                  onChange={(e) => handleDateChange(e.target.value)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '5px',
                    border: '1px solid var(--border-color, #dfe1e6)',
                    background: 'var(--card-bg, #ffffff)',
                    color: 'var(--text-color, #172b4d)',
                    fontSize: '13px',
                  }}
                />
              </label>

              {isAdmin && (
                <>
                  {!report ? (
                    <>
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={loading || sendingEmails || !reportDate}
                        onClick={() => handleGenerate({ sendEmails: true })}
                      >
                        {loading ? 'Generating Report...' : 'Generate Report & Send Emails'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={loading || sendingEmails || !reportDate}
                        onClick={() => handleGenerate({ sendEmails: false })}
                      >
                        Generate Report Only
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={loading || sendingEmails}
                        onClick={handleSendEmails}
                      >
                        {sendingEmails ? 'Sending Emails...' : 'Send Emails to Team'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={loading || sendingEmails}
                        onClick={() => handleGenerate({ regenerate: true, sendEmails: false })}
                      >
                        Regenerate Report
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
          }
        />

        {/* AI Key / Model Configuration Notice */}
        {report && (
          <div
            style={{
              margin: '16px 0 20px',
              padding: '10px 16px',
              borderRadius: '6px',
              border: report.aiModel === 'factual-fallback' ? '1px solid #fed7aa' : '1px solid #bfdbfe',
              background: report.aiModel === 'factual-fallback' ? 'rgba(254, 243, 199, 0.4)' : 'rgba(239, 246, 255, 0.6)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: '13px',
              color: 'var(--text-color, #172b4d)',
            }}
          >
            <div>
              <strong>Model: </strong>
              <code style={{ background: 'var(--subtle-bg, #f1f5f9)', padding: '2px 6px', borderRadius: '4px' }}>
                {report.aiModel}
              </code>
              <span style={{ marginLeft: '10px', color: 'var(--text-subtle, #626f86)' }}>
                {report.aiModel === 'factual-fallback'
                  ? 'Factual deterministic synthesis (AI_API_KEY can be added in .env to enable direct LLM reasoning).'
                  : 'AI-generated executive synthesis grounded in verified database metrics.'}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-subtle, #626f86)' }}>
                Version {report.version} · Generated by {report.generatedByName}
              </span>
              <StatusBadge status={report.status} />
            </div>
          </div>
        )}

        {!report ? (
          <div
            style={{
              padding: '48px 24px',
              textAlign: 'center',
              background: 'var(--card-bg, #ffffff)',
              border: '1px solid var(--border-color, #dfe1e6)',
              borderRadius: '8px',
              marginTop: '16px',
            }}
          >
            <div style={{ display: 'inline-flex', padding: '16px', borderRadius: '50%', background: 'var(--subtle-bg, #f4f5f7)', marginBottom: '16px' }}>
              <CalendarReportIcon size={32} />
            </div>
            <h3 style={{ margin: '0 0 8px', fontSize: '18px', fontWeight: 600, color: 'var(--text-color, #172b4d)' }}>
              No Report Generated for {reportDate}
            </h3>
            <p style={{ margin: '0 auto 20px', maxWidth: '520px', fontSize: '14px', color: 'var(--text-subtle, #626f86)', lineHeight: 1.5 }}>
              {isAdmin
                ? 'Collect Task Sheet submissions, verified ticket completions, overdue tasks, and blockers across all active employees for this date.'
                : 'An administrator has not generated the End of Day Report for this date yet. Please check back later.'}
            </p>
            {isAdmin && (
              <button
                type="button"
                className="btn btn-primary"
                disabled={loading || sendingEmails}
                onClick={() => handleGenerate({ sendEmails: true })}
              >
                {loading ? 'Collecting & Generating...' : 'Generate Report & Send Emails'}
              </button>
            )}
          </div>
        ) : (
          <>
            {/* Top Stat Cards */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: '12px',
                marginBottom: '20px',
              }}
            >
              <div style={{ padding: '14px 16px', background: 'var(--card-bg, #ffffff)', border: '1px solid var(--border-color, #dfe1e6)', borderRadius: '6px' }}>
                <div style={{ fontSize: '12px', color: 'var(--text-subtle, #626f86)', textTransform: 'uppercase', fontWeight: 600 }}>Task Sheets</div>
                <div style={{ fontSize: '22px', fontWeight: 700, margin: '4px 0 2px', color: 'var(--text-color, #172b4d)' }}>
                  {metrics.submittedCount} <span style={{ fontSize: '14px', fontWeight: 400, color: 'var(--text-subtle, #626f86)' }}>/ {metrics.totalEmployees}</span>
                </div>
                <div style={{ fontSize: '12px', color: metrics.missingCount > 0 ? '#b91c1c' : '#15803d' }}>
                  {metrics.missingCount > 0 ? `${metrics.missingCount} missing` : 'All filed'}
                </div>
              </div>

              <div style={{ padding: '14px 16px', background: 'var(--card-bg, #ffffff)', border: '1px solid var(--border-color, #dfe1e6)', borderRadius: '6px' }}>
                <div style={{ fontSize: '12px', color: 'var(--text-subtle, #626f86)', textTransform: 'uppercase', fontWeight: 600 }}>Logged Work</div>
                <div style={{ fontSize: '22px', fontWeight: 700, margin: '4px 0 2px', color: '#0c66e4' }}>
                  {metrics.totalHoursLogged}h
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-subtle, #626f86)' }}>Reported effort</div>
              </div>

              <div style={{ padding: '14px 16px', background: 'var(--card-bg, #ffffff)', border: '1px solid var(--border-color, #dfe1e6)', borderRadius: '6px' }}>
                <div style={{ fontSize: '12px', color: 'var(--text-subtle, #626f86)', textTransform: 'uppercase', fontWeight: 600 }}>Completed Today</div>
                <div style={{ fontSize: '22px', fontWeight: 700, margin: '4px 0 2px', color: '#16a34a' }}>
                  {metrics.totalCompletedToday}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-subtle, #626f86)' }}>Verified completions</div>
              </div>

              <div style={{ padding: '14px 16px', background: 'var(--card-bg, #ffffff)', border: '1px solid var(--border-color, #dfe1e6)', borderRadius: '6px' }}>
                <div style={{ fontSize: '12px', color: 'var(--text-subtle, #626f86)', textTransform: 'uppercase', fontWeight: 600 }}>High Priority</div>
                <div style={{ fontSize: '22px', fontWeight: 700, margin: '4px 0 2px', color: '#ea580c' }}>
                  {metrics.totalHighPriority}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-subtle, #626f86)' }}>Urgent &amp; High tickets</div>
              </div>

              <div style={{ padding: '14px 16px', background: 'var(--card-bg, #ffffff)', border: '1px solid var(--border-color, #dfe1e6)', borderRadius: '6px' }}>
                <div style={{ fontSize: '12px', color: 'var(--text-subtle, #626f86)', textTransform: 'uppercase', fontWeight: 600 }}>Overdue</div>
                <div style={{ fontSize: '22px', fontWeight: 700, margin: '4px 0 2px', color: metrics.totalOverdue > 0 ? '#dc2626' : 'var(--text-color, #172b4d)' }}>
                  {metrics.totalOverdue}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-subtle, #626f86)' }}>Past scheduled due date</div>
              </div>
            </div>

            {/* Navigation Tabs */}
            <div className="tab-bar" role="tablist" style={{ marginBottom: '20px' }}>
              <button
                type="button"
                className={`tab${activeTab === 'overview' ? ' active' : ''}`}
                onClick={() => setActiveTab('overview')}
              >
                Team &amp; Management Overview
              </button>
              <button
                type="button"
                className={`tab${activeTab === 'employees' ? ' active' : ''}`}
                onClick={() => setActiveTab('employees')}
              >
                {isAdmin ? 'Employee Work Summaries' : 'Your Work Summary'}
                <span className="nav-count">{employees.length}</span>
              </button>
              <button
                type="button"
                className={`tab${activeTab === 'tickets' ? ' active' : ''}`}
                onClick={() => setActiveTab('tickets')}
              >
                High Priority &amp; Overdue
                <span className="nav-count">{highPriorityTickets.length + overdueTickets.length}</span>
              </button>
              <button
                type="button"
                className={`tab${activeTab === 'history' ? ' active' : ''}`}
                onClick={() => setActiveTab('history')}
              >
                Report History
                <span className="nav-count">{history.length}</span>
              </button>
            </div>

            {/* Tab 1: Overview (Preserving Original Design & Layout Exactly) */}
            {activeTab === 'overview' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                {/* Team Velocity Overview */}
                <div
                  style={{
                    padding: '20px',
                    background: 'var(--card-bg, #ffffff)',
                    border: '1px solid var(--border-color, #dfe1e6)',
                    borderRadius: '8px',
                  }}
                >
                  <h3 style={{ margin: '0 0 12px', fontSize: '16px', fontWeight: 700, color: 'var(--text-color, #172b4d)' }}>
                    {teamSummary.headline || 'Overall Team Velocity'}
                  </h3>
                  <ul style={{ margin: '0 0 0 18px', padding: 0, fontSize: '14px', lineHeight: 1.6, color: 'var(--text-color, #334155)' }}>
                    {teamVelocityBullets.map((bullet, idx) => (
                      <li key={idx} style={{ marginBottom: '6px' }}>{bullet}</li>
                    ))}
                  </ul>
                </div>

                {/* Management Recommendations */}
                <div
                  style={{
                    padding: '20px',
                    background: 'var(--card-bg, #ffffff)',
                    border: '1px solid var(--border-color, #dfe1e6)',
                    borderRadius: '8px',
                  }}
                >
                  <h3 style={{ margin: '0 0 12px', fontSize: '15px', fontWeight: 700, color: '#9a3412' }}>
                    Management Recommendations &amp; Action Items
                  </h3>
                  <ul style={{ margin: '0 0 0 18px', padding: 0, fontSize: '13px', lineHeight: 1.6, color: 'var(--text-color, #1f2937)' }}>
                    {managementRecommendations.length > 0 ? (
                      managementRecommendations.map((rec, i) => (
                        <li key={i} style={{ marginBottom: '6px' }}>{rec}</li>
                      ))
                    ) : (
                      <li>No immediate recommendations recorded.</li>
                    )}
                  </ul>
                </div>

                {/* Blocker & Risk Analysis */}
                <div
                  style={{
                    padding: '20px',
                    background: 'var(--card-bg, #ffffff)',
                    border: '1px solid var(--border-color, #dfe1e6)',
                    borderRadius: '8px',
                  }}
                >
                  <h3 style={{ margin: '0 0 12px', fontSize: '15px', fontWeight: 700, color: 'var(--text-color, #172b4d)' }}>
                    Blocker &amp; Risk Analysis
                  </h3>
                  {blockerRiskItems.length === 1 && blockerRiskItems[0].toLowerCase().includes('no active') ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#15803d' }}>
                      <span style={{ fontWeight: 600 }}>✓</span>
                      <span>{blockerRiskItems[0]}</span>
                    </div>
                  ) : (
                    <ul style={{ margin: '0 0 0 18px', padding: 0, fontSize: '13px', lineHeight: 1.6, color: 'var(--text-color, #334155)' }}>
                      {blockerRiskItems.map((item, i) => {
                        const isConfirmed = item.startsWith('[Confirmed Blocker]');
                        const isPotential = item.startsWith('[Potential Risk]');
                        const cleanText = item
                          .replace(/^\[(Confirmed Blocker|Potential Risk)\]\s*/, '')
                          .trim();

                        return (
                          <li key={i} style={{ marginBottom: '8px' }}>
                            {isConfirmed ? (
                              <span
                                style={{
                                  display: 'inline-block',
                                  fontSize: '11px',
                                  fontWeight: 700,
                                  padding: '1px 7px',
                                  borderRadius: '4px',
                                  background: '#fee2e2',
                                  color: '#b91c1c',
                                  marginRight: '8px',
                                  verticalAlign: 'middle',
                                }}
                              >
                                Confirmed Blocker
                              </span>
                            ) : isPotential ? (
                              <span
                                style={{
                                  display: 'inline-block',
                                  fontSize: '11px',
                                  fontWeight: 700,
                                  padding: '1px 7px',
                                  borderRadius: '4px',
                                  background: '#fef3c7',
                                  color: '#92400e',
                                  marginRight: '8px',
                                  verticalAlign: 'middle',
                                }}
                              >
                                Potential Risk
                              </span>
                            ) : null}
                            <span>{cleanText || item}</span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>

                {/* Project-Wise Progress */}
                <div
                  style={{
                    padding: '20px',
                    background: 'var(--card-bg, #ffffff)',
                    border: '1px solid var(--border-color, #dfe1e6)',
                    borderRadius: '8px',
                  }}
                >
                  <h3 style={{ margin: '0 0 14px', fontSize: '15px', fontWeight: 700, color: 'var(--text-color, #172b4d)' }}>
                    Project-Wise Progress
                  </h3>
                  {projectSummaries.length === 0 ? (
                    <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-subtle, #626f86)' }}>No project progress recorded for this period.</p>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '14px' }}>
                      {projectSummaries.map((p) => {
                        const overdueCount = p.overdue ?? p.overdueCount ?? 0;
                        const completedCount = p.completedToday ?? p.completedTodayCount ?? 0;
                        const inProgressCount = p.inProgress ?? p.inProgressCount ?? 0;
                        const projectKey = p.projectKey || p.key || '';

                        return (
                          <div
                            key={p.projectId || p.projectName}
                            style={{
                              padding: '14px',
                              border: '1px solid var(--border-color, #e2e8f0)',
                              borderRadius: '6px',
                              background: 'var(--subtle-bg, #f8fafc)',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                              <strong style={{ fontSize: '14px', color: 'var(--text-color, #172b4d)' }}>
                                {p.projectName} {projectKey && <span style={{ fontSize: '12px', color: 'var(--text-subtle, #626f86)' }}>({projectKey})</span>}
                              </strong>
                              <span
                                style={{
                                  fontSize: '11px',
                                  fontWeight: 600,
                                  padding: '2px 6px',
                                  borderRadius: '4px',
                                  background: overdueCount > 0 ? '#fee2e2' : '#dcfce7',
                                  color: overdueCount > 0 ? '#b91c1c' : '#15803d',
                                }}
                              >
                                {p.status || (overdueCount > 0 ? 'At risk' : 'On track')}
                              </span>
                            </div>
                            <p style={{ margin: '0 0 8px', fontSize: '12px', color: 'var(--text-subtle, #626f86)', lineHeight: 1.5 }}>
                              {p.summary || p.progressSummary}
                            </p>
                            <div style={{ fontSize: '12px', display: 'flex', gap: '12px', color: 'var(--text-subtle, #626f86)' }}>
                              <span>Done today: <strong>{completedCount}</strong></span>
                              <span>In progress: <strong>{inProgressCount}</strong></span>
                              <span>Overdue: <strong>{overdueCount}</strong></span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Tab 2: Employee Summaries (or Your Work Summary for non-admins) */}
            {activeTab === 'employees' && (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px', flexWrap: 'wrap', gap: '10px' }}>
                  <span style={{ fontSize: '13px', color: 'var(--text-subtle, #626f86)' }}>
                    {isAdmin
                      ? 'Detailed AI-synthesized work breakdown per active employee'
                      : 'Your personal verified summary, Task Sheet entries, and assigned task progress'}
                  </span>
                  {isAdmin && employees.length > 0 && (
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button type="button" className="btn btn-ghost" onClick={expandAll} style={{ fontSize: '12px' }}>
                        Expand All
                      </button>
                      <button type="button" className="btn btn-ghost" onClick={collapseAll} style={{ fontSize: '12px' }}>
                        Collapse All
                      </button>
                    </div>
                  )}
                </div>

                {employees.length === 0 ? (
                  <div style={{ padding: '32px', textAlign: 'center', background: 'var(--card-bg, #ffffff)', border: '1px solid var(--border-color, #dfe1e6)', borderRadius: '8px' }}>
                    <p style={{ margin: 0, fontSize: '14px', color: 'var(--text-subtle, #626f86)' }}>
                      {isAdmin
                        ? 'No employee work summaries recorded for this date.'
                        : 'No work summary recorded for your account on this date. Make sure your Task Sheet has been filed.'}
                    </p>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {employees.map((emp) => {
                      const isExpanded = !isAdmin || expandedEmployees.has(emp.id);

                      return (
                        <div
                          key={emp.id}
                          style={{
                            background: 'var(--card-bg, #ffffff)',
                            border: '1px solid var(--border-color, #dfe1e6)',
                            borderRadius: '8px',
                            overflow: 'hidden',
                          }}
                        >
                          <div
                            role="button"
                            tabIndex={0}
                            onClick={isAdmin ? () => toggleEmployeeExpand(emp.id) : undefined}
                            onKeyDown={isAdmin ? (e) => { if (e.key === 'Enter' || e.key === ' ') toggleEmployeeExpand(emp.id); } : undefined}
                            style={{
                              padding: '14px 18px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              cursor: isAdmin ? 'pointer' : 'default',
                              background: isExpanded ? 'var(--subtle-bg, #f8fafc)' : 'transparent',
                              userSelect: 'none',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                              <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-color, #172b4d)' }}>
                                {emp.employeeName}
                              </span>
                              <span style={{ fontSize: '12px', color: 'var(--text-subtle, #626f86)' }}>
                                ({emp.employeeEmail || 'No email'})
                              </span>
                              <span
                                style={{
                                  fontSize: '11px',
                                  fontWeight: 600,
                                  padding: '2px 8px',
                                  borderRadius: '12px',
                                  background: emp.taskSheetSubmitted ? '#dcfce7' : '#fee2e2',
                                  color: emp.taskSheetSubmitted ? '#15803d' : '#b91c1c',
                                }}
                              >
                                {emp.taskSheetSubmitted ? `Task Sheet Filed (${emp.hoursWorked}h)` : 'Task Sheet Not Submitted'}
                              </span>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                              <span style={{ fontSize: '12px', color: 'var(--text-subtle, #626f86)' }}>
                                {emp.completedWork?.length ? `${emp.completedWork.length} completed` : '0 completed'}
                              </span>
                              {emp.overdueTicketsCount > 0 && (
                                <span style={{ fontSize: '11px', fontWeight: 600, color: '#b91c1c' }}>
                                  {emp.overdueTicketsCount} overdue
                                </span>
                              )}
                              {isAdmin && (
                                <span style={{ fontSize: '12px', color: 'var(--text-subtle, #626f86)' }}>
                                  {isExpanded ? '▲' : '▼'}
                                </span>
                              )}
                            </div>
                          </div>

                          {isExpanded && (
                            <div style={{ padding: '16px 18px', borderTop: '1px solid var(--border-color, #e2e8f0)', fontSize: '13px' }}>
                              <div style={{ marginBottom: '12px', padding: '10px 12px', borderRadius: '4px', background: 'var(--subtle-bg, #f1f5f9)', borderLeft: '3px solid #0c66e4' }}>
                                <strong style={{ color: '#0c66e4' }}>Overall Progress: </strong>
                                <span style={{ color: 'var(--text-color, #172b4d)' }}>{emp.overallProgress}</span>
                              </div>

                              <p style={{ margin: '6px 0 10px', color: 'var(--text-subtle, #626f86)' }}>
                                <strong>Projects Worked On: </strong>
                                {emp.projectsWorkedOn?.join(', ') || 'Not reported'}
                              </p>

                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px', marginTop: '14px' }}>
                                <div>
                                  <h4 style={{ margin: '0 0 6px', fontSize: '12px', textTransform: 'uppercase', color: 'var(--text-subtle, #626f86)' }}>
                                    Completed Work
                                  </h4>
                                  <ul style={{ margin: 0, paddingLeft: '16px', color: 'var(--text-color, #172b4d)' }}>
                                    {emp.completedWork?.map((w, i) => <li key={i}>{w}</li>) || <li>None reported</li>}
                                  </ul>
                                </div>

                                <div>
                                  <h4 style={{ margin: '0 0 6px', fontSize: '12px', textTransform: 'uppercase', color: 'var(--text-subtle, #626f86)' }}>
                                    In-Progress Work
                                  </h4>
                                  <ul style={{ margin: 0, paddingLeft: '16px', color: 'var(--text-color, #172b4d)' }}>
                                    {emp.inProgressWork?.map((w, i) => <li key={i}>{w}</li>) || <li>None reported</li>}
                                  </ul>
                                </div>
                              </div>

                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px', marginTop: '14px' }}>
                                <div>
                                  <h4 style={{ margin: '0 0 6px', fontSize: '12px', textTransform: 'uppercase', color: '#b91c1c' }}>
                                    Blockers &amp; Challenges
                                  </h4>
                                  <ul style={{ margin: 0, paddingLeft: '16px', color: 'var(--text-color, #172b4d)' }}>
                                    {emp.blockers?.map((b, i) => <li key={i}>{b}</li>) || <li>No blockers reported</li>}
                                  </ul>
                                </div>

                                <div>
                                  <h4 style={{ margin: '0 0 6px', fontSize: '12px', textTransform: 'uppercase', color: '#0369a1' }}>
                                    Next Steps
                                  </h4>
                                  <ul style={{ margin: 0, paddingLeft: '16px', color: 'var(--text-color, #172b4d)' }}>
                                    {emp.nextSteps?.map((s, i) => <li key={i}>{s}</li>) || <li>Proceed with board priorities</li>}
                                  </ul>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Tab 3: High Priority & Overdue with Clean Project Filter */}
            {activeTab === 'tickets' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                {/* Project Filter Toolbar */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: '12px',
                    padding: '12px 16px',
                    background: 'var(--card-bg, #ffffff)',
                    border: '1px solid var(--border-color, #dfe1e6)',
                    borderRadius: '8px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <label htmlFor="eod-project-filter" style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-color, #172b4d)', margin: 0 }}>
                      Filter by Project:
                    </label>
                    <select
                      id="eod-project-filter"
                      value={selectedProjectId}
                      onChange={(e) => setSelectedProjectId(e.target.value)}
                      style={{
                        padding: '6px 12px',
                        borderRadius: '5px',
                        border: '1px solid var(--border-color, #dfe1e6)',
                        background: 'var(--card-bg, #ffffff)',
                        color: 'var(--text-color, #172b4d)',
                        fontSize: '13px',
                        minWidth: '220px',
                        cursor: 'pointer',
                      }}
                    >
                      <option value="all">
                        All Projects ({highPriorityTickets.length + overdueTickets.length} total tickets)
                      </option>
                      {availableProjects.map((proj) => (
                        <option key={proj.id} value={proj.id}>
                          {proj.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  {selectedProjectId !== 'all' && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ padding: '4px 10px', fontSize: '12px' }}
                      onClick={() => setSelectedProjectId('all')}
                    >
                      Reset Filter
                    </button>
                  )}
                </div>

                {/* High Priority Tickets */}
                <div style={{ padding: '20px', background: 'var(--card-bg, #ffffff)', border: '1px solid var(--border-color, #dfe1e6)', borderRadius: '8px' }}>
                  <h3 style={{ margin: '0 0 14px', fontSize: '15px', fontWeight: 700, color: '#ea580c' }}>
                    Active High-Priority Tickets ({filteredHighPriorityTickets.length})
                  </h3>
                  {filteredHighPriorityTickets.length === 0 ? (
                    <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-subtle, #626f86)' }}>
                      {selectedProjectId === 'all'
                        ? 'No critical or urgent tickets currently active.'
                        : 'No active high-priority tickets found for the selected project.'}
                    </p>
                  ) : (
                    <table className="list-table" style={{ width: '100%' }}>
                      <thead>
                        <tr>
                          <th className="list-th">Key</th>
                          <th className="list-th">Title</th>
                          <th className="list-th">Project</th>
                          <th className="list-th">Priority</th>
                          <th className="list-th">Status</th>
                          <th className="list-th">Assignee</th>
                          <th className="list-th">Due Date</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredHighPriorityTickets.map((t) => (
                          <tr key={t.id}>
                            <td className="list-cell"><strong>#{t.key}</strong></td>
                            <td className="list-cell">{t.title}</td>
                            <td className="list-cell">{t.projectName}</td>
                            <td className="list-cell"><span style={{ fontWeight: 600, color: '#ea580c' }}>{t.priority}</span></td>
                            <td className="list-cell">{t.status}</td>
                            <td className="list-cell">{t.employeeName}</td>
                            <td className="list-cell">{t.dueDate}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

                {/* Overdue Tickets */}
                <div style={{ padding: '20px', background: 'var(--card-bg, #ffffff)', border: '1px solid var(--border-color, #dfe1e6)', borderRadius: '8px' }}>
                  <h3 style={{ margin: '0 0 14px', fontSize: '15px', fontWeight: 700, color: '#dc2626' }}>
                    Confirmed Overdue Tickets ({filteredOverdueTickets.length})
                  </h3>
                  {filteredOverdueTickets.length === 0 ? (
                    <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-subtle, #626f86)' }}>
                      {selectedProjectId === 'all'
                        ? 'No overdue tickets for this period.'
                        : 'No overdue tickets found for the selected project.'}
                    </p>
                  ) : (
                    <table className="list-table" style={{ width: '100%' }}>
                      <thead>
                        <tr>
                          <th className="list-th">Key</th>
                          <th className="list-th">Title</th>
                          <th className="list-th">Project</th>
                          <th className="list-th">Assignee</th>
                          <th className="list-th">Due Date</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredOverdueTickets.map((t) => (
                          <tr key={t.id}>
                            <td className="list-cell"><strong>#{t.key}</strong></td>
                            <td className="list-cell">{t.title}</td>
                            <td className="list-cell">{t.projectName}</td>
                            <td className="list-cell">{t.employeeName}</td>
                            <td className="list-cell"><span style={{ color: '#dc2626', fontWeight: 600 }}>{t.dueDate}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            )}

            {/* Tab 4: Report History */}
            {activeTab === 'history' && (
              <div style={{ padding: '20px', background: 'var(--card-bg, #ffffff)', border: '1px solid var(--border-color, #dfe1e6)', borderRadius: '8px' }}>
                <h3 style={{ margin: '0 0 14px', fontSize: '15px', fontWeight: 700, color: 'var(--text-color, #172b4d)' }}>
                  Generated Reports History
                </h3>
                {history.length === 0 ? (
                  <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-subtle, #626f86)' }}>No past reports recorded.</p>
                ) : (
                  <table className="list-table" style={{ width: '100%' }}>
                    <thead>
                      <tr>
                        <th className="list-th">Date</th>
                        <th className="list-th">Version</th>
                        <th className="list-th">Status</th>
                        <th className="list-th">Model</th>
                        <th className="list-th">Generated By</th>
                        <th className="list-th">Created At</th>
                        <th className="list-th">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((h) => (
                        <tr key={h.id}>
                          <td className="list-cell"><strong>{h.report_date}</strong></td>
                          <td className="list-cell">v{h.version}</td>
                          <td className="list-cell"><StatusBadge status={h.status} /></td>
                          <td className="list-cell"><code>{h.ai_model}</code></td>
                          <td className="list-cell">{h.generated_by_name || 'Admin'}</td>
                          <td className="list-cell">{new Date(h.created_at).toLocaleString()}</td>
                          <td className="list-cell">
                            <button
                              type="button"
                              className="btn btn-secondary"
                              style={{ padding: '2px 8px', fontSize: '12px' }}
                              onClick={() => handleDateChange(h.report_date)}
                            >
                              View Report
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <Toaster toasts={toasts} onDismiss={dismiss} onPause={pause} onResume={resume} />
    </AppShell>
  );
}

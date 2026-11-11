'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AppShell from './AppShell';
import PageHeader from './PageHeader';
import KpiCard from './reports/KpiCard';
import { BarChartIcon } from './AppShellIcons';
import {
  fmtMinutes,
  fmtSeconds,
  MonitoringWindowBar,
  PrecisionBadge,
} from './MonitoringPanels';

export default function ProjectMonitoringView({
  initialDetail,
  projects = [],
  currentUser,
}) {
  const router = useRouter();
  const [detail, setDetail] = useState(initialDetail);
  const [preset, setPreset] = useState(initialDetail?.window?.preset || 'this_month');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const project = detail?.project || {};

  async function refreshWindow(nextPreset) {
    setPreset(nextPreset);
    setLoading(true);
    setError('');
    try {
      const res = await fetch(
        `/api/monitoring/projects/${project.id}?preset=${encodeURIComponent(nextPreset)}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load project monitoring.');
      setDetail(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AppShell
      currentUser={currentUser}
      projects={projects}
      activeProjectId={project.id}
      view="project-summary"
      onProjectChange={(id) => router.push(`/projects/${id}/monitoring`)}
      onCreate={() => {}}
    >
      <div className="board">
        <PageHeader
          breadcrumb={[
            { label: 'Projects', href: '/projects' },
            { label: project.name || 'Project', href: `/projects/${project.id}/summary` },
            { label: '360° Monitoring' },
          ]}
          title={`${project.key ? `[${project.key}] ` : ''}${project.name || 'Project'} — 360° Monitoring`}
          icon={<BarChartIcon />}
          subtitle="Canonical employee effort, stage dwell bottlenecks, delayed tickets, and team allocation."
          actions={
            <Link href={`/projects/${project.id}/summary`} className="btn btn-secondary" style={{ fontSize: 13 }}>
              Project Summary
            </Link>
          }
        />

        {error && (
          <div className="ts-banner" role="alert" style={{ marginBottom: 14 }}>
            <strong>Notice:</strong> {error}
          </div>
        )}

        <MonitoringWindowBar
          preset={preset}
          onPresetChange={refreshWindow}
          loading={loading}
          windowRange={detail?.window}
        />

        <div className="m360-kpi-grid">
          <KpiCard
            title="Total Logged Effort"
            value={fmtMinutes(detail?.totals?.totalLoggedMinutes || 0)}
            subtitle={`${detail?.totals?.totalLoggedHours || 0}h logged across team`}
            tone="accent"
          />
          <KpiCard
            title="Tickets Overview"
            value={`${detail?.totals?.openTickets ?? 0} Open`}
            subtitle={`Out of ${detail?.totals?.totalTickets ?? 0} active board tickets`}
          />
          <KpiCard
            title="Delayed / Overdue"
            value={`${detail?.totals?.delayedTicketsCount ?? 0}`}
            subtitle="Past due date and not closed"
            tone={(detail?.totals?.delayedTicketsCount || 0) > 0 ? 'bad' : 'good'}
          />
          <KpiCard
            title="Assigned Members"
            value={`${(detail?.members || []).length}`}
            subtitle="Active project_members"
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, marginBottom: 18 }}>
          <section className="list-frame" style={{ padding: 16 }}>
            <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>Effort by Employee</h2>
            {(detail?.effortByEmployee || []).length === 0 ? (
              <p style={{ fontSize: 13, color: '#5e6c84' }}>No effort logged on this project in this window.</p>
            ) : (
              <table className="list-table" style={{ width: '100%', fontSize: 13 }}>
                <thead>
                  <tr>
                    <th align="left">Employee</th>
                    <th align="right">Logged Work</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.effortByEmployee.map((e) => (
                    <tr key={e.employeeId}>
                      <td>
                        <Link href={`/monitoring/employees/${e.employeeId}`} style={{ fontWeight: 600, color: '#0052cc' }}>
                          {e.employeeName}
                        </Link>
                      </td>
                      <td align="right"><strong>{fmtMinutes(e.minutes)}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="list-frame" style={{ padding: 16 }}>
            <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>Workflow Stage Dwell Breakdown</h2>
            {(detail?.stageBreakdown || []).length === 0 ? (
              <p style={{ fontSize: 13, color: '#5e6c84' }}>No stage transitions tracked yet.</p>
            ) : (
              <table className="list-table" style={{ width: '100%', fontSize: 13 }}>
                <thead>
                  <tr>
                    <th align="left">Stage</th>
                    <th align="right">Visits</th>
                    <th align="right">Avg Cal.</th>
                    <th align="right">Avg Bus.</th>
                    <th align="left">Precision</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.stageBreakdown.map((s) => (
                    <tr key={s.status}>
                      <td><strong>{s.label}</strong></td>
                      <td align="right">{s.visitCount}</td>
                      <td align="right">{fmtSeconds(s.avgCalendarSeconds)}</td>
                      <td align="right">{fmtSeconds(s.avgBusinessSeconds)}</td>
                      <td><PrecisionBadge precision={s.precisions?.[0] || 'provisional_baseline'} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>

        <section className="list-frame" style={{ padding: 16, marginBottom: 18 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>Ticket-Wise Effort & Status</h2>
          {(detail?.ticketEffort || []).length === 0 ? (
            <p style={{ fontSize: 13, color: '#5e6c84' }}>No active tickets on this project.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="list-table" style={{ width: '100%', fontSize: 13 }}>
                <thead>
                  <tr>
                    <th align="left">Key</th>
                    <th align="left">Title</th>
                    <th align="left">Status</th>
                    <th align="left">Assignee</th>
                    <th align="left">Due Date</th>
                    <th align="right">Logged Work</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.ticketEffort.map((t) => (
                    <tr key={t.id}>
                      <td><strong>{t.key}</strong></td>
                      <td>{t.title}</td>
                      <td>{t.status}</td>
                      <td>{t.assigneeName}</td>
                      <td>{t.dueDate || '—'}</td>
                      <td align="right"><strong>{fmtMinutes(t.loggedMinutes)}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {(detail?.blockers || []).length > 0 && (
          <section className="list-frame" style={{ padding: 16 }}>
            <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>Reported Blockers</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {detail.blockers.map((b, i) => (
                <div key={i} style={{ fontSize: 13, borderBottom: '1px solid #ebecf0', paddingBottom: 6 }}>
                  <strong>{b.employeeName}</strong> · {b.workDate} {b.ticketId ? `· Ticket #${b.ticketId}` : ''}
                  <div style={{ color: '#bf2600' }}>{b.blocker}</div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </AppShell>
  );
}

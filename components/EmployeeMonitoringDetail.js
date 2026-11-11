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
  MonitoringWindowBar,
  ReconciliationBadge,
} from './MonitoringPanels';

export default function EmployeeMonitoringDetail({
  initialDetail,
  projects = [],
  currentUser,
}) {
  const router = useRouter();
  const [detail, setDetail] = useState(initialDetail);
  const [preset, setPreset] = useState(initialDetail?.window?.preset || 'this_month');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const emp = detail?.employee || {};

  async function refreshWindow(nextPreset) {
    setPreset(nextPreset);
    setLoading(true);
    setError('');
    try {
      const res = await fetch(
        `/api/monitoring/employees/${emp.id}?preset=${encodeURIComponent(nextPreset)}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load employee monitoring.');
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
      view="employees"
      onProjectChange={(id) => router.push(`/?project=${id}`)}
      onCreate={() => {}}
    >
      <div className="board">
        <PageHeader
          breadcrumb={[
            { label: 'Dashboard', href: '/dashboard' },
            { label: emp.name || 'Employee' },
          ]}
          title={`${emp.name || 'Employee'} — 360° Activity`}
          icon={<BarChartIcon />}
          subtitle={`${emp.title || emp.role || 'Team Member'}${emp.department_name || emp.department ? ` · ${emp.department_name || emp.department}` : ''}${emp.reporting_manager_name ? ` · Reports to ${emp.reporting_manager_name}` : ''}`}
          actions={
            <Link href="/dashboard" className="btn btn-secondary" style={{ fontSize: 13 }}>
              Back to Overview
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
            title="Canonical Logged Work"
            value={fmtMinutes(detail?.effortTotals?.totalLoggedMinutes || 0)}
            subtitle={`${detail?.effortTotals?.totalLoggedHours || 0}h total`}
            tone="accent"
          />
          <KpiCard
            title="Ticket Work"
            value={fmtMinutes(detail?.effortTotals?.ticketWorkMinutes || 0)}
            subtitle="Direct issue effort"
          />
          <KpiCard
            title="Company / Non-Ticket"
            value={fmtMinutes(detail?.effortTotals?.companyActivityMinutes || 0)}
            subtitle="Meetings, training, operations"
          />
          <KpiCard
            title="Attendance Net"
            value={fmtMinutes(detail?.reconciliation?.summary?.totalAttendanceMinutes || 0)}
            subtitle={`Missing TS: ${detail?.reconciliation?.summary?.missingTaskSheetCount || 0} · Gap Days: ${detail?.reconciliation?.summary?.largeGapCount || 0}`}
            tone={(detail?.reconciliation?.summary?.missingTaskSheetCount || 0) > 0 ? 'warn' : undefined}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16, marginBottom: 18 }}>
          <section className="list-frame" style={{ padding: 16 }}>
            <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>Effort by Project</h2>
            {(detail?.byProject || []).length === 0 ? (
              <p style={{ fontSize: 13, color: '#5e6c84' }}>No effort logged in this window.</p>
            ) : (
              <table className="list-table" style={{ width: '100%', fontSize: 13 }}>
                <thead>
                  <tr>
                    <th align="left">Project</th>
                    <th align="right">Logged Work</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.byProject.map((p, idx) => (
                    <tr key={p.projectId ?? `np-${idx}`}>
                      <td>
                        {p.projectId ? (
                          <Link href={`/projects/${p.projectId}/monitoring`} style={{ fontWeight: 600, color: '#0052cc' }}>
                            {p.projectKey ? `[${p.projectKey}] ` : ''}{p.projectName}
                          </Link>
                        ) : (
                          p.projectName
                        )}
                      </td>
                      <td align="right"><strong>{fmtMinutes(p.minutes)}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="list-frame" style={{ padding: 16 }}>
            <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>Effort by Work Category</h2>
            {(detail?.byCategory || []).length === 0 ? (
              <p style={{ fontSize: 13, color: '#5e6c84' }}>No categories logged yet.</p>
            ) : (
              <table className="list-table" style={{ width: '100%', fontSize: 13 }}>
                <thead>
                  <tr>
                    <th align="left">Category</th>
                    <th align="right">Logged Work</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.byCategory.map((c) => (
                    <tr key={c.code}>
                      <td>{c.label}</td>
                      <td align="right"><strong>{fmtMinutes(c.minutes)}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>

        <section className="list-frame" style={{ padding: 16, marginBottom: 18 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>Attendance vs Task Sheet Reconciliation</h2>
          {(detail?.reconciliation?.rows || []).length === 0 ? (
            <p style={{ fontSize: 13, color: '#5e6c84' }}>No attendance or work log rows in this window.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="list-table" style={{ width: '100%', fontSize: 13 }}>
                <thead>
                  <tr>
                    <th align="left">Date (IST)</th>
                    <th align="left">Attendance Status</th>
                    <th align="right">Attendance Net</th>
                    <th align="right">Logged Work</th>
                    <th align="right">Unaccounted Gap</th>
                    <th align="left">Classification</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.reconciliation.rows.map((r) => (
                    <tr key={r.workDate}>
                      <td>{r.workDate}</td>
                      <td>{r.attendanceStatus}</td>
                      <td align="right">{fmtMinutes(r.attendanceNetMinutes)}</td>
                      <td align="right"><strong>{fmtMinutes(r.totalLoggedMinutes)}</strong></td>
                      <td align="right">{fmtMinutes(r.unaccountedGapMinutes)}</td>
                      <td><ReconciliationBadge status={r.reconciliationStatus} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="list-frame" style={{ padding: 16 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>Canonical Work Log Ledger</h2>
          {(detail?.workLogs || []).length === 0 ? (
            <p style={{ fontSize: 13, color: '#5e6c84' }}>No canonical work logs in this window.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="list-table" style={{ width: '100%', fontSize: 13 }}>
                <thead>
                  <tr>
                    <th align="left">Date</th>
                    <th align="left">Entry</th>
                    <th align="left">Project / Ticket</th>
                    <th align="left">Category</th>
                    <th align="left">Description & Blockers</th>
                    <th align="right">Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.workLogs.map((l) => (
                    <tr key={l.id}>
                      <td>{l.work_date}</td>
                      <td>{l.entry_kind}</td>
                      <td>
                        {l.project_name || 'Company'}
                        {l.ticket_id ? ` · #${l.ticket_id}` : ''}
                      </td>
                      <td>{l.category_label || l.category_code}</td>
                      <td>
                        <div>{l.work_description || '—'}</div>
                        {l.blocker_text && (
                          <div style={{ fontSize: 12, color: '#bf2600' }}>Blocker: {l.blocker_text}</div>
                        )}
                      </td>
                      <td align="right">
                        <strong style={{ color: l.duration_minutes < 0 ? '#bf2600' : undefined }}>
                          {fmtMinutes(l.duration_minutes)}
                        </strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}

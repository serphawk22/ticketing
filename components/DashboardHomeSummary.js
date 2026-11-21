'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import TicketText, { TicketRefLink } from './TicketText';
import { buildValidPrefixSet } from '@/lib/ticketRefs';

const HEALTH_META = {
  on_track: { label: 'On Track', cls: 'ai-health-on-track', dotColor: '#00875a' },
  at_risk: { label: 'At Risk', cls: 'ai-health-at-risk', dotColor: '#ff991f' },
  critical: { label: 'Action Needed', cls: 'ai-health-critical', dotColor: '#de350b' },
  completed: { label: 'Completed', cls: 'hms-health-completed', dotColor: '#0052cc' },
};

const SOURCE_LABELS = {
  ticket_relation: 'Blocked Relation',
  ticket_label: 'Blocked Label',
  ticket_status: 'Blocked Status',
  work_log: 'Work Log Blocker',
  task_sheet: 'Task Sheet Blocker',
  daily_note: 'Daily Update',
  task_sheet_other: 'Task Sheet Activity',
  ticket_comment: 'Ticket Comment',
};

const CATEGORY_LABELS = {
  general: 'General Update',
  meeting: 'Internal Meeting',
  client_discussion: 'Client Discussion',
  documentation: 'Documentation',
  research: 'Research & R&D',
  training: 'Training & Learning',
  helping_teammate: 'Helping a Teammate',
  other: 'Other Activity',
  other_activities: 'Other Activity',
  company_activity: 'Company Activity',
};

function formatDateTime(isoOrSql) {
  if (!isoOrSql) return '';
  try {
    const raw = String(isoOrSql).trim();
    const norm = raw.endsWith('Z') || /[+-]\d{2}(:?\d{2})?$/.test(raw)
      ? raw
      : raw.replace(' ', 'T') + 'Z';
    const d = new Date(norm);
    if (Number.isNaN(d.getTime())) return raw;
    return d.toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return String(isoOrSql);
  }
}

export default function DashboardHomeSummary({ projects = [], currentUser }) {
  // Section 1: Project-wise AI Progress Summaries
  const [projData, setProjData] = useState(null);
  const [projLoading, setProjLoading] = useState(true);
  const [projError, setProjError] = useState('');
  const [generatingIds, setGeneratingIds] = useState(() => new Set());
  const [bulkProgress, setBulkProgress] = useState(null); // { current, total, currentName }
  const [expandedProjIds, setExpandedProjIds] = useState(() => new Set());
  const [projActionError, setProjActionError] = useState('');

  // Section 2: Employee-wise Daily Progress
  const [empPreset, setEmpPreset] = useState('today');
  const [empCustomFrom, setEmpCustomFrom] = useState('');
  const [empCustomTo, setEmpCustomTo] = useState('');
  const [showCustomDates, setShowCustomDates] = useState(false);
  const [empData, setEmpData] = useState(null);
  const [empLoading, setEmpLoading] = useState(true);
  const [empError, setEmpError] = useState('');
  const [empSearch, setEmpSearch] = useState('');
  const [onlyWithActivity, setOnlyWithActivity] = useState(false);

  const validPrefixes = useMemo(() => buildValidPrefixSet(projects), [projects]);

  const loadProjectSummaries = useCallback(async () => {
    setProjLoading(true);
    setProjError('');
    try {
      const res = await fetch('/api/ai/progress-summary/projects', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `Failed to load project summaries (${res.status})`);
      }
      setProjData(data);
    } catch (err) {
      setProjError(err.message || 'Failed to load project summaries.');
    } finally {
      setProjLoading(false);
    }
  }, []);

  const loadEmployeeProgress = useCallback(async ({ preset, from, to } = {}) => {
    setEmpLoading(true);
    setEmpError('');
    try {
      const params = new URLSearchParams();
      params.set('preset', preset || 'today');
      if (preset === 'custom' && from && to) {
        params.set('from', from);
        params.set('to', to);
      }
      const res = await fetch(`/api/monitoring/today-progress?${params.toString()}`, {
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `Failed to load employee progress (${res.status})`);
      }
      setEmpData(data);
      if (data?.window?.fromDate) setEmpCustomFrom((prev) => prev || data.window.fromDate);
      if (data?.window?.toDate) setEmpCustomTo((prev) => prev || data.window.toDate);
    } catch (err) {
      setEmpError(err.message || 'Failed to load employee daily progress.');
    } finally {
      setEmpLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProjectSummaries();
    loadEmployeeProgress({ preset: 'today' });
  }, [loadProjectSummaries, loadEmployeeProgress]);

  function toggleExpandProject(projectId) {
    setExpandedProjIds((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  }

  async function handleGenerateSingle(projectId) {
    if (generatingIds.has(projectId)) return;
    setProjActionError('');
    setGeneratingIds((prev) => new Set([...prev, projectId]));
    try {
      const res = await fetch('/api/ai/progress-summary/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Failed to generate AI summary.');
      }
      await loadProjectSummaries();
    } catch (err) {
      setProjActionError(err.message || 'AI summary generation failed.');
    } finally {
      setGeneratingIds((prev) => {
        const next = new Set(prev);
        next.delete(projectId);
        return next;
      });
    }
  }

  async function handleGenerateMissing() {
    if (bulkProgress || !projData?.projects?.length) return;
    const missing = projData.projects.filter((item) => !item.summary && item.canRegenerate);
    if (missing.length === 0) return;

    setProjActionError('');
    for (let i = 0; i < missing.length; i += 1) {
      const item = missing[i];
      const pid = item.project.id;
      setBulkProgress({ current: i + 1, total: missing.length, currentName: item.project.name });
      setGeneratingIds((prev) => new Set([...prev, pid]));
      try {
        const res = await fetch('/api/ai/progress-summary/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: pid }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setProjActionError(
            `${item.project.name}: ${data.error || 'Summary generation failed'}`
          );
        }
      } catch (err) {
        setProjActionError(`${item.project.name}: ${err.message || 'Request failed'}`);
      } finally {
        setGeneratingIds((prev) => {
          const next = new Set(prev);
          next.delete(pid);
          return next;
        });
      }
    }
    setBulkProgress(null);
    await loadProjectSummaries();
  }

  function handleEmpPresetClick(id) {
    setShowCustomDates(false);
    setEmpPreset(id);
    loadEmployeeProgress({ preset: id });
  }

  function handleApplyCustomEmp(e) {
    e.preventDefault();
    if (!empCustomFrom || !empCustomTo || empCustomFrom > empCustomTo) return;
    setEmpPreset('custom');
    loadEmployeeProgress({ preset: 'custom', from: empCustomFrom, to: empCustomTo });
  }

  const filteredEmployees = useMemo(() => {
    const list = empData?.employees || [];
    const q = empSearch.trim().toLowerCase();
    return list.filter((row) => {
      if (onlyWithActivity) {
        const hasAny =
          row.dueTickets.length > 0 ||
          row.completedTickets.length > 0 ||
          row.ticketComments.length > 0 ||
          row.generalActivities.length > 0;
        if (!hasAny) return false;
      }
      if (!q) return true;
      const emp = row.employee || {};
      const haystack = [
        emp.name,
        emp.designation,
        emp.title,
        emp.department,
        ...row.dueTickets.map((t) => `${t.key} ${t.title}`),
        ...row.completedTickets.map((t) => `${t.key} ${t.title}`),
        ...row.ticketComments.map((c) => `${c.ticketKey} ${c.body}`),
        ...row.generalActivities.map((g) => g.body),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [empData, empSearch, onlyWithActivity]);

  const projectItems = projData?.projects || [];
  const canGenerateAny = projectItems.some((p) => p.canRegenerate);
  const missingCount = projData?.missingCount || 0;

  return (
    <div className="hms-stack" data-testid="dashboard-home-summary">
      {/* SECTION 1: PROJECT-WISE AI PROGRESS SUMMARY */}
      <section className="m360-panel" aria-labelledby="hms-projects-heading">
        <div className="m360-panel-head">
          <div>
            <h2 id="hms-projects-heading" className="m360-panel-title">
              Project-wise AI Progress Summary
            </h2>
            <p className="m360-panel-sub">
              Cached executive health, delivery target dates, recorded blockers vs. AI risks across your projects
              {projData ? ` · ${projData.generatedCount} cached, ${missingCount} missing` : ''}
            </p>
          </div>
          <div className="m360-controls-row">
            {canGenerateAny && missingCount > 0 && (
              <button
                type="button"
                className="btn btn-primary"
                style={{ fontSize: 12, padding: '6px 12px' }}
                disabled={!!bulkProgress || projLoading}
                onClick={handleGenerateMissing}
              >
                {bulkProgress
                  ? `Generating ${bulkProgress.current}/${bulkProgress.total} (${bulkProgress.currentName})…`
                  : `Generate Missing (${missingCount})`}
              </button>
            )}
            <button
              type="button"
              className="btn btn-secondary"
              style={{ fontSize: 12, padding: '6px 12px' }}
              disabled={projLoading}
              onClick={loadProjectSummaries}
            >
              {projLoading ? 'Loading…' : 'Reload Cached'}
            </button>
          </div>
        </div>

        <div className="m360-panel-body">
          {(projError || projActionError) && (
            <div className="error-banner" role="alert" style={{ marginBottom: 12 }}>
              <span>{projError || projActionError}</span>
            </div>
          )}

          {projLoading && !projData ? (
            <div className="hms-empty-state">Loading project summaries…</div>
          ) : projectItems.length === 0 ? (
            <div className="hms-empty-state">No active projects found within your scope.</div>
          ) : (
            <div className="hms-project-grid">
              {projectItems.map((item) => {
                const { project, counts, healthStatus, recordedBlockers, aiRisks, summary, isStale, canRegenerate } =
                  item;
                const hm = HEALTH_META[healthStatus] || HEALTH_META.on_track;
                const isExpanded = expandedProjIds.has(project.id);
                const isGen = generatingIds.has(project.id);

                return (
                  <article key={project.id} className="hms-project-card">
                    <div className="hms-project-card-top">
                      <div className="hms-project-identity">
                        <span
                          className="hms-project-key-badge"
                          style={{ borderColor: project.color || '#0c66e4', color: project.color || '#0c66e4' }}
                        >
                          {project.key || `PRJ-${project.id}`}
                        </span>
                        <div>
                          <h3 className="hms-project-name">{project.name}</h3>
                          <div className="hms-target-date">
                            Target Date:{' '}
                            <strong>{project.targetEndDate || 'No target date set'}</strong>
                          </div>
                        </div>
                      </div>

                      <div className="hms-project-badges">
                        <span className={`ai-health-badge ${hm.cls}`}>
                          <span className="ai-health-dot" style={{ background: hm.dotColor }} />
                          {hm.label}
                        </span>
                        {isStale && (
                          <span className="hms-stale-badge" title="Tickets updated after this summary was generated">
                            Stale
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="hms-metrics-strip">
                      <span className="hms-metric-chip">
                        Open: <strong>{counts.open}</strong>
                      </span>
                      <span className={`hms-metric-chip${counts.overdue > 0 ? ' is-danger' : ''}`}>
                        Overdue: <strong>{counts.overdue}</strong>
                      </span>
                      <span className="hms-metric-chip">
                        Done: <strong>{counts.resolved + counts.closed}/{counts.total}</strong> ({counts.completionRate}%)
                      </span>
                    </div>

                    {summary ? (
                      <div className="hms-summary-block">
                        <div className="hms-headline">
                          <TicketText text={summary.headline} validPrefixes={validPrefixes} />
                        </div>

                        {isExpanded && (
                          <div className="hms-expanded-details">
                            <p className="hms-summary-text">
                              <TicketText text={summary.summaryText} validPrefixes={validPrefixes} />
                            </p>
                            {Array.isArray(summary.recommendations) && summary.recommendations.length > 0 && (
                              <div className="hms-recs-box">
                                <div className="hms-sub-label">Recommended Next Actions</div>
                                <ul className="hms-mini-list">
                                  {summary.recommendations.map((rec, idx) => (
                                    <li key={idx}>
                                      <TicketText text={rec} validPrefixes={validPrefixes} />
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="hms-no-summary">
                        No cached AI summary yet. Metrics &amp; recorded blockers below reflect live database state.
                      </div>
                    )}

                    {/* Blockers: strictly separate Recorded Blockers from AI-Inferred Risks */}
                    <div className="hms-blockers-wrap">
                      <div className="hms-blocker-col">
                        <div className="hms-sub-label">
                          Recorded Blockers ({recordedBlockers.length})
                        </div>
                        {recordedBlockers.length === 0 ? (
                          <div className="hms-muted-line">No active recorded blockers.</div>
                        ) : (
                          <ul className="hms-mini-list">
                            {recordedBlockers.slice(0, isExpanded ? 10 : 3).map((b, idx) => (
                              <li key={idx} className="hms-recorded-blocker-item">
                                <span className="hms-source-tag">
                                  {SOURCE_LABELS[b.kind] || b.kind}
                                </span>{' '}
                                {b.ticketKey && (
                                  <>
                                    <TicketRefLink ticketKey={b.ticketKey} className="ai-ticket-link" />{' '}
                                  </>
                                )}
                                <TicketText text={b.text} validPrefixes={validPrefixes} />
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>

                      {aiRisks.length > 0 && (
                        <div className="hms-blocker-col hms-ai-risk-col">
                          <div className="hms-sub-label">AI-Inferred Risks ({aiRisks.length})</div>
                          <ul className="hms-mini-list">
                            {aiRisks.slice(0, isExpanded ? 8 : 2).map((r, idx) => (
                              <li key={idx} className="hms-ai-risk-item">
                                <TicketText text={r} validPrefixes={validPrefixes} />
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>

                    <div className="hms-project-card-foot">
                      <span className="hms-timestamp">
                        {summary?.updatedAt
                          ? `Updated ${formatDateTime(summary.updatedAt)}`
                          : 'Never generated'}
                      </span>
                      <div className="hms-foot-actions">
                        {(summary || recordedBlockers.length > 3) && (
                          <button
                            type="button"
                            className="hms-link-btn"
                            onClick={() => toggleExpandProject(project.id)}
                          >
                            {isExpanded ? 'Show Less' : 'Details'}
                          </button>
                        )}
                        {canRegenerate && (
                          <button
                            type="button"
                            className="btn btn-secondary"
                            style={{ fontSize: 11.5, padding: '4px 10px' }}
                            disabled={isGen || !!bulkProgress}
                            onClick={() => handleGenerateSingle(project.id)}
                          >
                            {isGen ? 'Generating…' : summary ? 'Refresh' : 'Generate'}
                          </button>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* SECTION 2: EMPLOYEE-WISE DAILY PROGRESS & COMMENTS */}
      <section className="m360-panel" aria-labelledby="hms-employees-heading">
        <div className="m360-panel-head">
          <div>
            <h2 id="hms-employees-heading" className="m360-panel-title">
              Employee-wise Daily Progress &amp; Comments
            </h2>
            <p className="m360-panel-sub">
              Due/completed tasks, ticket comments, and general non-ticket updates across all active team members (IST)
            </p>
          </div>

          <div className="m360-controls-row">
            <div className="m360-preset-pills" role="group" aria-label="Daily progress window">
              {[
                { id: 'today', label: 'Today' },
                { id: 'yesterday', label: 'Yesterday' },
                { id: 'this_week', label: 'This Week' },
                { id: 'this_month', label: 'This Month' },
              ].map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`m360-preset-pill${empPreset === p.id && !showCustomDates ? ' is-active' : ''}`}
                  disabled={empLoading}
                  onClick={() => handleEmpPresetClick(p.id)}
                >
                  {p.label}
                </button>
              ))}
              <button
                type="button"
                className={`m360-preset-pill${showCustomDates || empPreset === 'custom' ? ' is-active' : ''}`}
                disabled={empLoading}
                onClick={() => setShowCustomDates((v) => !v)}
              >
                Custom
              </button>
            </div>
          </div>
        </div>

        <div className="m360-panel-body">
          {showCustomDates && (
            <form onSubmit={handleApplyCustomEmp} className="m360-custom-dates" style={{ marginBottom: 12 }}>
              <input
                type="date"
                className="m360-date-input"
                aria-label="Employee progress from date"
                value={empCustomFrom}
                onChange={(e) => setEmpCustomFrom(e.target.value)}
                required
              />
              <span>to</span>
              <input
                type="date"
                className="m360-date-input"
                aria-label="Employee progress to date"
                value={empCustomTo}
                onChange={(e) => setEmpCustomTo(e.target.value)}
                required
              />
              <button
                type="submit"
                className="btn btn-primary"
                style={{ fontSize: 12, padding: '4px 10px', height: 30 }}
                disabled={empLoading || !empCustomFrom || !empCustomTo || empCustomFrom > empCustomTo}
              >
                Apply
              </button>
            </form>
          )}

          <div className="hms-emp-toolbar">
            <div className="hms-emp-summary-pills">
              {empData?.summary && (
                <>
                  <span className="hms-metric-chip">
                    Team: <strong>{empData.summary.totalEmployees}</strong>
                  </span>
                  <span className="hms-metric-chip">
                    Due: <strong>{empData.summary.totalDueCount}</strong>
                  </span>
                  <span className="hms-metric-chip">
                    Completed: <strong>{empData.summary.totalCompletedCount}</strong>
                  </span>
                  <span className="hms-metric-chip">
                    Ticket Comments: <strong>{empData.summary.totalTicketCommentsCount}</strong>
                  </span>
                  <span className="hms-metric-chip">
                    General Updates: <strong>{empData.summary.totalGeneralUpdatesCount}</strong>
                  </span>
                </>
              )}
              {empData?.window && (
                <span className="hms-window-label">
                  IST: {empData.window.fromDate}
                  {empData.window.toDate !== empData.window.fromDate ? ` -> ${empData.window.toDate}` : ''}
                </span>
              )}
            </div>

            <div className="m360-controls-row">
              <input
                type="search"
                className="m360-search-input"
                placeholder="Search employee, ticket, comment…"
                value={empSearch}
                onChange={(e) => setEmpSearch(e.target.value)}
                aria-label="Search employee progress"
              />
              <label className="hms-checkbox-label">
                <input
                  type="checkbox"
                  checked={onlyWithActivity}
                  onChange={(e) => setOnlyWithActivity(e.target.checked)}
                />
                <span>Only with activity</span>
              </label>
            </div>
          </div>

          {empError && (
            <div className="error-banner" role="alert" style={{ marginBottom: 12 }}>
              <span>{empError}</span>
            </div>
          )}

          {empLoading && !empData ? (
            <div className="hms-empty-state">Loading employee daily progress…</div>
          ) : filteredEmployees.length === 0 ? (
            <div className="hms-empty-state">
              No active employees match your current filter within your scope.
            </div>
          ) : (
            <div className="hms-emp-list">
              {filteredEmployees.map((entry) => {
                const {
                  employee,
                  dueTickets,
                  completedTickets,
                  hasNoTicketsDueOrCompleted,
                  emptyTicketNotice,
                  ticketComments,
                  generalActivities,
                  latestActivityAt,
                } = entry;

                const roleSub = [employee.designation || employee.title, employee.department]
                  .filter(Boolean)
                  .join(' · ');

                const feed = [
                  ...ticketComments.map((c) => ({ ...c, _sortMs: c.createdMs || 0 })),
                  ...generalActivities.map((g) => ({ ...g, _sortMs: g.createdMs || 0 })),
                ].sort((a, b) => b._sortMs - a._sortMs);

                return (
                  <article key={employee.id} className="hms-emp-card">
                    <div className="hms-emp-head">
                      <div>
                        <div className="hms-emp-name">{employee.name}</div>
                        <div className="hms-emp-meta">{roleSub || employee.role || 'Team Member'}</div>
                      </div>
                      <div className="hms-emp-head-right">
                        <span className="hms-timestamp">
                          {latestActivityAt
                            ? `Latest activity: ${formatDateTime(latestActivityAt)}`
                            : 'No activity timestamp'}
                        </span>
                      </div>
                    </div>

                    <div className="hms-emp-tickets-row">
                      {hasNoTicketsDueOrCompleted ? (
                        <div className="hms-zero-ticket-notice">
                          {emptyTicketNotice || 'No tasks due or completed today.'}
                        </div>
                      ) : (
                        <>
                          {dueTickets.length > 0 && (
                            <div className="hms-ticket-group">
                              <span className="hms-sub-label">Due ({dueTickets.length}):</span>
                              <div className="hms-ticket-chips">
                                {dueTickets.map((t) => (
                                  <span key={`due-${t.id}`} className="hms-ticket-chip">
                                    <TicketRefLink ticketKey={t.key} className="ai-ticket-link" />
                                    <span className="hms-ticket-chip-title" title={t.title}>
                                      {t.title}
                                    </span>
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}

                          {completedTickets.length > 0 && (
                            <div className="hms-ticket-group">
                              <span className="hms-sub-label is-done">
                                Completed ({completedTickets.length}):
                              </span>
                              <div className="hms-ticket-chips">
                                {completedTickets.map((t) => (
                                  <span key={`done-${t.id}`} className="hms-ticket-chip is-done">
                                    <TicketRefLink ticketKey={t.key} className="ai-ticket-link" />
                                    <span className="hms-ticket-chip-title" title={t.title}>
                                      {t.title}
                                    </span>
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </div>

                    <div className="hms-emp-feed">
                      {feed.length === 0 ? (
                        <div className="hms-muted-line">
                          No ticket comments or general updates logged in this window.
                        </div>
                      ) : (
                        feed.map((item) => (
                          <div key={item.id} className="hms-feed-item">
                            <div className="hms-feed-badges">
                              <span
                                className={`hms-kind-badge ${
                                  item.isTicketRelated ? 'is-ticket' : 'is-general'
                                }`}
                              >
                                {item.isTicketRelated ? 'Ticket-related' : 'General / Non-ticket'}
                              </span>
                              {item.ticketKey && (
                                <TicketRefLink ticketKey={item.ticketKey} className="ai-ticket-link" />
                              )}
                              {!item.isTicketRelated && item.category && (
                                <span className="hms-source-tag">
                                  {CATEGORY_LABELS[item.category] || item.category}
                                </span>
                              )}
                              {item.durationMinutes ? (
                                <span className="hms-source-tag">{item.durationMinutes}m</span>
                              ) : null}
                              <span className="hms-feed-time">{formatDateTime(item.createdAt)}</span>
                            </div>
                            <div className="hms-feed-body">
                              <TicketText text={item.body} validPrefixes={validPrefixes} />
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

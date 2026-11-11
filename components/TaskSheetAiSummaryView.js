'use client';

import { useState, useEffect, useCallback, useTransition } from 'react';
import { indiaToday } from '@/lib/indiaDate';

function SparklesIcon({ size = 16, className = '' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 2L14.4 7.6L20 10L14.4 12.4L12 18L9.6 12.4L4 10L9.6 7.6L12 2Z" />
      <path d="M5 2L6 4.5L8.5 5.5L6 6.5L5 9L4 6.5L1.5 5.5L4 4.5L5 2Z" opacity="0.75" />
    </svg>
  );
}

function RefreshIcon({ size = 14, spinning = false }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={spinning ? { animation: 'ai-spin 1s linear infinite' } : {}}
      aria-hidden="true"
    >
      <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-1.19" />
    </svg>
  );
}

function AlertIcon({ size = 14, color = '#de350b' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

function CheckIcon({ size = 14, color = '#00875a' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke={color}
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

function LightbulbIcon({ size = 16, color = '#0052cc' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-7 7c0 2.5 1.5 4.5 3 6h8c1.5-1.5 3-3.5 3-6a7 7 0 0 0-7-7z" />
    </svg>
  );
}

const HEALTH_META = {
  high_momentum: {
    label: 'High Momentum',
    badgeClass: 'ai-health-on-track',
    dotColor: '#00875a',
    description: 'Output is outpacing baseline with healthy completion and low blockers.',
  },
  steady: {
    label: 'Steady',
    badgeClass: 'ai-health-completed',
    dotColor: '#0052cc',
    description: 'Work is tracking steadily along historical baseline trends.',
  },
  at_risk: {
    label: 'At Risk',
    badgeClass: 'ai-health-at-risk',
    dotColor: '#ff991f',
    description: 'Submissions or hours have dropped, or blockers need intervention.',
  },
  critical: {
    label: 'Action Needed',
    badgeClass: 'ai-health-critical',
    dotColor: '#de350b',
    description: 'Severe blockers or low submission rates are stalling delivery.',
  },
};

const STATUS_PILL_STYLES = {
  'High Velocity': { bg: '#e3fcef', color: '#006644', border: '#abf5d1' },
  Steady: { bg: '#deebff', color: '#0747a6', border: '#b3d4ff' },
  'Blocked / Needs Support': { bg: '#ffebe6', color: '#bf2600', border: '#ffbdad' },
  'Under-reported / Incomplete': { bg: '#fffae6', color: '#b35c00', border: '#ffe380' },
  'Pending Submission': { bg: 'var(--bg-subtle, #f4f5f7)', color: 'var(--text-muted, #6b778c)', border: 'var(--border, #dfe1e6)' },
};

export default function TaskSheetAiSummaryView({ currentUser }) {
  const [selectedDate, setSelectedDate] = useState(indiaToday);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [memberSearch, setMemberSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [, startTransition] = useTransition();

  const fetchSummary = useCallback(async (date) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/task-sheet/ai-summary?date=${encodeURIComponent(date)}`);
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Failed to load AI Team Pulse.');
      }
      setData(json);
    } catch (err) {
      setError(err.message || 'Could not load AI summary.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSummary(selectedDate);
  }, [selectedDate, fetchSummary]);

  const handleGenerate = async () => {
    if (generating) return;
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch('/api/task-sheet/ai-summary/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: selectedDate }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Failed to generate AI Team Pulse.');
      }
      // Refresh view with new data
      await fetchSummary(selectedDate);
    } catch (err) {
      setError(err.message || 'Generation failed.');
    } finally {
      setGenerating(false);
    }
  };

  const metrics = data?.metrics || {};
  const teamSummary = metrics.teamSummary || {};
  const summary = data?.summary;
  const comparisonDays = data?.comparisonDays || [];
  const healthInfo = HEALTH_META[summary?.healthStatus] || HEALTH_META.steady;

  // Filter members
  const memberList = summary?.memberInsights?.length
    ? summary.memberInsights
    : (metrics.memberMatrix || []);

  const filteredMembers = memberList.filter((m) => {
    const matchesSearch =
      !memberSearch ||
      m.name.toLowerCase().includes(memberSearch.toLowerCase()) ||
      (m.department && m.department.toLowerCase().includes(memberSearch.toLowerCase())) ||
      (m.title && m.title.toLowerCase().includes(memberSearch.toLowerCase()));
    const matchesStatus =
      statusFilter === 'all' || m.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const projectShifts = summary?.projectShifts?.length
    ? summary.projectShifts
    : (metrics.projectDistribution || []).map((p) => ({
        project: p.project,
        todayHours: p.todayHours,
        histDailyAvgHours: p.histDailyAvgHours,
        deltaPct: p.deltaPct,
        status: p.status,
        observation: `${p.todayHours}h logged today (${p.deltaPct >= 0 ? '+' : ''}${p.deltaPct}% vs avg).`,
      }));

  const blockerAnalysis = summary?.blockerAnalysis || {
    critical: (metrics.todayBlockers || []).slice(0, 3).map((b) => `${b.employeeName} (${b.project}): ${b.blocker}`),
    recurring: (metrics.recurringBlockers || []).slice(0, 3).map((b) => `${b.employeeName}: ${b.blocker}`),
    affectedEmployees: Array.from(new Set((metrics.todayBlockers || []).map((b) => b.employeeName))),
  };

  const recommendations = summary?.recommendations || [];

  return (
    <div className="ai-pulse-container" style={{ padding: '0 0 32px 0' }}>
      {/* Top Filter and Action Bar */}
      <div
        className="ts-filters"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          marginBottom: '16px',
          padding: '12px 16px',
          background: 'var(--bg-surface, #fff)',
          borderRadius: '8px',
          border: '1px solid var(--border, #dfe1e6)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600, fontSize: '13px' }}>
            <span>Anchor Date:</span>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => {
                const val = e.target.value;
                if (val) {
                  startTransition(() => {
                    setSelectedDate(val);
                  });
                }
              }}
              style={{
                padding: '6px 10px',
                borderRadius: '6px',
                border: '1px solid var(--border, #dfe1e6)',
                fontSize: '13px',
                background: 'var(--bg-input, #fff)',
                color: 'var(--text)',
              }}
            />
          </label>

          {comparisonDays.length > 0 && (
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '12px',
                color: 'var(--text-muted, #6b778c)',
                background: 'var(--bg-subtle, #f4f5f7)',
                padding: '4px 10px',
                borderRadius: '6px',
              }}
            >
              <span>vs 3 Working Days:</span>
              <strong style={{ color: 'var(--text)' }}>
                {comparisonDays.map((d) => d.dayOfWeek + ' ' + d.date.slice(5)).join(', ')}
              </strong>
              <span style={{ fontSize: '11px', opacity: 0.8 }}>(Sundays & holidays excluded)</span>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {summary?.updatedAt && (
            <span style={{ fontSize: '11px', color: 'var(--text-muted, #6b778c)' }}>
              Analyzed {new Date(summary.updatedAt).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })} ({summary.modelName})
            </span>
          )}

          <button
            type="button"
            className="btn btn-primary"
            onClick={handleGenerate}
            disabled={generating || loading}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '7px',
              fontWeight: 600,
              fontSize: '13px',
              padding: '6px 14px',
            }}
          >
            {generating ? (
              <>
                <RefreshIcon spinning={true} />
                <span>Analyzing Team Work...</span>
              </>
            ) : summary ? (
              <>
                <RefreshIcon />
                <span>Regenerate AI Analysis</span>
              </>
            ) : (
              <>
                <SparklesIcon />
                <span>Generate AI Analysis</span>
              </>
            )}
          </button>
        </div>
      </div>

      {error && (
        <div
          className="ai-summary-error"
          style={{
            marginBottom: '16px',
            padding: '12px 16px',
            borderRadius: '6px',
            background: '#ffebe6',
            color: '#bf2600',
            border: '1px solid #ffbdad',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertIcon size={16} />
            <span>{error}</span>
          </div>
          <button
            type="button"
            className="btn-link"
            style={{ color: '#bf2600', fontWeight: 600, fontSize: '12px', background: 'none', border: 'none', cursor: 'pointer' }}
            onClick={() => fetchSummary(selectedDate)}
          >
            Retry
          </button>
        </div>
      )}

      {/* 4 Top KPI Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '14px',
          marginBottom: '20px',
        }}
      >
        {/* Participation Card */}
        <div
          style={{
            background: 'var(--bg-surface, #fff)',
            borderRadius: '8px',
            border: '1px solid var(--border, #dfe1e6)',
            padding: '16px 18px',
            boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
          }}
        >
          <div style={{ fontSize: '12px', color: 'var(--text-muted, #6b778c)', fontWeight: 600, marginBottom: '6px' }}>
            TEAM PARTICIPATION
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
            <span style={{ fontSize: '26px', fontWeight: 700, color: 'var(--text)' }}>
              {teamSummary.todayActiveCount ?? 0}
              <span style={{ fontSize: '16px', color: 'var(--text-muted, #6b778c)', fontWeight: 500 }}>
                /{metrics.teamSize || 0}
              </span>
            </span>
            <span
              style={{
                fontSize: '12px',
                fontWeight: 600,
                padding: '2px 6px',
                borderRadius: '4px',
                background: (teamSummary.submissionRate || 0) >= 75 ? '#e3fcef' : '#fff0b3',
                color: (teamSummary.submissionRate || 0) >= 75 ? '#006644' : '#8f4f00',
              }}
            >
              {teamSummary.submissionRate || 0}%
            </span>
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted, #6b778c)', marginTop: '6px' }}>
            vs {teamSummary.histAvgSubmitters || 0} avg daily submitters
          </div>
        </div>

        {/* Total Hours Card */}
        <div
          style={{
            background: 'var(--bg-surface, #fff)',
            borderRadius: '8px',
            border: '1px solid var(--border, #dfe1e6)',
            padding: '16px 18px',
            boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
          }}
        >
          <div style={{ fontSize: '12px', color: 'var(--text-muted, #6b778c)', fontWeight: 600, marginBottom: '6px' }}>
            TOTAL HOURS LOGGED
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
            <span style={{ fontSize: '26px', fontWeight: 700, color: 'var(--text)' }}>
              {teamSummary.todayTotalHours || 0}
              <span style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-muted, #6b778c)' }}> hrs</span>
            </span>
            {teamSummary.hoursDeltaPct !== undefined && (
              <span
                style={{
                  fontSize: '12px',
                  fontWeight: 600,
                  padding: '2px 6px',
                  borderRadius: '4px',
                  background: teamSummary.hoursDeltaPct >= 0 ? '#e3fcef' : '#ffebe6',
                  color: teamSummary.hoursDeltaPct >= 0 ? '#006644' : '#bf2600',
                }}
              >
                {teamSummary.hoursDeltaPct >= 0 ? `+${teamSummary.hoursDeltaPct}%` : `${teamSummary.hoursDeltaPct}%`}
              </span>
            )}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted, #6b778c)', marginTop: '6px' }}>
            vs {teamSummary.histDailyAvgHours || 0} hrs 3-day daily avg
          </div>
        </div>

        {/* Completion Rate Card */}
        <div
          style={{
            background: 'var(--bg-surface, #fff)',
            borderRadius: '8px',
            border: '1px solid var(--border, #dfe1e6)',
            padding: '16px 18px',
            boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
          }}
        >
          <div style={{ fontSize: '12px', color: 'var(--text-muted, #6b778c)', fontWeight: 600, marginBottom: '6px' }}>
            TASK COMPLETION RATE
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
            <span style={{ fontSize: '26px', fontWeight: 700, color: 'var(--text)' }}>
              {teamSummary.todayCompletionRate || 0}%
            </span>
            <span
              style={{
                fontSize: '12px',
                fontWeight: 600,
                padding: '2px 6px',
                borderRadius: '4px',
                background: (teamSummary.todayCompletionRate || 0) >= (teamSummary.histCompletionRate || 0) ? '#e3fcef' : '#fff0b3',
                color: (teamSummary.todayCompletionRate || 0) >= (teamSummary.histCompletionRate || 0) ? '#006644' : '#8f4f00',
              }}
            >
              {teamSummary.todayCompletedTasks || 0} completed
            </span>
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted, #6b778c)', marginTop: '6px' }}>
            {teamSummary.todayOpenTasks || 0} in progress · 3-day avg: {teamSummary.histCompletionRate || 0}%
          </div>
        </div>

        {/* Active Blockers Card */}
        <div
          style={{
            background: 'var(--bg-surface, #fff)',
            borderRadius: '8px',
            border: '1px solid var(--border, #dfe1e6)',
            padding: '16px 18px',
            boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
          }}
        >
          <div style={{ fontSize: '12px', color: 'var(--text-muted, #6b778c)', fontWeight: 600, marginBottom: '6px' }}>
            ACTIVE BLOCKERS
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
            <span
              style={{
                fontSize: '26px',
                fontWeight: 700,
                color: (teamSummary.activeBlockersCount || 0) > 0 ? '#de350b' : '#00875a',
              }}
            >
              {teamSummary.activeBlockersCount || 0}
            </span>
            {(teamSummary.recurringBlockersCount || 0) > 0 && (
              <span
                style={{
                  fontSize: '12px',
                  fontWeight: 600,
                  padding: '2px 6px',
                  borderRadius: '4px',
                  background: '#ffebe6',
                  color: '#bf2600',
                }}
              >
                {teamSummary.recurringBlockersCount} recurring
              </span>
            )}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted, #6b778c)', marginTop: '6px' }}>
            {(teamSummary.activeBlockersCount || 0) === 0 ? 'No active blockers reported today' : 'Requires management review'}
          </div>
        </div>
      </div>

      {/* AI Executive Verdict Banner */}
      <div
        style={{
          background: 'var(--bg-surface, #fff)',
          borderRadius: '8px',
          border: '1px solid var(--border, #dfe1e6)',
          padding: '20px 22px',
          marginBottom: '20px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px', marginBottom: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <SparklesIcon size={18} />
            <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: 'var(--text)' }}>
              AI Executive Team Verdict
            </h2>
          </div>

          {summary && (
            <span className={`ai-health-badge ${healthInfo.badgeClass}`}>
              <span className="ai-health-dot" style={{ background: healthInfo.dotColor }} />
              {healthInfo.label}
            </span>
          )}
        </div>

        {summary ? (
          <div>
            <div
              style={{
                fontSize: '15px',
                fontWeight: 600,
                color: 'var(--text)',
                marginBottom: '10px',
                lineHeight: 1.4,
              }}
            >
              "{summary.headline}"
            </div>
            <div
              style={{
                fontSize: '13px',
                lineHeight: 1.6,
                color: 'var(--text-secondary, #333)',
                whiteSpace: 'pre-line',
              }}
            >
              {summary.executiveSummary}
            </div>
          </div>
        ) : (
          <div
            style={{
              padding: '16px',
              borderRadius: '6px',
              background: 'var(--bg-subtle, #f4f5f7)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '12px',
            }}
          >
            <div>
              <div style={{ fontWeight: 600, fontSize: '14px', marginBottom: '4px' }}>
                AI Team Pulse is ready to be generated for {data?.targetDateFormatted || selectedDate}.
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted, #6b778c)' }}>
                Comparing against verified submissions from {comparisonDays.map((d) => d.dayOfWeek + ' ' + d.date.slice(5)).join(', ')}.
              </div>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleGenerate}
              disabled={generating}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              <SparklesIcon />
              <span>{generating ? 'Analyzing...' : 'Generate Analysis Now'}</span>
            </button>
          </div>
        )}
      </div>

      {/* Team Member-Wise Pulse Table */}
      <div
        style={{
          background: 'var(--bg-surface, #fff)',
          borderRadius: '8px',
          border: '1px solid var(--border, #dfe1e6)',
          padding: '18px 20px',
          marginBottom: '20px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', marginBottom: '14px' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: 'var(--text)' }}>
              Individual Employee Pulse (Today vs 3-Day Baseline)
            </h3>
            <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: 'var(--text-muted, #6b778c)' }}>
              Detailed tracking of logged hours, task throughput, blockers, and AI observations.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <input
              type="text"
              placeholder="Search team member..."
              value={memberSearch}
              onChange={(e) => setMemberSearch(e.target.value)}
              style={{
                padding: '5px 10px',
                fontSize: '12px',
                borderRadius: '6px',
                border: '1px solid var(--border, #dfe1e6)',
                width: '180px',
                background: 'var(--bg-input, #fff)',
                color: 'var(--text)',
              }}
            />

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              style={{
                padding: '5px 10px',
                fontSize: '12px',
                borderRadius: '6px',
                border: '1px solid var(--border, #dfe1e6)',
                background: 'var(--bg-input, #fff)',
                color: 'var(--text)',
              }}
            >
              <option value="all">All Statuses ({memberList.length})</option>
              <option value="Blocked / Needs Support">Blocked / Needs Support</option>
              <option value="High Velocity">High Velocity</option>
              <option value="Steady">Steady</option>
              <option value="Under-reported / Incomplete">Under-reported / Incomplete</option>
              <option value="Pending Submission">Pending Submission</option>
            </select>
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="ts-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--border, #dfe1e6)', textAlign: 'left', color: 'var(--text-muted, #6b778c)', fontSize: '12px' }}>
                <th style={{ padding: '8px 10px' }}>EMPLOYEE</th>
                <th style={{ padding: '8px 10px' }}>TODAY'S WORK</th>
                <th style={{ padding: '8px 10px' }}>3-DAY BASELINE</th>
                <th style={{ padding: '8px 10px' }}>STATUS</th>
                <th style={{ padding: '8px 10px', minWidth: '240px' }}>AI OBSERVATION</th>
              </tr>
            </thead>
            <tbody>
              {filteredMembers.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted, #6b778c)' }}>
                    No team members match the current filters.
                  </td>
                </tr>
              ) : (
                filteredMembers.map((emp) => {
                  const pillStyle = STATUS_PILL_STYLES[emp.status] || STATUS_PILL_STYLES.Steady;
                  return (
                    <tr
                      key={emp.name}
                      style={{
                        borderBottom: '1px solid var(--border, #f0f1f4)',
                        transition: 'background 0.1s ease',
                      }}
                    >
                      {/* Name & Title */}
                      <td style={{ padding: '10px 10px', verticalAlign: 'top' }}>
                        <div style={{ fontWeight: 600, color: 'var(--text)' }}>{emp.name}</div>
                        {(emp.title || emp.department) && (
                          <div style={{ fontSize: '11px', color: 'var(--text-muted, #6b778c)' }}>
                            {[emp.title, emp.department].filter(Boolean).join(' · ')}
                          </div>
                        )}
                      </td>

                      {/* Today's Work */}
                      <td style={{ padding: '10px 10px', verticalAlign: 'top' }}>
                        {emp.hasSubmitted ? (
                          <div>
                            <div>
                              <strong style={{ color: 'var(--text)' }}>{emp.todayHours}h</strong> logged
                            </div>
                            <div style={{ fontSize: '11px', color: 'var(--text-muted, #6b778c)' }}>
                              {emp.todayCompletedTasks} done · {emp.todayOpenTasks} open
                            </div>
                            {emp.todayBlockers?.length > 0 && (
                              <div
                                style={{
                                  marginTop: '4px',
                                  fontSize: '11px',
                                  color: '#bf2600',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                }}
                              >
                                <AlertIcon size={12} />
                                <span title={emp.todayBlockers.join('; ')}>
                                  {emp.todayBlockers[0].slice(0, 35)}
                                  {emp.todayBlockers[0].length > 35 ? '...' : ''}
                                </span>
                              </div>
                            )}
                          </div>
                        ) : (
                          <span style={{ fontSize: '12px', color: 'var(--text-muted, #6b778c)', fontStyle: 'italic' }}>
                            No submission yet
                          </span>
                        )}
                      </td>

                      {/* 3-Day Baseline */}
                      <td style={{ padding: '10px 10px', verticalAlign: 'top' }}>
                        <div>
                          <strong style={{ color: 'var(--text)' }}>{emp.histDailyAvgHours}h</strong> / day
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted, #6b778c)' }}>
                          {emp.histDailyAvgCompleted} tasks/day
                        </div>
                      </td>

                      {/* Status */}
                      <td style={{ padding: '10px 10px', verticalAlign: 'top' }}>
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '3px 8px',
                            borderRadius: '12px',
                            fontSize: '11px',
                            fontWeight: 600,
                            background: pillStyle.bg,
                            color: pillStyle.color,
                            border: `1px solid ${pillStyle.border}`,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {emp.status}
                        </span>
                      </td>

                      {/* AI Observation */}
                      <td style={{ padding: '10px 10px', verticalAlign: 'top', color: 'var(--text-secondary, #444)', fontSize: '12px', lineHeight: 1.4 }}>
                        {emp.observation || (
                          emp.hasSubmitted
                            ? `Logged ${emp.todayHours}h with ${emp.todayCompletedTasks} tasks finished.`
                            : 'Pending submission for today.'
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Two-Column Grid: Project Redistribution & Blocker Radar */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: '20px',
        }}
      >
        {/* Project Effort Redistribution */}
        <div
          style={{
            background: 'var(--bg-surface, #fff)',
            borderRadius: '8px',
            border: '1px solid var(--border, #dfe1e6)',
            padding: '18px 20px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
          }}
        >
          <h3 style={{ margin: '0 0 4px 0', fontSize: '15px', fontWeight: 700, color: 'var(--text)' }}>
            Project Effort Redistribution
          </h3>
          <p style={{ margin: '0 0 14px 0', fontSize: '12px', color: 'var(--text-muted, #6b778c)' }}>
            Comparing today's project allocation against the 3-day daily average.
          </p>

          {projectShifts.length === 0 ? (
            <div style={{ padding: '16px', color: 'var(--text-muted, #6b778c)', textAlign: 'center', fontSize: '12px' }}>
              No project activity recorded for the selected comparison period.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {projectShifts.map((p) => {
                const isIncreased = p.deltaPct > 0;
                const isNeglected = p.status === 'neglected';
                return (
                  <div
                    key={p.project}
                    style={{
                      padding: '10px 12px',
                      borderRadius: '6px',
                      background: 'var(--bg-subtle, #f8f9fa)',
                      border: '1px solid var(--border, #eaecf0)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                      <strong style={{ fontSize: '13px', color: 'var(--text)' }}>{p.project}</strong>
                      <span
                        style={{
                          fontSize: '11px',
                          fontWeight: 600,
                          padding: '2px 6px',
                          borderRadius: '4px',
                          background: isNeglected
                            ? '#ffebe6'
                            : isIncreased
                            ? '#e3fcef'
                            : '#fff0b3',
                          color: isNeglected
                            ? '#bf2600'
                            : isIncreased
                            ? '#006644'
                            : '#8f4f00',
                        }}
                      >
                        {isNeglected ? 'Neglected Today' : `${p.deltaPct >= 0 ? '+' : ''}${p.deltaPct}%`}
                      </span>
                    </div>

                    <div style={{ fontSize: '12px', color: 'var(--text-muted, #6b778c)', marginBottom: '4px' }}>
                      Today: <strong style={{ color: 'var(--text)' }}>{p.todayHours}h</strong> · 3-day avg: {p.histDailyAvgHours}h
                    </div>

                    {p.observation && (
                      <div style={{ fontSize: '11px', color: 'var(--text-secondary, #555)', fontStyle: 'italic' }}>
                        {p.observation}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Blocker Radar & Management Recommendations */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Blockers Card */}
          <div
            style={{
              background: 'var(--bg-surface, #fff)',
              borderRadius: '8px',
              border: '1px solid var(--border, #dfe1e6)',
              padding: '18px 20px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
              <AlertIcon size={16} color="#de350b" />
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: 'var(--text)' }}>
                Blocker Radar & Risk Items
              </h3>
            </div>
            <p style={{ margin: '0 0 12px 0', fontSize: '12px', color: 'var(--text-muted, #6b778c)' }}>
              Reported today and recurring roadblocks across the team.
            </p>

            {blockerAnalysis.critical?.length === 0 && blockerAnalysis.recurring?.length === 0 ? (
              <div
                style={{
                  padding: '12px',
                  borderRadius: '6px',
                  background: '#e3fcef',
                  color: '#006644',
                  fontSize: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <CheckIcon size={14} color="#006644" />
                <span>No active or recurring blockers reported today.</span>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {blockerAnalysis.recurring?.map((item, idx) => (
                  <div
                    key={`rec-${idx}`}
                    style={{
                      padding: '8px 10px',
                      borderRadius: '6px',
                      background: '#ffebe6',
                      border: '1px solid #ffbdad',
                      fontSize: '12px',
                      color: '#bf2600',
                    }}
                  >
                    <strong>[Recurring]</strong> {item}
                  </div>
                ))}

                {blockerAnalysis.critical?.map((item, idx) => (
                  <div
                    key={`crit-${idx}`}
                    style={{
                      padding: '8px 10px',
                      borderRadius: '6px',
                      background: '#fff0b3',
                      border: '1px solid #ffe380',
                      fontSize: '12px',
                      color: '#8f4f00',
                    }}
                  >
                    <strong>[Today]</strong> {item}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Actionable Recommendations */}
          <div
            style={{
              background: 'var(--bg-surface, #fff)',
              borderRadius: '8px',
              border: '1px solid var(--border, #dfe1e6)',
              padding: '18px 20px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
              <LightbulbIcon size={16} />
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: 'var(--text)' }}>
                Actionable Management Recommendations
              </h3>
            </div>
            <p style={{ margin: '0 0 12px 0', fontSize: '12px', color: 'var(--text-muted, #6b778c)' }}>
              AI-driven next steps for team leads and delivery managers.
            </p>

            {recommendations.length === 0 ? (
              <div style={{ fontSize: '12px', color: 'var(--text-muted, #6b778c)', fontStyle: 'italic' }}>
                Recommendations will appear once AI Team Pulse is generated.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {recommendations.map((rec, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '8px',
                      padding: '8px 10px',
                      borderRadius: '6px',
                      background: 'var(--bg-subtle, #f8f9fa)',
                      border: '1px solid var(--border, #eaecf0)',
                      fontSize: '12px',
                      lineHeight: 1.4,
                      color: 'var(--text)',
                    }}
                  >
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: '18px',
                        height: '18px',
                        borderRadius: '50%',
                        background: '#deebff',
                        color: '#0747a6',
                        fontSize: '11px',
                        fontWeight: 700,
                        flexShrink: 0,
                      }}
                    >
                      {idx + 1}
                    </span>
                    <span>{rec}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

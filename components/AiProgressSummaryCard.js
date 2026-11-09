'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

function SparklesIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M12 2L14.4 7.6L20 10L14.4 12.4L12 18L9.6 12.4L4 10L9.6 7.6L12 2Z" />
    </svg>
  );
}

function RefreshIcon({ spinning }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
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

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#00875a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#de350b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

function LightbulbIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#0052cc" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-7 7c0 2.5 1.5 4.5 3 6h8c1.5-1.5 3-3.5 3-6a7 7 0 0 0-7-7z" />
    </svg>
  );
}

const HEALTH_META = {
  on_track: {
    label: 'On Track',
    badgeClass: 'ai-health-on-track',
    dotColor: '#00875a',
  },
  at_risk: {
    label: 'At Risk',
    badgeClass: 'ai-health-at-risk',
    dotColor: '#ff991f',
  },
  critical: {
    label: 'Action Needed',
    badgeClass: 'ai-health-critical',
    dotColor: '#de350b',
  },
  completed: {
    label: 'Completed',
    badgeClass: 'ai-health-completed',
    dotColor: '#0052cc',
  },
};

function formatGeneratedDate(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return String(dateStr);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return String(dateStr);
  }
}

export default function AiProgressSummaryCard({
  projectId = 'all',
  projectName = '',
  className = '',
  currentUser,
}) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const reqSeq = useRef(0);

  const canGenerate = currentUser?.role === 'admin' || currentUser?.role === 'developer';
  const isOverall = !projectId || projectId === 'all';

  const loadCachedSummary = useCallback(async (targetId) => {
    const seq = ++reqSeq.current;
    setLoading(true);
    setError('');

    try {
      const res = await fetch(`/api/ai/progress-summary?projectId=${encodeURIComponent(targetId || 'all')}`);
      if (!res.ok) {
        if (res.status === 403) {
          setSummary(null);
          return;
        }
        throw new Error('Could not load summary.');
      }
      const data = await res.json();
      if (seq === reqSeq.current) {
        setSummary(data.exists ? data.summary : null);
      }
    } catch (err) {
      if (seq === reqSeq.current) {
        // Soft fail on initial read to not disturb other widgets
        setSummary(null);
      }
    } finally {
      if (seq === reqSeq.current) {
        setLoading(false);
      }
    }
  }, []);

  // Fetch cached summary whenever projectId changes (filter sync)
  useEffect(() => {
    loadCachedSummary(projectId);
  }, [projectId, loadCachedSummary]);

  async function handleGenerate() {
    if (!canGenerate || generating) return;
    setGenerating(true);
    setError('');

    try {
      const res = await fetch('/api/ai/progress-summary/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to generate AI summary.');
      }

      setSummary(data.summary);
    } catch (err) {
      setError(err.message || 'Generation failed.');
    } finally {
      setGenerating(false);
    }
  }

  const health = summary?.healthStatus ? HEALTH_META[summary.healthStatus] || HEALTH_META.on_track : null;
  const metrics = summary?.metricsSnapshot || {};

  return (
    <div className={`ai-summary-card ${className}`.trim()}>
      <div className="ai-summary-header">
        <div className="ai-summary-title-wrap">
          <span className="ai-summary-icon" aria-hidden="true">
            <SparklesIcon />
          </span>
          <div>
            <div className="ai-summary-heading">
              {isOverall
                ? 'AI Executive Progress Summary (Overall)'
                : `AI Progress Summary · ${projectName || 'Selected Project'}`}
            </div>
            <div className="ai-summary-subheading">
              Grounded in verified ticket throughput, velocity, and standup blockers
            </div>
          </div>
        </div>

        <div className="ai-summary-actions">
          {health && (
            <span className={`ai-health-badge ${health.badgeClass}`}>
              <span className="ai-health-dot" style={{ background: health.dotColor }} />
              {health.label}
            </span>
          )}

          {canGenerate && (
            <button
              type="button"
              className="ai-refresh-btn"
              onClick={handleGenerate}
              disabled={generating || loading}
              title={summary ? 'Regenerate summary with latest metrics' : 'Generate AI progress summary'}
            >
              <RefreshIcon spinning={generating} />
              <span>{generating ? 'Analyzing...' : summary ? 'Regenerate' : 'Generate Summary'}</span>
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="ai-summary-error">
          <span>{error}</span>
          <button type="button" onClick={() => setError('')} aria-label="Dismiss">✕</button>
        </div>
      )}

      {loading ? (
        <div className="ai-summary-skeleton">
          <div className="ai-skeleton-line short" />
          <div className="ai-skeleton-line" />
          <div className="ai-skeleton-line medium" />
        </div>
      ) : generating ? (
        <div className="ai-summary-loading-state">
          <div className="ai-spinner" />
          <p className="ai-loading-text">
            Synthesizing verified ticket data and standup logs with AI...
          </p>
        </div>
      ) : summary ? (
        <div className="ai-summary-body">
          {summary.headline && (
            <div className="ai-summary-headline">
              "{summary.headline}"
            </div>
          )}

          {summary.summaryText && (
            <div className="ai-summary-prose">
              {summary.summaryText.split('\n\n').map((para, i) => (
                <p key={i}>{para}</p>
              ))}
            </div>
          )}

          {/* 3-Column Grounded Insights Grid */}
          <div className="ai-insights-grid">
            <div className="ai-insight-column achievements">
              <div className="ai-insight-title">
                <CheckIcon /> Key Achievements
              </div>
              {summary.achievements?.length ? (
                <ul className="ai-insight-list">
                  {summary.achievements.map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              ) : (
                <div className="ai-insight-empty">Steady throughput without major releases.</div>
              )}
            </div>

            <div className="ai-insight-column blockers">
              <div className="ai-insight-title">
                <AlertIcon /> Risks & Blockers
              </div>
              {summary.blockers?.length ? (
                <ul className="ai-insight-list">
                  {summary.blockers.map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              ) : (
                <div className="ai-insight-empty">No critical bottlenecks identified.</div>
              )}
            </div>

            <div className="ai-insight-column recommendations">
              <div className="ai-insight-title">
                <LightbulbIcon /> PM Recommendations
              </div>
              {summary.recommendations?.length ? (
                <ul className="ai-insight-list">
                  {summary.recommendations.map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              ) : (
                <div className="ai-insight-empty">Continue monitoring scheduled sprint tasks.</div>
              )}
            </div>
          </div>

          {/* Verified Snapshot Bar */}
          {metrics.total !== undefined && (
            <div className="ai-verified-metrics-bar">
              <span className="ai-metrics-label">Verified Metrics Snapshot:</span>
              <span className="ai-metric-item">Total: <strong>{metrics.total}</strong></span>
              <span className="ai-metric-item">Completion: <strong>{metrics.completionRate}%</strong></span>
              <span className="ai-metric-item">Overdue: <strong style={{ color: metrics.overdueCount > 0 ? '#de350b' : 'inherit' }}>{metrics.overdueCount}</strong></span>
              <span className="ai-metric-item">Logged: <strong>{metrics.totalLoggedHours}h</strong></span>
            </div>
          )}

          {/* Footer Metadata */}
          <div className="ai-summary-footer">
            <span>
              Last analyzed: <strong>{formatGeneratedDate(summary.updatedAt || summary.createdAt)}</strong>
              {summary.generatedByName && ` by ${summary.generatedByName}`}
            </span>
            <span className="ai-summary-model">Model: {summary.modelName || 'gpt-4o-mini'}</span>
          </div>
        </div>
      ) : (
        <div className="ai-summary-empty-state">
          <div className="ai-empty-icon" aria-hidden="true">
            <SparklesIcon />
          </div>
          <div className="ai-empty-title">
            No AI Progress Summary Generated Yet
          </div>
          <div className="ai-empty-desc">
            Generate an executive progress synthesis grounded in verified ticket completion rates,
            recent velocity, and standup blockers.
          </div>
          {canGenerate && (
            <button
              type="button"
              className="btn btn-primary ai-generate-primary-btn"
              onClick={handleGenerate}
              disabled={generating}
            >
              <SparklesIcon />
              <span>Generate AI Progress Summary</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

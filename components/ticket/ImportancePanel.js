'use client';

import { useState, useMemo } from 'react';
import { IMPORTANCE_META, IMPORTANCE_ORDER, ImportanceIcon, formatISTDateTime } from '../meta';

export default function ImportancePanel({
  ticket,
  currentUser,
  detail = {},
  onTicketUpdated,
}) {
  const [editingHuman, setEditingHuman] = useState(false);
  const [humanLevel, setHumanLevel] = useState(ticket?.human_importance || 'medium');
  const [humanReason, setHumanReason] = useState('');
  const [humanError, setHumanError] = useState('');
  const [humanSaving, setHumanSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const [aiError, setAiError] = useState('');

  const canEdit = currentUser?.role === 'admin' || currentUser?.role === 'developer';

  const humanHistory = detail.humanImportanceHistory || [];
  const latestHistory = humanHistory.length > 0 ? humanHistory[0] : null;

  const currentHuman = ticket?.human_importance
    ? String(ticket.human_importance).toLowerCase()
    : null;
  const humanMeta = currentHuman ? IMPORTANCE_META[currentHuman] : null;

  const currentAi = ticket?.ai_importance
    ? String(ticket.ai_importance).toLowerCase()
    : null;
  const aiMeta = currentAi ? IMPORTANCE_META[currentAi] : null;

  const aiStatus = ticket?.ai_importance_status || (ticket?.ai_importance ? 'analyzed' : 'pending');
  const isStale = Boolean(detail.aiImportanceIsStale);

  const explanationBullets = useMemo(() => {
    const raw = ticket?.ai_importance_explanation;
    if (!raw || typeof raw !== 'string') return [];

    // Split on newlines, bullet symbols (•, -, *), or numbers
    const lines = raw
      .split(/\r?\n|•/)
      .map((s) => s.replace(/^[\s\-*\d\.\)\"\'“]+/, '').replace(/[\"\'”]+$/, '').trim())
      .filter((s) => s.length > 2);

    if (lines.length > 0) {
      return lines.slice(0, 5);
    }

    // Fallback if it was a single continuous block
    const sentences = raw
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.replace(/^[\s\-*\d\.\)\"\'“]+/, '').replace(/[\"\'”]+$/, '').trim())
      .filter((s) => s.length > 2);

    return sentences.slice(0, 5);
  }, [ticket?.ai_importance_explanation]);

  async function handleSaveHuman() {
    setHumanError('');
    const trimmedReason = humanReason.trim();
    if (!trimmedReason) {
      setHumanError('A reason is mandatory when modifying importance.');
      return;
    }

    setHumanSaving(true);
    try {
      const res = await fetch(`/api/tickets/${ticket.id}/human-importance`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          human_importance: humanLevel,
          reason: trimmedReason,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update human importance');
      }

      setEditingHuman(false);
      setHumanReason('');
      if (onTicketUpdated) {
        onTicketUpdated(data.ticket, {
          humanImportanceHistory: data.history,
        });
      }
    } catch (err) {
      setHumanError(err.message);
    } finally {
      setHumanSaving(false);
    }
  }

  async function handleReanalyzeAi() {
    if (!canEdit || aiAnalyzing) return;
    setAiAnalyzing(true);
    setAiError('');

    try {
      const res = await fetch(`/api/tickets/${ticket.id}/ai-importance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to re-analyze ticket');
      }

      if (onTicketUpdated) {
        onTicketUpdated(data.ticket, {
          aiImportanceHistory: data.history,
          aiImportanceIsStale: data.isStale,
        });
      }
    } catch (err) {
      setAiError(err.message);
    } finally {
      setAiAnalyzing(false);
    }
  }

  return (
    <div className="tm-importance-block" aria-label="Ticket Importance">
      <div className="tm-importance-grid">
        {/* LEFT: Human Importance */}
        <div className="tm-importance-card tm-importance-human">
          <div className="tm-importance-card-header">
            <span className="tm-importance-card-label">Human Importance</span>
            {canEdit && !editingHuman && (
              <button
                type="button"
                className="tm-importance-action-btn"
                onClick={() => {
                  setHumanLevel(ticket?.human_importance || 'medium');
                  setHumanReason('');
                  setHumanError('');
                  setEditingHuman(true);
                }}
                title="Edit human importance (reason required)"
              >
                Edit
              </button>
            )}
          </div>

          {!editingHuman ? (
            <div className="tm-importance-card-body">
              <div className="tm-importance-value-row">
                {humanMeta ? (
                  <span
                    className="tm-importance-badge"
                    style={{
                      backgroundColor: humanMeta.bg,
                      color: humanMeta.text,
                      borderColor: humanMeta.color,
                    }}
                  >
                    <ImportanceIcon level={currentHuman} size={12} color={humanMeta.text} />
                    <span>{humanMeta.label}</span>
                  </span>
                ) : (
                  <span className="tm-importance-badge is-unassessed">
                    Not Assessed
                  </span>
                )}
              </div>

              {latestHistory?.reason && (
                <div className="tm-importance-note" title={latestHistory.reason}>
                  <span className="tm-importance-note-label">Latest reason:</span>{' '}
                  <span className="tm-importance-note-text">{latestHistory.reason}</span>
                </div>
              )}

              {humanHistory.length > 0 && (
                <button
                  type="button"
                  className="tm-importance-history-toggle"
                  onClick={() => setShowHistory((v) => !v)}
                  aria-expanded={showHistory}
                >
                  {showHistory ? 'Hide history' : `View history (${humanHistory.length})`}
                </button>
              )}

              {showHistory && humanHistory.length > 0 && (
                <div className="tm-importance-history-list">
                  {humanHistory.map((h) => {
                    const oldM = h.old_value ? IMPORTANCE_META[h.old_value.toLowerCase()] : null;
                    const newM = h.new_value ? IMPORTANCE_META[h.new_value.toLowerCase()] : null;
                    return (
                      <div key={h.id} className="tm-importance-history-item">
                        <div className="tm-importance-history-meta">
                          <span className="tm-importance-history-user">
                            {h.changed_by_name || 'User'}
                          </span>
                          <span className="tm-importance-history-time">
                            {formatISTDateTime(h.created_at)}
                          </span>
                        </div>
                        <div className="tm-importance-history-change">
                          {oldM ? (
                            <span className="tm-importance-badge-mini" style={{ color: oldM.text }}>
                              {oldM.label}
                            </span>
                          ) : (
                            <span className="tm-importance-badge-mini">None</span>
                          )}
                          <span className="tm-importance-arrow">&rarr;</span>
                          {newM ? (
                            <span className="tm-importance-badge-mini" style={{ color: newM.text, fontWeight: 600 }}>
                              {newM.label}
                            </span>
                          ) : (
                            <span className="tm-importance-badge-mini">{h.new_value}</span>
                          )}
                        </div>
                        <div className="tm-importance-history-reason">
                          &ldquo;{h.reason}&rdquo;
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <div className="tm-importance-edit-form">
              <label className="tm-importance-mini-label" htmlFor="tm-human-importance-select">
                Select Importance
              </label>
              <select
                id="tm-human-importance-select"
                className="tm-importance-select"
                value={humanLevel}
                onChange={(e) => setHumanLevel(e.target.value)}
                disabled={humanSaving}
              >
                {IMPORTANCE_ORDER.map((lvl) => (
                  <option key={lvl} value={lvl}>
                    {IMPORTANCE_META[lvl]?.label || lvl}
                  </option>
                ))}
              </select>

              <label className="tm-importance-mini-label" htmlFor="tm-human-importance-reason">
                Reason for change <span className="tm-required">*</span>
              </label>
              <textarea
                id="tm-human-importance-reason"
                className="tm-importance-textarea"
                rows={2}
                placeholder="Explain why this importance level is changing..."
                value={humanReason}
                onChange={(e) => {
                  setHumanReason(e.target.value);
                  if (humanError) setHumanError('');
                }}
                disabled={humanSaving}
              />

              {humanError && (
                <div className="tm-importance-error">{humanError}</div>
              )}

              <div className="tm-importance-form-actions">
                <button
                  type="button"
                  className="tm-importance-btn tm-importance-btn-primary"
                  onClick={handleSaveHuman}
                  disabled={humanSaving || !humanReason.trim()}
                >
                  {humanSaving ? 'Saving...' : 'Save'}
                </button>
                <button
                  type="button"
                  className="tm-importance-btn tm-importance-btn-secondary"
                  onClick={() => {
                    setEditingHuman(false);
                    setHumanReason('');
                    setHumanError('');
                  }}
                  disabled={humanSaving}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {/* RIGHT: AI Importance */}
        <div className="tm-importance-card tm-importance-ai">
          <div className="tm-importance-card-header">
            <span className="tm-importance-card-label">AI Importance</span>
            {canEdit && (
              <button
                type="button"
                className={`tm-importance-action-btn tm-ai-reanalyze-btn${aiAnalyzing ? ' is-loading' : ''}`}
                onClick={handleReanalyzeAi}
                disabled={aiAnalyzing}
                title="Re-analyze ticket with project-wide context"
              >
                {aiAnalyzing ? (
                  <>
                    <span className="tm-spinner-mini" />
                    <span>Analyzing...</span>
                  </>
                ) : (
                  <>
                    <svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M2.5 8a5.5 5.5 0 0 1 9.3-3.9L13.5 6M13.5 1.5v4.5H9M13.5 8a5.5 5.5 0 0 1-9.3 3.9L2.5 10M2.5 14.5V10H7" />
                    </svg>
                    <span>Re-analyze</span>
                  </>
                )}
              </button>
            )}
          </div>

          <div className="tm-importance-card-body">
            {aiAnalyzing ? (
              <div className="tm-importance-ai-pending">
                <span className="tm-spinner-mini" />
                <span>Analyzing...</span>
              </div>
            ) : aiStatus === 'pending' ? (
              <div className="tm-importance-ai-pending">
                <span className="tm-spinner-mini" />
                <span>AI Analysis Pending...</span>
              </div>
            ) : aiStatus === 'unavailable' ? (
              <div className="tm-importance-ai-unavailable">
                <span className="tm-importance-badge is-unavailable">
                  AI Analysis Unavailable
                </span>
                <p className="tm-importance-ai-msg">
                  {ticket?.ai_importance_explanation || 'Configure AI_API_KEY to enable project-aware AI evaluation.'}
                </p>
              </div>
            ) : aiStatus === 'failed' && !ticket?.ai_importance ? (
              <div className="tm-importance-ai-failed">
                <span className="tm-importance-badge is-failed">
                  Analysis Failed
                </span>
                <p className="tm-importance-ai-msg">
                  {ticket?.ai_importance_explanation || 'AI analysis could not be completed.'}
                </p>
              </div>
            ) : (
              <>
                <div className="tm-importance-value-row">
                  {aiMeta ? (
                    <span
                      className="tm-importance-badge"
                      style={{
                        backgroundColor: aiMeta.bg,
                        color: aiMeta.text,
                        borderColor: aiMeta.color,
                      }}
                    >
                      <ImportanceIcon level={currentAi} size={12} color={aiMeta.text} />
                      <span>{aiMeta.label}</span>
                    </span>
                  ) : (
                    <span className="tm-importance-badge is-unassessed">Not Assessed</span>
                  )}

                  {ticket?.ai_importance_score != null && (
                    <div className="tm-importance-score" title={`AI Importance Score: ${ticket.ai_importance_score}/100`}>
                      <span className="tm-importance-score-num">{ticket.ai_importance_score}</span>
                      <span className="tm-importance-score-den">/100</span>
                    </div>
                  )}
                </div>

                {/* Suggested Execution Rank */}
                {ticket?.ai_importance_rank != null ? (
                  <div className="tm-importance-rank" title="Suggested execution rank among active tickets in this project">
                    <span className="tm-importance-rank-badge">
                      Rank #{ticket.ai_importance_rank} of {ticket.ai_importance_total || 'all'}
                    </span>
                    <span className="tm-importance-rank-hint">in project</span>
                  </div>
                ) : ticket?.project_id ? null : (
                  <div className="tm-importance-rank is-standalone">
                    <span className="tm-importance-rank-badge is-standalone">Standalone Ticket</span>
                    <span className="tm-importance-rank-hint">(No project ranking)</span>
                  </div>
                )}

                {/* Key Reasons (Max 4-5 concise bullet lines) */}
                {explanationBullets.length > 0 ? (
                  <div className="tm-importance-ai-reasons">
                    <div className="tm-importance-reasons-title">Key Reasons:</div>
                    <ul className="tm-importance-bullets">
                      {explanationBullets.map((line, idx) => (
                        <li key={idx} className="tm-importance-bullet-item">
                          <span className="tm-bullet-marker" aria-hidden="true">•</span>
                          <span className="tm-bullet-text">{line}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : ticket?.ai_importance_explanation ? (
                  <div className="tm-importance-ai-explanation">
                    {ticket.ai_importance_explanation}
                  </div>
                ) : null}

                {/* Context Outdated Notice */}
                {isStale && (
                  <div className="tm-importance-stale-notice" title="Other project tickets changed since this ticket was analyzed.">
                    <span className="tm-stale-dot" />
                    <span>Project context may be outdated</span>
                  </div>
                )}

                {/* Last Analyzed Timestamp */}
                {ticket?.ai_importance_analyzed_at && (
                  <div className="tm-importance-timestamp">
                    Analyzed: {formatISTDateTime(ticket.ai_importance_analyzed_at)}
                  </div>
                )}
              </>
            )}

            {aiError && (
              <div className="tm-importance-error">{aiError}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}


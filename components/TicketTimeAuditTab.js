'use client';

import { useCallback, useEffect, useState } from 'react';
import { fmtMinutes, fmtSeconds, PrecisionBadge } from './MonitoringPanels';

const STAGE_LABELS = {
  open: 'To Do',
  in_progress: 'In Progress',
  resolved: 'QA Testing',
  closed: 'Closed / Done',
};

export default function TicketTimeAuditTab({ ticketId, isAdminOrOwner = false }) {
  const [audit, setAudit] = useState(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');

  // Stage Correction Form state (Owner/Admin only — appends to ticket_stage_corrections cleanly)
  const [correctingRow, setCorrectingRow] = useState(null);
  const [correctedEntryAt, setCorrectedEntryAt] = useState('');
  const [correctedExitAt, setCorrectedExitAt] = useState('');
  const [correctedStatus, setCorrectedStatus] = useState('');
  const [reason, setReason] = useState('');
  const [savingCorr, setSavingCorr] = useState(false);

  const loadAudit = useCallback(async () => {
    if (!ticketId) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/tickets/${ticketId}/time-audit`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load stage audit.');
      setAudit(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [ticketId]);

  useEffect(() => {
    if (open && !audit) {
      loadAudit();
    }
  }, [open, audit, loadAudit]);

  async function submitCorrection(e) {
    e.preventDefault();
    if (!correctingRow) return;
    setSavingCorr(true);
    setError('');
    try {
      const res = await fetch(`/api/tickets/${ticketId}/stage-correction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stage_history_id: correctingRow.id,
          corrected_to_status: correctedStatus || correctingRow.effective_to_status,
          corrected_entry_at: correctedEntryAt || correctingRow.effective_entry_at,
          corrected_exit_at: correctedExitAt || correctingRow.effective_exit_at || null,
          reason,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Stage correction failed.');
      setCorrectingRow(null);
      setReason('');
      await loadAudit();
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingCorr(false);
    }
  }

  return (
    <section className="tm-section" style={{ marginTop: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <button
          type="button"
          className="tm-inline-link"
          style={{ fontWeight: 700, fontSize: 13 }}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? '▼ Stage Time Audit & Canonical Effort' : '▶ Stage Time Audit & Canonical Effort'}
        </button>
        {open && (
          <button type="button" className="btn btn-secondary" style={{ fontSize: 11, padding: '3px 8px' }} onClick={loadAudit} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        )}
      </div>

      {open && (
        <div style={{ border: '1px solid #dfe1e6', borderRadius: 8, padding: 12, fontSize: 12 }}>
          {error && (
            <div style={{ color: '#bf2600', marginBottom: 8 }}>
              <strong>Error:</strong> {error}
            </div>
          )}

          {loading && !audit && <p style={{ color: '#5e6c84' }}>Loading stage audit…</p>}

          {audit && (
            <>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 12, alignItems: 'center' }}>
                <div>
                  <span style={{ color: '#5e6c84' }}>Calendar Total:</span>{' '}
                  <strong>{fmtSeconds(audit.totals?.calendarSeconds)}</strong>
                </div>
                <div>
                  <span style={{ color: '#5e6c84' }}>Business Total:</span>{' '}
                  <strong>{fmtSeconds(audit.totals?.businessSeconds)}</strong>
                </div>
                <div>
                  <span style={{ color: '#5e6c84' }}>Canonical Logged Work:</span>{' '}
                  <strong>{fmtMinutes(audit.totals?.loggedWorkMinutes)}</strong> ({audit.totals?.workLogEntries || 0} entries)
                </div>
                <div>
                  <span style={{ color: '#5e6c84' }}>Reopens:</span>{' '}
                  <strong>{audit.totals?.reopenCount || 0}</strong>
                </div>
                <PrecisionBadge precision={audit.totals?.precision || 'provisional_baseline'} />
              </div>

              <div style={{ overflowX: 'auto', marginBottom: 10 }}>
                <table className="list-table" style={{ width: '100%', fontSize: 12 }}>
                  <thead>
                    <tr>
                      <th align="left">Stage</th>
                      <th align="left">Entered (UTC)</th>
                      <th align="left">Exited (UTC)</th>
                      <th align="right">Calendar</th>
                      <th align="right">Business</th>
                      <th align="left">Precision / Audit</th>
                      {isAdminOrOwner && <th align="right">Action</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {(audit.timeline || []).map((row) => (
                      <tr key={row.id}>
                        <td>
                          <strong>{STAGE_LABELS[row.effective_to_status] || row.effective_to_status}</strong>
                          {Number(row.is_reopen) === 1 && (
                            <span style={{ marginLeft: 4, color: '#bf2600', fontSize: 10 }}>(Reopen)</span>
                          )}
                        </td>
                        <td>{row.effective_entry_at}</td>
                        <td>{row.effective_exit_at || (row.is_ongoing ? 'Active now' : 'Archived')}</td>
                        <td align="right">{fmtSeconds(row.effective_calendar_seconds)}</td>
                        <td align="right"><strong>{fmtSeconds(row.effective_business_seconds)}</strong></td>
                        <td>
                          <PrecisionBadge precision={row.effective_precision} />
                          {row.has_correction && (
                            <span style={{ display: 'block', fontSize: 11, color: '#0747a6', marginTop: 2 }}>
                              Corrected: {row.correction?.reason}
                            </span>
                          )}
                        </td>
                        {isAdminOrOwner && (
                          <td align="right">
                            <button
                              type="button"
                              className="tm-inline-link"
                              style={{ fontSize: 11 }}
                              onClick={() => {
                                setCorrectingRow(row);
                                setCorrectedStatus(row.effective_to_status);
                                setCorrectedEntryAt(row.effective_entry_at || '');
                                setCorrectedExitAt(row.effective_exit_at || '');
                                setReason('');
                              }}
                            >
                              Correct
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {correctingRow && isAdminOrOwner && (
                <form
                  onSubmit={submitCorrection}
                  style={{ background: '#f4f5f7', padding: 10, borderRadius: 6, marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}
                >
                  <div style={{ fontWeight: 700 }}>
                    Append Correction for Stage #{correctingRow.transition_seq} (Original row remains immutable)
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 }}>
                    <label>
                      Stage
                      <select
                        className="ts-task-select"
                        value={correctedStatus}
                        onChange={(e) => setCorrectedStatus(e.target.value)}
                      >
                        <option value="open">To Do (open)</option>
                        <option value="in_progress">In Progress (in_progress)</option>
                        <option value="resolved">QA Testing (resolved)</option>
                        <option value="closed">Closed / Done (closed)</option>
                      </select>
                    </label>
                    <label>
                      Entry At (ISO/UTC)
                      <input
                        className="tm-input"
                        value={correctedEntryAt}
                        onChange={(e) => setCorrectedEntryAt(e.target.value)}
                      />
                    </label>
                    <label>
                      Exit At (optional if active)
                      <input
                        className="tm-input"
                        value={correctedExitAt}
                        onChange={(e) => setCorrectedExitAt(e.target.value)}
                      />
                    </label>
                  </div>
                  <label>
                    Mandatory Reason (min 5 chars)
                    <input
                      className="tm-input"
                      required
                      minLength={5}
                      placeholder="Explain why this historical stage timing is being corrected"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="submit" className="btn btn-primary" disabled={savingCorr || reason.trim().length < 5}>
                      {savingCorr ? 'Saving…' : 'Record Immutable Correction'}
                    </button>
                    <button type="button" className="btn btn-secondary" onClick={() => setCorrectingRow(null)}>
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

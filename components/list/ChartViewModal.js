'use client';

import { useEffect, useState } from 'react';

import { STATUS_META, STATUS_ORDER, TypeIcon } from '../meta';
import DonutChart, { BarChart } from '../DonutChart';

/**
 * "View work items as a chart" renders the project's tickets as a donut and a
 * bar breakdown, both drawn from the rows the list is currently showing rather
 * than from a separate query, so the chart always agrees with the filters.
 */
export default function ChartViewModal({ tickets, scopeLabel, onClose }) {
  const [breakdown, setBreakdown] = useState('status');

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const statusSegments = STATUS_ORDER.map((status) => ({
    key: status,
    label: STATUS_META[status].label,
    color: STATUS_META[status].color,
    value: tickets.filter((t) => t.status === status).length,
  }));

  const typeRows = [
    { key: 'bug', label: 'Bug', color: '#6554C0' },
    { key: 'task', label: 'Task', color: '#4E9F93' },
    { key: 'story', label: 'Story', color: '#0C66E4' },
    { key: 'epic', label: 'Epic', label2: 'Epic', color: '#994D0A' },
  ].map((row) => ({
    ...row,
    value: tickets.filter((t) => (t.type || 'task') === row.key).length,
    icon:
      row.key === 'priority' ? null : (
        <TypeIcon type={row.key} size={14} />
      ),
  }));

  const statusRows = STATUS_ORDER.map((status) => ({
    key: status,
    label: STATUS_META[status].label,
    color: STATUS_META[status].color,
    value: tickets.filter((t) => t.status === status).length,
  }));

  const total = tickets.length;

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Work items chart"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header>
          <h3>Work items by {breakdown}</h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <div className="chart-modal-body">
          <div className="chart-modal-controls" role="group" aria-label="Group the chart by">
            {['status', 'type'].map((option) => (
              <button
                key={option}
                type="button"
                className={`chart-mode-btn${breakdown === option ? ' is-active' : ''}`}
                aria-pressed={breakdown === option}
                onClick={() => setBreakdown(option)}
              >
                {option === 'status' ? 'Status' : 'Issue type'}
              </button>
            ))}
          </div>

          {total === 0 ? (
            <p className="chart-empty">No work items match the current filters, so there is nothing to chart.</p>
          ) : breakdown === 'status' ? (
            <div className="chart-modal-split">
              <DonutChart
                segments={statusSegments}
                total={total}
                size={168}
                thickness={18}
                totalLabel={scopeLabel}
              />
              <ul className="donut-legend">
                {statusSegments.map((s) => (
                  <li key={s.key}>
                    <span className="legend-swatch" style={{ background: s.color }} aria-hidden="true" />
                    <span className="legend-label">{s.label}</span>
                    <span className="legend-value">{s.value}</span>
                    <span className="legend-pct">
                      {total > 0 ? Math.round((s.value / total) * 100) : 0}%
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <BarChart rows={typeRows} emptyLabel="No work items to chart" />
          )}

          {breakdown === 'status' && (
            <div className="chart-modal-bar">
              <h4 className="chart-subhead">Same data as bars</h4>
              <BarChart rows={statusRows} emptyLabel="No work items to chart" />
            </div>
          )}
        </div>

        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

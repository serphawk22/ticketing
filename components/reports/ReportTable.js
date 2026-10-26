'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';

function getColumnAlignment(key = '') {
  const k = key.toLowerCase();
  if (
    [
      'estimate',
      'actual',
      'time_spent',
      'turnaround_time',
      'turnaround',
      'variance',
      'duration',
      'budget',
      'actual_cost',
      'cost',
      'amount',
      'salary',
      'current_salary',
      'revenue',
      'expense',
      'days_delayed',
      'logged_time',
    ].includes(k) ||
    k.endsWith('_hours') ||
    k.endsWith('_count') ||
    k.endsWith('_amount') ||
    k.endsWith('_days')
  ) {
    return 'right';
  }
  if (['status', 'priority', 'rank', 'payment_status'].includes(k)) {
    return 'center';
  }
  return 'left';
}

function getColumnClass(key = '') {
  const k = key.toLowerCase();
  if (['key', 'id'].includes(k)) return 'rpt-col-key';
  if (['title', 'ticket_title', 'task_title', 'defect_summary', 'summary', 'item', 'ticket'].includes(k)) return 'rpt-col-title';
  if (['project', 'project_name'].includes(k)) return 'rpt-col-project';
  if (['assignee', 'user_name', 'actor_name', 'name', 'employee_name', 'employee'].includes(k)) return 'rpt-col-person';
  if (['estimate', 'original_estimate', 'planned'].includes(k)) return 'rpt-col-estimate';
  if (['actual', 'time_spent', 'duration'].includes(k)) return 'rpt-col-actual';
  if (['turnaround_time', 'turnaround'].includes(k)) return 'rpt-col-turnaround';
  if (['variance'].includes(k)) return 'rpt-col-variance';
  if (['status', 'payment_status'].includes(k)) return 'rpt-col-status';
  if (['priority'].includes(k)) return 'rpt-col-priority';
  if (['due_date', 'created', 'created_at', 'updated_at', 'work_date', 'date', 'timestamp', 'last_revision'].includes(k)) return 'rpt-col-date';
  return 'rpt-col-default';
}

export default function ReportTable({
  columns = [],
  rows = [],
  pageSize = 20,
  emptyMessage = 'No records match the selected filters.',
  unavailableNotice = null,
}) {
  const [sortKey, setSortKey] = useState(null);
  const [sortOrder, setSortOrder] = useState('asc');
  const [page, setPage] = useState(1);

  // Sorting
  const sortedRows = useMemo(() => {
    if (!sortKey) return rows;
    return [...rows].sort((a, b) => {
      let va = a[sortKey];
      let vb = b[sortKey];

      // Handle nulls
      if (va == null) return 1;
      if (vb == null) return -1;

      // Numerical sort if both are numbers or numeric strings
      const numA = Number(String(va).replace(/[^0-9.-]+/g, ''));
      const numB = Number(String(vb).replace(/[^0-9.-]+/g, ''));
      if (!Number.isNaN(numA) && !Number.isNaN(numB) && String(va).match(/\d/) && String(vb).match(/\d/)) {
        return sortOrder === 'asc' ? numA - numB : numB - numA;
      }

      const strA = String(va).toLowerCase();
      const strB = String(vb).toLowerCase();
      if (strA < strB) return sortOrder === 'asc' ? -1 : 1;
      if (strA > strB) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });
  }, [rows, sortKey, sortOrder]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pagedRows = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return sortedRows.slice(start, start + pageSize);
  }, [sortedRows, currentPage, pageSize]);

  function handleSort(key) {
    if (sortKey === key) {
      setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortOrder('asc');
    }
    setPage(1);
  }

  function renderCell(c, row) {
    const val = row[c.key];

    // Drill down links to source records
    if (c.drillDown === 'ticket' && row.key) {
      return (
        <Link href={`/t/${encodeURIComponent(row.key)}`} className="rpt-drilldown-link" title={String(row.title || row.key)}>
          {val || row.key}
        </Link>
      );
    }

    if (c.drillDown === 'project' && row.id) {
      return (
        <Link href={`/projects/${row.id}/summary`} className="rpt-drilldown-link" title="Open project summary">
          <span className="rpt-cell-truncate" title={String(val || '')}>
            {val}
          </span>
        </Link>
      );
    }

    if (c.drillDown === 'employee') {
      return (
        <Link href="/employees" className="rpt-drilldown-link" title="View in employee roster">
          <span className="rpt-cell-truncate" title={String(val || '')}>
            {val}
          </span>
        </Link>
      );
    }

    // Status / Priority badge rendering
    if (c.key === 'status' || c.key === 'payment_status') {
      const s = String(val).toLowerCase();
      let colorClass = 'badge-neutral';
      if (s === 'open') colorClass = 'badge-open';
      if (s === 'in_progress') colorClass = 'badge-in-progress';
      if (['resolved', 'closed', 'completed', 'paid', 'operational', 'healthy', 'green'].includes(s)) colorClass = 'badge-resolved';
      if (['overdue', 'failed', 'blocked', 'red'].includes(s)) colorClass = 'badge-danger';
      if (['pending', 'yellow'].includes(s)) colorClass = 'badge-warning';
      return <span className={`rpt-badge ${colorClass}`}>{val}</span>;
    }

    if (c.key === 'priority') {
      const p = String(val).toLowerCase();
      let colorClass = 'priority-med';
      if (p === 'urgent') colorClass = 'priority-urgent';
      if (p === 'high') colorClass = 'priority-high';
      if (p === 'low') colorClass = 'priority-low';
      return <span className={`rpt-priority ${colorClass}`}>{val}</span>;
    }

    // Variance formatting
    if (c.key === 'variance') {
      const sVal = String(val || '');
      if (sVal === '—' || !sVal) return <span className="rpt-cell-dim">—</span>;
      if (sVal.startsWith('+')) return <span className="rpt-var-tag var-over">{sVal}</span>;
      if (sVal.startsWith('-')) return <span className="rpt-var-tag var-under">{sVal}</span>;
      return <span className="rpt-var-tag var-on-track">{sVal}</span>;
    }

    // Turnaround time formatting
    if (c.key === 'turnaround_time' || c.key === 'turnaround') {
      const sVal = String(val || '');
      if (!sVal || sVal === '—') return <span className="rpt-cell-dim">—</span>;
      if (sVal.includes('(Ongoing)')) return <span className="rpt-turnaround-pill ongoing">{sVal}</span>;
      return <span className="rpt-turnaround-pill completed">{sVal}</span>;
    }

    // Original Estimate "Not Estimated" formatting
    if (c.key === 'estimate' && val === 'Not Estimated') {
      return (
        <span className="rpt-cell-dim" title="Original estimate not specified">
          Not Estimated
        </span>
      );
    }

    // Text truncation for long strings (titles, projects, notes, etc.)
    const colClass = getColumnClass(c.key);
    if (['rpt-col-title', 'rpt-col-project', 'rpt-col-person'].includes(colClass)) {
      return (
        <span className="rpt-cell-truncate" title={String(val || '')}>
          {val ?? '—'}
        </span>
      );
    }

    return val ?? '—';
  }

  if (unavailableNotice) {
    return (
      <div className="rpt-unavailable-box">
        <div className="rpt-unavailable-icon">ℹ️</div>
        <div className="rpt-unavailable-text">
          <h4>Data Source Awaiting Integration</h4>
          <p>{unavailableNotice}</p>
        </div>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="rpt-table-empty">
        <p>{emptyMessage}</p>
      </div>
    );
  }

  // Calculate dynamic minimum width to ensure every column has sufficient breathing room
  const calculatedMinWidth = Math.max(860, columns.length * 125);

  return (
    <div className="rpt-table-container">
      <div className="rpt-table-wrapper">
        <table className="rpt-table" style={{ minWidth: calculatedMinWidth }}>
          <thead>
            <tr>
              {columns.map((c) => {
                const isSorted = sortKey === c.key;
                const align = getColumnAlignment(c.key);
                const colClass = getColumnClass(c.key);

                return (
                  <th
                    key={c.key}
                    onClick={() => c.sortable && handleSort(c.key)}
                    className={`${colClass} align-${align} ${c.sortable ? 'sortable' : ''}`}
                    title={c.sortable ? 'Click to sort' : undefined}
                  >
                    <div className={`rpt-th-content justify-${align}`}>
                      <span>{c.label}</span>
                      {c.sortable && (
                        <span className="rpt-sort-indicator" aria-hidden="true">
                          {isSorted ? (sortOrder === 'asc' ? ' ▲' : ' ▼') : ' ⇅'}
                        </span>
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {pagedRows.map((row, idx) => (
              <tr key={row.id || idx}>
                {columns.map((c) => {
                  const align = getColumnAlignment(c.key);
                  const colClass = getColumnClass(c.key);
                  return (
                    <td key={c.key} className={`${colClass} align-${align}`}>
                      {renderCell(c, row)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      <div className="rpt-pagination-bar">
        <span className="rpt-page-info">
          Showing <strong>{(currentPage - 1) * pageSize + 1}</strong> –{' '}
          <strong>{Math.min(currentPage * pageSize, rows.length)}</strong> of{' '}
          <strong>{rows.length}</strong> records
        </span>
        {totalPages > 1 && (
          <div className="rpt-pagination-controls">
            <button
              type="button"
              className="rpt-page-btn"
              disabled={currentPage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </button>
            <span className="rpt-page-current">
              Page {currentPage} of {totalPages}
            </span>
            <button
              type="button"
              className="rpt-page-btn"
              disabled={currentPage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

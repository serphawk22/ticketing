'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';

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
        <Link href={`/t/${encodeURIComponent(row.key)}`} className="rpt-drilldown-link" title="Open ticket">
          {val || row.key}
        </Link>
      );
    }

    if (c.drillDown === 'project' && row.id) {
      return (
        <Link href={`/projects/${row.id}/summary`} className="rpt-drilldown-link" title="Open project summary">
          {val}
        </Link>
      );
    }

    if (c.drillDown === 'employee') {
      return (
        <Link href="/employees" className="rpt-drilldown-link" title="View in employee roster">
          {val}
        </Link>
      );
    }

    // Status / Priority badge rendering
    if (c.key === 'status') {
      const s = String(val).toLowerCase();
      let colorClass = 'badge-neutral';
      if (s === 'open') colorClass = 'badge-open';
      if (s === 'in_progress') colorClass = 'badge-in-progress';
      if (s === 'resolved' || s === 'closed' || s === 'completed' || s === 'paid') colorClass = 'badge-resolved';
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

  return (
    <div className="rpt-table-container">
      <div className="rpt-table-wrapper">
        <table className="rpt-table">
          <thead>
            <tr>
              {columns.map((c) => {
                const isSorted = sortKey === c.key;
                return (
                  <th
                    key={c.key}
                    onClick={() => c.sortable && handleSort(c.key)}
                    className={c.sortable ? 'sortable' : ''}
                    title={c.sortable ? 'Click to sort' : undefined}
                  >
                    <div className="rpt-th-content">
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
                {columns.map((c) => (
                  <td key={c.key}>{renderCell(c, row)}</td>
                ))}
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


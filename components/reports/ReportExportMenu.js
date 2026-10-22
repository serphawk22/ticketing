'use client';

import { useState, useRef, useEffect } from 'react';
import { buildReportCsv, buildExcelXml, downloadExcelXml, triggerPdfPrint } from '@/lib/exportUtils';
import { downloadCsv } from '@/lib/csv';

export default function ReportExportMenu({
  title,
  dateRangeLabel,
  filtersApplied = {},
  columns = [],
  rows = [],
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [open]);

  const cleanFilename = (title || 'Report')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  function exportCsv() {
    setOpen(false);
    const content = buildReportCsv({
      title,
      dateRangeLabel,
      filtersApplied,
      columns,
      rows,
    });
    downloadCsv(`${cleanFilename}.csv`, content);
  }

  function exportExcel() {
    setOpen(false);
    const xml = buildExcelXml({
      title,
      dateRangeLabel,
      filtersApplied,
      columns,
      rows,
    });
    downloadExcelXml(`${cleanFilename}.xls`, xml);
  }

  function exportPdf() {
    setOpen(false);
    triggerPdfPrint();
  }

  return (
    <div className="rpt-export-wrap" ref={menuRef}>
      <button
        type="button"
        className="rpt-export-btn"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="true"
      >
        <svg
          viewBox="0 0 24 24"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        <span>Export</span>
      </button>

      {open && (
        <div className="rpt-export-dropdown" role="menu">
          <button type="button" className="rpt-export-item" onClick={exportCsv}>
            <span className="rpt-export-icon">📄</span>
            <span>Export to CSV (.csv)</span>
          </button>
          <button type="button" className="rpt-export-item" onClick={exportExcel}>
            <span className="rpt-export-icon">📊</span>
            <span>Export to Excel (.xls / .xlsx)</span>
          </button>
          <button type="button" className="rpt-export-item" onClick={exportPdf}>
            <span className="rpt-export-icon">🖨️</span>
            <span>Print / Save as PDF</span>
          </button>
        </div>
      )}
    </div>
  );
}


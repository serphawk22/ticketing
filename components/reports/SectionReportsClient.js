'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import AppShell from '../AppShell';
import ReportNav from './ReportNav';

export default function SectionReportsClient({
  section,
  reports = [],
  projects = [],
  currentUser,
}) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return reports;
    return reports.filter(
      (r) =>
        String(r.id).includes(q) ||
        r.title.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q) ||
        r.importantInfo.toLowerCase().includes(q)
    );
  }, [reports, search]);

  return (
    <AppShell
      currentUser={currentUser}
      projects={projects}
      projectCounts={{}}
      view="section-reports"
    >
      <div className="rpt-section-page">
        {/* Navigation Breadcrumb & Pills */}
        <ReportNav currentSectionSlug={section.slug} />

        {/* Section Header */}
        <div className="rpt-page-header">
          <div>
            <div className="rpt-page-subtitle">Section {section.id} · {section.reportNumbers}</div>
            <h1 className="rpt-page-title">{section.title}</h1>
            <p className="rpt-page-desc">{section.description}</p>
          </div>
          <div className="rpt-header-actions">
            <Link href="/reports" className="btn-secondary">
              ← Back to All Sections
            </Link>
          </div>
        </div>

        {/* Filter Input */}
        <div className="rpt-hub-controls">
          <div className="rpt-hub-search-box">
            <svg
              className="rpt-search-icon"
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
            <input
              type="text"
              className="rpt-hub-search-input"
              placeholder={`Filter ${section.title}...`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Filter section reports"
            />
            {search && (
              <button
                type="button"
                className="rpt-search-clear"
                onClick={() => setSearch('')}
                aria-label="Clear search"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Reports Grid */}
        <div className="rpt-reports-grid rpt-section-reports-grid">
          {filtered.map((r) => (
            <Link
              key={r.slug}
              href={`/reports/${section.slug}/${r.slug}`}
              className="rpt-report-card"
            >
              <div className="rpt-card-top">
                <span className="rpt-report-num">#{r.id}</span>
                <span className="rpt-report-cadence">{r.frequency}</span>
              </div>
              <h3 className="rpt-report-card-title">{r.title}</h3>
              <p className="rpt-report-card-desc">{r.description}</p>
              <div className="rpt-report-card-meta">
                <div className="rpt-meta-label">Key Information Tracked:</div>
                <div className="rpt-meta-text">{r.importantInfo}</div>
              </div>
              <div className="rpt-report-card-action">
                <span className="rpt-action-text">Launch Report</span>
                <span className="rpt-action-arrow">→</span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </AppShell>
  );
}


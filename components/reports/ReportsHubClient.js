'use client';

import { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import AppShell from '../AppShell';
import ScheduleModal from './ScheduleModal';
import {
  DASHBOARD_PROFILES,
  getProfileConfig,
  filterSectionsForProfile,
} from '@/lib/roleDashboardConfig';

export default function ReportsHubClient({
  sections = [],
  reports = [],
  projects = [],
  currentUser,
}) {
  const [search, setSearch] = useState('');
  const [selectedSection, setSelectedSection] = useState('all');
  const [selectedProfile, setSelectedProfile] = useState('admin');
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [alertNotice, setAlertNotice] = useState('');
  const [runningAlert, setRunningAlert] = useState(false);

  // All sections start in collapsed mode by default on page open
  const [expandedSections, setExpandedSections] = useState({});

  const isAdmin = currentUser.role === 'admin';
  const effectiveProfile = isAdmin ? selectedProfile : 'developer';
  const activeProfile = useMemo(() => getProfileConfig(selectedProfile), [selectedProfile]);

  // Dynamically filter visible sections based on role profile
  const visibleSections = useMemo(() => {
    if (!isAdmin) {
      return sections.filter(
        (sec) => sec.slug !== 'salary-payroll-and-cost' && sec.slug !== 'finance-and-startup-expense'
      );
    }
    return filterSectionsForProfile(sections, effectiveProfile);
  }, [sections, isAdmin, effectiveProfile]);

  // Automatically reset selectedSection filter to 'all' if the active section is excluded in the new profile
  useEffect(() => {
    if (selectedSection !== 'all' && !visibleSections.some((s) => s.slug === selectedSection)) {
      setSelectedSection('all');
    }
  }, [selectedSection, visibleSections]);

  const toggleSection = (slug) => {
    setExpandedSections((prev) => {
      const isCurrentlyExpanded = Boolean(prev[slug]);
      if (isCurrentlyExpanded) {
        // User is closing this section
        const next = { ...prev };
        delete next[slug];
        return next;
      } else {
        // When expanding one report section, all other sections close automatically
        return { [slug]: true };
      }
    });
  };

  const expandAll = () => {
    const allExpanded = {};
    visibleSections.forEach((sec) => {
      allExpanded[sec.slug] = true;
    });
    setExpandedSections(allExpanded);
  };

  const collapseAll = () => {
    setExpandedSections({});
  };

  // Filter reports according to visible sections and search query
  const filteredReports = useMemo(() => {
    const q = search.trim().toLowerCase();
    const allowedSlugsSet = new Set(visibleSections.map((s) => s.slug));

    return reports.filter((r) => {
      // Must be part of a visible section for the active role
      if (!allowedSlugsSet.has(r.sectionSlug)) {
        return false;
      }

      if (selectedSection !== 'all' && r.sectionSlug !== selectedSection) {
        return false;
      }

      if (!q) return true;
      return (
        String(r.id).includes(q) ||
        r.title.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q) ||
        r.importantInfo.toLowerCase().includes(q)
      );
    });
  }, [reports, search, selectedSection, visibleSections]);

  // Group filtered reports by section
  const reportsBySection = useMemo(() => {
    const map = {};
    for (const r of filteredReports) {
      if (!map[r.sectionSlug]) map[r.sectionSlug] = [];
      map[r.sectionSlug].push(r);
    }
    return map;
  }, [filteredReports]);

  async function handleTriggerAlertCheck() {
    setRunningAlert(true);
    setAlertNotice('');
    try {
      const res = await fetch('/api/cron/scheduled-reports');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to trigger alert check');
      setAlertNotice(
        `Alerts checked: ${data.alertsResult?.overdueCount || 0} overdue items, ${
          data.alertsResult?.approvalsCount || 0
        } pending approvals recorded.`
      );
    } catch (err) {
      setAlertNotice(`Error checking alerts: ${err.message}`);
    } finally {
      setRunningAlert(false);
    }
  }

  const isSearching = Boolean(search.trim());

  return (
    <AppShell currentUser={currentUser} projects={projects} projectCounts={{}} view="reports-hub">
      <div className="rpt-hub-page">
        {/* Hub Header */}
        <div className="rpt-page-header">
          <div>
            <div className="rpt-page-subtitle">Serp Hawk Analytics Catalogue</div>
            <h1 className="rpt-page-title">Enterprise Reporting Hub</h1>
            <p className="rpt-page-desc">
              Centralized access to organizational, engineering, delivery, and financial reports across key business functions.
            </p>
          </div>
          <div className="rpt-header-actions" style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            {isAdmin && (
              <>
                <div className="rpt-role-selector-group" title="Preview reports directory as different roles">
                  <label htmlFor="hub-role-selector" className="rpt-role-selector-label">
                    Preview As:
                  </label>
                  <select
                    id="hub-role-selector"
                    className="rpt-role-selector-select"
                    value={selectedProfile}
                    onChange={(e) => setSelectedProfile(e.target.value)}
                  >
                    {DASHBOARD_PROFILES.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>

                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleTriggerAlertCheck}
                  disabled={runningAlert}
                  title="Run automated check for overdue tickets and pending approvals"
                >
                  {runningAlert ? 'Checking...' : '🔔 Run Alert'}
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => setShowScheduleModal(true)}
                >
                  ⏰ Schedule Email
                </button>
              </>
            )}
          </div>
        </div>

        {/* Preview Banner */}
        {selectedProfile !== 'admin' && (
          <div className="rpt-preview-banner">
            <div className="rpt-preview-info">
              <span className="rpt-preview-pill">Previewing Directory as {activeProfile.name}</span>
              <div>
                <div className="rpt-preview-tagline">{activeProfile.tagline}</div>
                <div className="rpt-preview-desc">
                  Showing only reports permitted for the {activeProfile.name} profile ({filteredReports.length} reports across {visibleSections.length} sections visible).
                </div>
              </div>
            </div>
            <button
              type="button"
              className="rpt-preview-reset-btn"
              onClick={() => setSelectedProfile('admin')}
            >
              ← Return to Admin View
            </button>
          </div>
        )}

        {alertNotice && (
          <div className="rpt-alert rpt-alert-info">
            {alertNotice}
          </div>
        )}

        {/* Search & Section Filter Bar */}
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
              placeholder="Search reports by title, number (#1 to #85), keyword, or metric..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search all reports"
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

          <div className="rpt-section-filter-row">
            <div className="rpt-section-filter-pills">
              <button
                type="button"
                className={`rpt-sec-filter-btn${selectedSection === 'all' ? ' active' : ''}`}
                onClick={() => setSelectedSection('all')}
              >
                All Sections ({filteredReports.length})
              </button>
              {visibleSections.map((sec) => (
                <button
                  key={sec.slug}
                  type="button"
                  className={`rpt-sec-filter-btn${selectedSection === sec.slug ? ' active' : ''}`}
                  onClick={() => setSelectedSection(sec.slug)}
                >
                  Sec {sec.id}: {sec.shortTitle}
                </button>
              ))}
            </div>

            <div className="rpt-hub-accordion-actions">
              <button
                type="button"
                className="rpt-sec-action-btn"
                onClick={expandAll}
                title="Expand all sections"
              >
                Expand All
              </button>
              <button
                type="button"
                className="rpt-sec-action-btn"
                onClick={collapseAll}
                title="Collapse all sections"
              >
                Collapse All
              </button>
            </div>
          </div>
        </div>

        {/* Report Listing Grouped by Permitted Visible Sections */}
        <div className="rpt-sections-container">
          {visibleSections.map((sec) => {
            const list = reportsBySection[sec.slug] || [];
            if (selectedSection !== 'all' && selectedSection !== sec.slug) return null;
            if (list.length === 0 && search) return null;

            // Collapsed by default unless searched or expanded by user
            const isExpanded = isSearching || Boolean(expandedSections[sec.slug]);
            const isCollapsed = !isExpanded;

            return (
              <div key={sec.slug} className={`rpt-section-block${isCollapsed ? ' is-collapsed' : ''}`}>
                <div className="rpt-section-head">
                  <div
                    className="rpt-section-head-clickable"
                    onClick={() => toggleSection(sec.slug)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        toggleSection(sec.slug);
                      }
                    }}
                    title={isCollapsed ? `Click to expand Section ${sec.id}` : `Click to collapse Section ${sec.id}`}
                  >
                    <button
                      type="button"
                      className="rpt-section-chevron"
                      aria-expanded={!isCollapsed}
                      aria-label={isCollapsed ? `Expand ${sec.title}` : `Collapse ${sec.title}`}
                      tabIndex={-1}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        width="16"
                        height="16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        style={{
                          transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
                          transition: 'transform 0.2s ease',
                        }}
                      >
                        <path d="M6 9l6 6 6-6" />
                      </svg>
                    </button>
                    <div className="rpt-sec-badge-large" style={{ backgroundColor: sec.color }}>
                      Section {sec.id}
                    </div>
                    <div className="rpt-section-title-wrap">
                      <h2>{sec.title}</h2>
                      <p className="rpt-section-desc">{sec.description}</p>
                    </div>
                  </div>

                  <div className="rpt-section-head-actions">
                    <span className="rpt-section-count-badge">
                      {list.length} {list.length === 1 ? 'report' : 'reports'}
                    </span>
                    <Link href={`/reports/${sec.slug}`} className="rpt-section-view-all">
                      View Section →
                    </Link>
                    <button
                      type="button"
                      className="rpt-section-toggle-btn"
                      onClick={() => toggleSection(sec.slug)}
                      aria-expanded={!isCollapsed}
                      title={isCollapsed ? `Expand Section ${sec.id}` : `Collapse Section ${sec.id}`}
                    >
                      {isCollapsed ? 'Expand' : 'Collapse'}
                    </button>
                  </div>
                </div>

                {!isCollapsed ? (
                  <div className="rpt-reports-grid">
                    {list.map((r) => (
                      <Link
                        key={r.slug}
                        href={`/reports/${sec.slug}/${r.slug}`}
                        className="rpt-report-card"
                      >
                        <div className="rpt-card-top">
                          <span className="rpt-report-num">#{r.id}</span>
                          <span className="rpt-report-cadence">{r.frequency}</span>
                        </div>
                        <h4 className="rpt-report-card-title">{r.title}</h4>
                        <p className="rpt-report-card-desc">{r.description}</p>
                        <div className="rpt-report-card-meta">
                          <span className="rpt-report-info-snippet" title={r.importantInfo}>
                            {r.importantInfo}
                          </span>
                        </div>
                        <div className="rpt-report-card-action">
                          <span className="rpt-action-text">Run Report</span>
                          <span className="rpt-action-arrow">→</span>
                        </div>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <div
                    className="rpt-section-collapsed-summary"
                    onClick={() => toggleSection(sec.slug)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        toggleSection(sec.slug);
                      }
                    }}
                    title="Click to expand this section"
                  >
                    <span className="rpt-collapsed-info">
                      📁 <strong>{list.length} reports</strong> collapsed in Section {sec.id} ({sec.shortTitle})
                    </span>
                    <span className="rpt-collapsed-prompt">Click anywhere to expand ↓</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Schedule Modal */}
        <ScheduleModal
          isOpen={showScheduleModal}
          onClose={() => setShowScheduleModal(false)}
          onScheduleCreated={() => {
            setAlertNotice('Report schedule created successfully! Automated emails will be dispatched according to the frequency.');
          }}
        />
      </div>
    </AppShell>
  );
}

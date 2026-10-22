'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import AppShell from '../AppShell';
import ScheduleModal from './ScheduleModal';
import {
  DASHBOARD_PROFILES,
  getProfileConfig,
  isReportPermittedForProfile,
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

  const isAdmin = currentUser.role === 'admin';
  const activeProfile = useMemo(() => getProfileConfig(selectedProfile), [selectedProfile]);

  // Filter reports
  const filteredReports = useMemo(() => {
    const q = search.trim().toLowerCase();
    const effectiveProfile = isAdmin ? selectedProfile : 'developer';

    return reports.filter((r) => {
      // Permission check: Developers cannot access Section 4 (salary) or Section 6 (finance)
      if (!isAdmin && (r.sectionSlug === 'salary-payroll-and-cost' || r.sectionSlug === 'finance-and-startup-expense')) {
        return false;
      }

      // Check role profile permission
      if (isAdmin && !isReportPermittedForProfile(r.slug, r.sectionSlug, effectiveProfile)) {
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
  }, [reports, search, selectedSection, isAdmin, selectedProfile]);

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

  return (
    <AppShell currentUser={currentUser} projects={projects} projectCounts={{}} view="reports-hub">
      <div className="rpt-hub-page">
        {/* Hub Header */}
        <div className="rpt-page-header">
          <div>
            <div className="rpt-page-subtitle">Serp Hawk Analytics Catalogue</div>
            <h1 className="rpt-page-title">Enterprise Reporting Hub</h1>
            <p className="rpt-page-desc">
              Centralized access to all 76 organizational, engineering, delivery, and financial reports across 7 key business functions.
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
                  Showing only reports permitted for the {activeProfile.name} profile ({filteredReports.length} reports visible).
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

          <div className="rpt-section-filter-pills">
            <button
              type="button"
              className={`rpt-sec-filter-btn${selectedSection === 'all' ? ' active' : ''}`}
              onClick={() => setSelectedSection('all')}
            >
              All Sections (76)
            </button>
            {sections
              .filter((sec) => isAdmin || (sec.slug !== 'salary-payroll-and-cost' && sec.slug !== 'finance-and-startup-expense'))
              .map((sec) => (
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
        </div>

        {/* Report Listing Grouped by Section */}
        <div className="rpt-sections-container">
          {sections
            .filter((sec) => isAdmin || (sec.slug !== 'salary-payroll-and-cost' && sec.slug !== 'finance-and-startup-expense'))
            .map((sec) => {
              const list = reportsBySection[sec.slug] || [];
              if (selectedSection !== 'all' && selectedSection !== sec.slug) return null;
              if (list.length === 0 && search) return null;

              return (
                <div key={sec.slug} className="rpt-section-block">
                  <div className="rpt-section-head">
                    <div className="rpt-sec-badge-large" style={{ backgroundColor: sec.color }}>
                      Section {sec.id}
                    </div>
                    <div className="rpt-section-title-wrap">
                      <Link href={`/reports/${sec.slug}`} className="rpt-section-title-link">
                        <h2>{sec.title}</h2>
                      </Link>
                      <p className="rpt-section-desc">{sec.description}</p>
                    </div>
                    <Link href={`/reports/${sec.slug}`} className="rpt-section-view-all">
                      View Section ({list.length} reports) →
                    </Link>
                  </div>

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


'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import ReportShell from './ReportShell';
import { REPORTS, REPORT_SECTIONS } from '@/lib/reportCatalog';

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.35-4.35" />
    </svg>
  );
}

function ReportIcon({ slug }) {
  const common = {
    viewBox: '0 0 24 24',
    width: 22,
    height: 22,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  };

  if (slug === 'created-vs-resolved' || slug === 'cumulative-flow') {
    return (
      <svg {...common}>
        <path d="M4 16c2-4 4-4 6 0s4 4 6 0 4-4 6 0" />
        <path d="M4 10c2-3 4-3 6 0s4 3 6 0 4-3 6 0" />
      </svg>
    );
  }
  if (slug === 'average-age' || slug === 'resolution-time' || slug === 'time-since') {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 8v4l3 2" />
      </svg>
    );
  }
  if (slug === 'pie-chart') {
    return (
      <svg {...common}>
        <path d="M12 4a8 8 0 1 0 8 8h-8V4Z" />
        <path d="M14 4.2A8 8 0 0 1 19.8 10H14V4.2Z" />
      </svg>
    );
  }
  if (slug === 'recently-created' || slug === 'group-by') {
    return (
      <svg {...common}>
        <path d="M5 19V10M12 19V5M19 19v-7" />
      </svg>
    );
  }
  if (slug === 'time-tracking') {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 8v5h4" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
      <circle cx="17" cy="9" r="2.2" />
      <path d="M16 19a4.2 4.2 0 0 1 5-4" />
    </svg>
  );
}

export default function ReportsGallery({
  project,
  projects,
  projectCounts,
  myIssuesCount,
  currentUser,
}) {
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();

  const visible = useMemo(() => {
    if (!needle) return REPORTS;
    return REPORTS.filter((report) =>
      `${report.name} ${report.description} ${report.section}`.toLowerCase().includes(needle)
    );
  }, [needle]);

  return (
    <ReportShell
      project={project}
      projects={projects}
      projectCounts={projectCounts}
      myIssuesCount={myIssuesCount}
      currentUser={currentUser}
      title="Reports"
      subtitle="Charts for how work is created, resolved, and shared across this project."
      breadcrumb={[
        { label: 'Projects', href: '/projects' },
        { label: project.name, href: `/projects/${project.id}/summary` },
        { label: 'Reports' },
      ]}
    >
      <div className="search-field rpt-search">
        <SearchIcon />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search reports"
          aria-label="Search reports"
        />
      </div>

      {visible.length === 0 ? (
        <p className="rpt-empty">No reports match “{query.trim()}”.</p>
      ) : (
        REPORT_SECTIONS.map((section) => {
          const cards = visible.filter((report) => report.section === section);
          if (!cards.length) return null;
          return (
            <section key={section} className="rpt-section" aria-labelledby={`reports-${section}`}>
              <h2 id={`reports-${section}`}>{section}</h2>
              <div className="rpt-grid">
                {cards.map((report) => (
                  <Link
                    key={report.slug}
                    className="rpt-card"
                    href={`/projects/${project.id}/reports/${report.slug}`}
                  >
                    <span className="rpt-card-icon">
                      <ReportIcon slug={report.slug} />
                    </span>
                    <span>
                      <h3>{report.name}</h3>
                      <p>{report.description}</p>
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          );
        })
      )}
    </ReportShell>
  );
}

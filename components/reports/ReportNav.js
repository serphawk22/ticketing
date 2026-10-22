'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { REPORT_SECTIONS } from '@/lib/reportMasterCatalog';

export default function ReportNav({ currentSectionSlug = null, currentReportSlug = null }) {
  const pathname = usePathname();

  return (
    <nav className="rpt-nav-header" aria-label="Reporting Hub Navigation">
      <div className="rpt-nav-breadcrumbs">
        <Link href="/reports" className="rpt-crumb-link">
          Reporting Hub
        </Link>
        {currentSectionSlug && (
          <>
            <span className="rpt-crumb-sep">/</span>
            <Link href={`/reports/${currentSectionSlug}`} className="rpt-crumb-link">
              {REPORT_SECTIONS.find((s) => s.slug === currentSectionSlug)?.shortTitle || currentSectionSlug}
            </Link>
          </>
        )}
        {currentReportSlug && (
          <>
            <span className="rpt-crumb-sep">/</span>
            <span className="rpt-crumb-current">{currentReportSlug}</span>
          </>
        )}
      </div>

      <div className="rpt-nav-sections">
        {REPORT_SECTIONS.map((sec) => {
          const isActive = currentSectionSlug === sec.slug;
          return (
            <Link
              key={sec.slug}
              href={`/reports/${sec.slug}`}
              className={`rpt-sec-pill${isActive ? ' active' : ''}`}
              title={sec.title}
            >
              <span className="rpt-sec-badge">{sec.id}</span>
              <span className="rpt-sec-title">{sec.shortTitle}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}


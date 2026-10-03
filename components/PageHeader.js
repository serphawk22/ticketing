'use client';

import { Fragment } from 'react';
import Link from 'next/link';

/**
 * The heading block that opens every project tab.
 *
 * Summary, List, Calendar and Archived all want the same thing: a breadcrumb
 * for where you are, the project chip and title, an optional subtitle and
 * optional actions on the right. They each grew their own copy of this markup
 * and drifted -- the Archived page ended up on classes that exist nowhere in
 * the stylesheet, so it rendered with no padding and no typography. One
 * component keeps the spacing honest.
 *
 * `breadcrumb` entries are { label, href }. The final entry is always plain
 * text because there is nowhere further to go.
 */
export default function PageHeader({
  breadcrumb = [],
  title,
  project,
  icon,
  subtitle,
  actions,
  className = '',
}) {
  const lead =
    icon ||
    (project ? (
      <span
        className="project-icon project-icon-sm"
        style={{ background: project.color || 'var(--primary)' }}
        aria-hidden="true"
      >
        {(project.name || '?').charAt(0).toUpperCase()}
      </span>
    ) : null);

  return (
    <div className={`board-toolbar${className ? ` ${className}` : ''}`}>
      <div className="toolbar-title">
        {breadcrumb.length > 0 && (
          <nav className="breadcrumb" aria-label="Breadcrumb">
            {breadcrumb.map((crumb, i) => {
              const last = i === breadcrumb.length - 1;
              return (
                <Fragment key={`${crumb.label}-${i}`}>
                  {i > 0 && (
                    <span className="breadcrumb-sep" aria-hidden="true">
                      /
                    </span>
                  )}
                  {crumb.href && !last ? (
                    <Link href={crumb.href}>{crumb.label}</Link>
                  ) : (
                    <span>{crumb.label}</span>
                  )}
                </Fragment>
              );
            })}
          </nav>
        )}

        <div className="toolbar-title-row">
          {lead}
          <h1>{title}</h1>
        </div>

        {subtitle ? <p className="board-subtitle">{subtitle}</p> : null}
      </div>

      {actions ? <div className="toolbar-actions">{actions}</div> : null}
    </div>
  );
}
'use client';

import Link from 'next/link';

const TABS = [
  { key: 'summary', label: 'Summary' },
  { key: 'board', label: 'Board' },
  { key: 'list', label: 'List' },
  { key: 'calendar', label: 'Calendar' },
  { key: 'timeline', label: 'Timeline' },
  { key: 'reports', label: 'Reports' },
  { key: 'docs', label: 'Docs', soon: true },
  { key: 'attachments', label: 'Attachments', soon: true },
  { key: 'archived', label: 'Archived' },
];

const HREF = {
  summary: (id) => `/projects/${id}/summary`,
  board: (id) => `/?project=${id}`,
  list: (id) => `/projects/${id}/list`,
  calendar: (id) => `/projects/${id}/calendar`,
  timeline: (id) => `/projects/${id}/timeline`,
  reports: (id) => `/projects/${id}/reports`,
  docs: (id) => `/projects/${id}/docs`,
  attachments: (id) => `/projects/${id}/attachments`,
  archived: (id) => `/projects/${id}/archived`,
};

/**
 * Every tab is a real link and every tab looks the same until it is the active
 * one. The four unbuilt views used to render as inert, lighter spans, which
 * read as "half disabled" next to the working tabs; they now go to a Coming
 * soon page for the project, so the strip is uniform and nothing is a
 * dead-end.
 */
export default function ProjectTabs({ projectId, active = 'summary' }) {
  return (
    <div className="tab-bar project-tab-bar" role="tablist" aria-label="Project views">
      {TABS.map((tab) => (
        <Link
          key={tab.key}
          className={`tab${tab.key === active ? ' active' : ''}`}
          role="tab"
          aria-selected={tab.key === active}
          href={HREF[tab.key](projectId)}
          title={tab.soon ? `${tab.label} is coming soon` : undefined}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
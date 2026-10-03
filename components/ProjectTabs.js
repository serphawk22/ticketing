'use client';

import Link from 'next/link';

const TABS = [
  { key: 'summary', label: 'Summary' },
  { key: 'board', label: 'Board' },
  { key: 'list', label: 'List' },
  { key: 'calendar', label: 'Calendar' },
  { key: 'timeline', label: 'Timeline' },
  { key: 'reports', label: 'Reports' },
  { key: 'docs', label: 'Docs' },
  { key: 'attachments', label: 'Attachments' },
  { key: 'archived', label: 'Archived' },
];

const AVAILABLE = new Set(['summary', 'board', 'list', 'calendar', 'timeline', 'archived']);

const HREF = {
  summary: (id) => `/projects/${id}/summary`,
  board: (id) => `/?project=${id}`,
  list: (id) => `/projects/${id}/list`,
  calendar: (id) => `/projects/${id}/calendar`,
  timeline: (id) => `/projects/${id}/timeline`,
  archived: (id) => `/projects/${id}/archived`,
};

export default function ProjectTabs({ projectId, active = 'summary' }) {
  return (
    <div className="tab-bar project-tab-bar" role="tablist" aria-label="Project views">
      {TABS.map((tab) => {
        const enabled = AVAILABLE.has(tab.key);
        const isActive = tab.key === active;

        if (!enabled) {
          return (
            <span
              key={tab.key}
              className="tab is-disabled"
              role="tab"
              aria-selected="false"
              aria-disabled="true"
              title={`${tab.label} is not available yet`}
            >
              {tab.label}
            </span>
          );
        }

        return (
          <Link
            key={tab.key}
            className={`tab${isActive ? ' active' : ''}`}
            role="tab"
            aria-selected={isActive}
            href={HREF[tab.key](projectId)}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}

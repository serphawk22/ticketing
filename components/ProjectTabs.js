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
];

const AVAILABLE = new Set(['summary', 'board']);

export function tabHref(projectId, key) {
  return key === 'board' ? `/?project=${projectId}` : `/projects/${projectId}/summary`;
}

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
            href={tabHref(projectId, tab.key)}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}

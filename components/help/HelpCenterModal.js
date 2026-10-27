'use client';

import { useState, useEffect } from 'react';

const SECTIONS = [
  {
    id: 'tickets',
    title: 'Work Items & Board',
    icon: (
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
        <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
      </svg>
    ),
    content: (
      <div className="help-content-body">
        <h3>Managing Tickets & Work Items</h3>
        <p>Work items represent tasks, bugs, stories, and epics across your projects.</p>
        <ul>
          <li><strong>Creating Tickets</strong>: Click the blue <em>+ Create</em> button in the top navigation bar or project header. Set title, description, priority, and optional assignee.</li>
          <li><strong>Inline Editing</strong>: On the List and Board views, you can click directly on priority, status, assignee, or due dates to update them without opening full modals.</li>
          <li><strong>Parent & Subtask Hierarchy</strong>: Group related work under a parent ticket. Collapse or expand child items in the List view to keep your workspace organized.</li>
          <li><strong>Bulk Actions</strong>: In the List view, select multiple checkboxes to bulk-update status, priority, or assignee all at once.</li>
        </ul>
      </div>
    ),
  },
  {
    id: 'tasksheets',
    title: 'Task Sheets & Reflection',
    icon: (
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
      </svg>
    ),
    content: (
      <div className="help-content-body">
        <h3>Daily Task & Happy Sheets</h3>
        <p>Keep track of your daily accomplishments, blockers, and team reflections.</p>
        <ul>
          <li><strong>Task Sheet</strong>: Submit daily logs detailing projects worked on, hours spent, task descriptions, and any blockers preventing completion.</li>
          <li><strong>Happy Sheet</strong>: Share daily wins, goals, self-study achievements, and moments that made you or your teammates happy.</li>
          <li><strong>Sheet History</strong>: Navigate to <em>Sheet History</em> in the sidebar to review past submissions across the team and export work summaries.</li>
        </ul>
      </div>
    ),
  },
  {
    id: 'attendance',
    title: 'Attendance & Leaves',
    icon: (
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    ),
    content: (
      <div className="help-content-body">
        <h3>Attendance & Time Tracking</h3>
        <p>Manage clock-ins, view attendance history, and request leaves.</p>
        <ul>
          <li><strong>Clock In / Out</strong>: Use the attendance widget to log your daily start and end times accurately.</li>
          <li><strong>My Attendance</strong>: Check your monthly presence, work hours, breaks, and calculate attendance streaks from the sidebar.</li>
          <li><strong>Leave Requests</strong>: Apply for casual, sick, or earned leaves. Track review statuses and approvals from team administrators.</li>
        </ul>
      </div>
    ),
  },
  {
    id: 'reports',
    title: 'Reports Hub & Analytics',
    icon: (
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="20" x2="18" y2="10" />
        <line x1="12" y1="20" x2="12" y2="4" />
        <line x1="6" y1="20" x2="6" y2="14" />
      </svg>
    ),
    content: (
      <div className="help-content-body">
        <h3>Analytics & Reporting</h3>
        <p>Gain insights into project health, team velocity, and ticket distributions.</p>
        <ul>
          <li><strong>Reports Hub</strong>: Explore standard and catalog reports covering ticket aging, employee output, resolution time, and workload distribution.</li>
          <li><strong>Interactive Filters</strong>: Filter by date ranges, project scopes, statuses, or teams.</li>
          <li><strong>Automated Schedules</strong>: Configure recurring reports to be delivered via email on daily, weekly, or monthly schedules.</li>
        </ul>
      </div>
    ),
  },
];

export default function HelpCenterModal({ open, onClose }) {
  const [activeTab, setActiveTab] = useState('tickets');

  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const current = SECTIONS.find((s) => s.id === activeTab) || SECTIONS[0];

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="help-center-title">
      <div className="modal-panel help-center-modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-head-title-wrap">
            <h2 id="help-center-title" className="modal-title">Help Center & User Guide</h2>
            <p className="modal-subtitle">Learn how to navigate and make the most of Ticket Manager</p>
          </div>
          <button type="button" className="icon-btn modal-close" onClick={onClose} aria-label="Close dialog">
            ×
          </button>
        </div>

        <div className="help-center-body">
          <nav className="help-nav-sidebar" aria-label="Help topics">
            {SECTIONS.map((section) => (
              <button
                key={section.id}
                type="button"
                className={`help-nav-item${activeTab === section.id ? ' is-active' : ''}`}
                onClick={() => setActiveTab(section.id)}
              >
                <span className="help-nav-icon">{section.icon}</span>
                <span className="help-nav-label">{section.title}</span>
              </button>
            ))}
          </nav>

          <div className="help-content-pane">
            {current.content}
          </div>
        </div>

        <div className="modal-foot">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}


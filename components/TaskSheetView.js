'use client';

import { useState } from 'react';
import AppShell from '@/components/AppShell';
import PageHeader from '@/components/PageHeader';
import TaskSheetForm from '@/components/TaskSheetForm';
import HappySheetForm from '@/components/HappySheetForm';
import { ClipboardIcon, SmileIcon } from '@/components/AppShellIcons';

/**
 * The daily sheets as a page.
 *
 * Two cards, one page: the task sheet for the day's work and, right under it,
 * the happy sheet for the day's mood. They file independently so a person can
 * answer one without being dragged through the other, but they live together
 * because the habit is a daily one and a routine is easier to keep when it is
 * one place.
 */
export default function TaskSheetView({
  currentUser,
  projects,
  projectCounts,
  myIssuesCount,
  people,
  projectNames,
  defaults,
}) {
  const [submittedAt, setSubmittedAt] = useState(null);
  const [happyAt, setHappyAt] = useState(null);

  return (
    <AppShell
      currentUser={currentUser}
      projects={projects}
      projectCounts={projectCounts}
      myIssuesCount={myIssuesCount}
      view="task-sheet"
      onCreate={() => {}}
    >
      <div className="board">
        <PageHeader
          breadcrumb={[{ label: 'Issues', href: '/' }, { label: 'Task Sheet' }]}
          title="Task Sheet"
          icon={<ClipboardIcon />}
          subtitle={
            submittedAt
              ? `Submitted just now · ${submittedAt}`
              : 'One row per day: what you worked on, on which project, for how long.'
          }
        />

        <div className="list-frame ts-frame">
          <div className="ts-card">
            <TaskSheetForm
              people={people}
              projects={projectNames}
              defaults={defaults}
              onSubmitted={() => setSubmittedAt(new Date().toLocaleTimeString())}
            />
          </div>
        </div>

        <div className="list-frame ts-frame">
          <div className="ts-card">
            <div className="ts-section-heading">
              <SmileIcon size={16} />
              <div>
                <h2 className="ts-section-title">Happy Sheet</h2>
                <p className="ts-section-sub">
                  {happyAt
                    ? `Submitted just now · ${happyAt}`
                    : 'Two small questions about what felt good today.'}
                </p>
              </div>
            </div>
            <HappySheetForm
              people={people}
              defaults={defaults}
              onSubmitted={() => setHappyAt(new Date().toLocaleTimeString())}
            />
          </div>
        </div>
      </div>
    </AppShell>
  );
}
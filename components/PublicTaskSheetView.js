'use client';

import { useState } from 'react';
import Link from 'next/link';
import TaskSheetForm from '@/components/TaskSheetForm';
import HappySheetForm from '@/components/HappySheetForm';
import { ClipboardIcon, SmileIcon } from '@/components/AppShellIcons';

/**
 * The task and happy sheets as a shared link.
 *
 * This is the Microsoft Forms replacement for whoever ends up on the other end
 * of it with no account to their name: no sidebar, no session, just the brand,
 * both cards, and the knowledge that the answers save with the name they pick.
 */
export default function PublicTaskSheetView({
  people,
  projects,
  projectNames,
  defaults,
  verifiedEmployee = null,
  csrfToken = '',
  tokenError = null,
  workCategories = [],
}) {
  const [taskNote, setTaskNote] = useState(null);
  const [taskName, setTaskName] = useState('');
  const [happyNote, setHappyNote] = useState(null);
  const [happyName, setHappyName] = useState('');

  return (
    <div className="auth-container ts-public">
      <main>
        <div className="auth-card ts-public-card">
          <header className="auth-brand ts-public-brand">
            <Link href="/login" className="logo-tile" aria-label="Ticket Manager">
              T
            </Link>
            <h1 className="ts-public-title">Task Sheet</h1>
          </header>

          {!verifiedEmployee ? (
            <div style={{ padding: '16px 0' }}>
              <div className="ts-banner" role="alert" style={{ marginBottom: 14 }}>
                <strong>
                  {tokenError === 'invalid' || tokenError === 'expired'
                    ? 'This Task Sheet link is invalid, expired, or revoked.'
                    : 'Employee Task Sheet Link Required.'}
                </strong>{' '}
                Shared Task Sheets are secured with an individual employee link. Request your personal link from an Administrator or sign in to submit your Daily Task Sheet.
              </div>
              <Link href="/login" className="btn btn-primary">
                Sign in to your account
              </Link>
            </div>
          ) : (
            <>
              <p className="sub">
                {taskNote ? (
                  <>
                    Submitted just now{taskName ? ` by ${taskName}` : ''} · {taskNote}.
                  </>
                ) : (
                  `Signed in via verified link as ${verifiedEmployee.name} · Record today's completed work, pending tasks, and blockers.`
                )}
              </p>
              <TaskSheetForm
                people={people}
                projects={projects || projectNames}
                projectNames={projectNames}
                defaults={defaults}
                identityLocked={true}
                csrfToken={csrfToken}
                workCategories={workCategories}
                onSubmitted={(name) => {
                  setTaskNote(new Date().toLocaleTimeString());
                  setTaskName(name || '');
                }}
              />
            </>
          )}
        </div>

        {verifiedEmployee && (
          <div className="auth-card ts-public-card">
            <header className="ts-public-happy-head">
              <span className="ts-public-happy-icon" aria-hidden="true">
                <SmileIcon size={18} />
              </span>
              <div>
                <h1 className="ts-public-h1">Happy Sheet</h1>
                <p className="ts-public-sub">
                  {happyNote ? (
                    <>
                      Submitted just now{happyName ? ` by ${happyName}` : ''} · {happyNote}.
                    </>
                  ) : (
                    'Two small questions about what felt good today.'
                  )}
                </p>
              </div>
            </header>
            <HappySheetForm
              people={people}
              defaults={defaults}
              onSubmitted={(name) => {
                setHappyNote(new Date().toLocaleTimeString());
                setHappyName(name || '');
              }}
            />
            <footer className="ts-public-foot ts-public-foot-alone">
              <SmileIcon size={13} />
              <span>Submitted via your verified employee Task Sheet session.</span>
            </footer>
          </div>
        )}
      </main>
    </div>
  );
}
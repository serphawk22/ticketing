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
export default function PublicTaskSheetView({ people, projectNames, defaults }) {
  const [taskNote, setTaskNote] = useState(null);
  const [taskName, setTaskName] = useState('');
  const [happyNote, setHappyNote] = useState(null);
  const [happyName, setHappyName] = useState('');

  return (
    <div className="auth-container ts-public">
      <main>
        <div className="auth-card ts-public-card">
          <header className="auth-brand">
            <Link href="/login" className="logo-tile" aria-label="Ticket Manager">
              T
            </Link>
            <h1>Task Sheet</h1>
          </header>
          <p className="sub">
            {taskNote ? (
              <>
                Submitted just now{taskName ? ` by ${taskName}` : ''} · {taskNote}.
              </>
            ) : (
              'One row per day: what you worked on, on which project, and for how long.'
            )}
          </p>
          <TaskSheetForm
            people={people}
            projects={projectNames}
            defaults={defaults}
            onSubmitted={(name) => {
              setTaskNote(new Date().toLocaleTimeString());
              setTaskName(name || '');
            }}
          />
        </div>

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
            <span>Fills in without signing in — your answer is saved with the name you pick.</span>
          </footer>
        </div>
      </main>
    </div>
  );
}
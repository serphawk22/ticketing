'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useTheme } from './ThemeProvider';
import ChangePasswordModal from './ChangePasswordModal';

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 8.9 19a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 8.9a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
    </svg>
  );
}

function PersonIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="11" width="16" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
    </svg>
  );
}

function MonitorIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </svg>
  );
}

export default function SettingsMenu({ onToast }) {
  const [open, setOpen] = useState(false);
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const { mode, setMode } = useTheme();
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <>
      <div className="settings-menu-wrap" ref={ref}>
        <button
          type="button"
          className="icon-btn settings-btn"
          aria-label="Settings"
          title="Settings"
          aria-haspopup="true"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <SettingsIcon />
        </button>

        {open && (
          <div className="menu-popup settings-menu" role="menu">
            <div className="settings-menu-section-label">Account & Preferences</div>
            <Link
              href="/profile"
              className="menu-item"
              role="menuitem"
              onClick={() => setOpen(false)}
            >
              <PersonIcon />
              <span className="menu-item-text">Profile</span>
            </Link>

            <button
              type="button"
              className="menu-item"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                setPasswordModalOpen(true);
              }}
            >
              <LockIcon />
              <span className="menu-item-text">Change Password</span>
            </button>

            <div className="menu-sep" />

            <div className="settings-theme-group">
              <span className="settings-theme-label">Theme</span>
              <div className="theme-segmented-ctrl" role="radiogroup" aria-label="Theme mode">
                <button
                  type="button"
                  className={`theme-segment${mode === 'light' ? ' is-active' : ''}`}
                  onClick={() => setMode('light')}
                  role="radio"
                  aria-checked={mode === 'light'}
                  title="Light mode"
                >
                  <SunIcon />
                  <span>Light</span>
                </button>
                <button
                  type="button"
                  className={`theme-segment${mode === 'dark' ? ' is-active' : ''}`}
                  onClick={() => setMode('dark')}
                  role="radio"
                  aria-checked={mode === 'dark'}
                  title="Dark mode"
                >
                  <MoonIcon />
                  <span>Dark</span>
                </button>
                <button
                  type="button"
                  className={`theme-segment${mode === 'system' ? ' is-active' : ''}`}
                  onClick={() => setMode('system')}
                  role="radio"
                  aria-checked={mode === 'system'}
                  title="System preference"
                >
                  <MonitorIcon />
                  <span>Auto</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <ChangePasswordModal
        open={passwordModalOpen}
        onClose={() => setPasswordModalOpen(false)}
        onSuccess={() => onToast?.({ message: 'Password changed successfully.' })}
      />
    </>
  );
}


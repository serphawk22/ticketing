'use client';

import { useTheme } from './ThemeProvider';

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
    </svg>
  );
}

export default function ThemeToggle() {
  const { resolved, setMode } = useTheme();

  function handleToggle() {
    const next = resolved === 'dark' ? 'light' : 'dark';
    setMode(next);
  }

  const CurrentIcon = resolved === 'dark' ? SunIcon : MoonIcon;

  return (
    <button
      type="button"
      className="icon-btn theme-toggle-btn"
      onClick={handleToggle}
      aria-label={`Switch to ${resolved === 'dark' ? 'light' : 'dark'} mode`}
      title={`Switch to ${resolved === 'dark' ? 'light' : 'dark'} mode`}
    >
      <CurrentIcon />
    </button>
  );
}

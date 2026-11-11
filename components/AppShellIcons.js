'use client';

/**
 * The clipboard the Task Sheet row in the sidebar uses.
 */
export function ClipboardIcon({ size = 16 }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M16 6V5a1 1 0 0 0-1-1H9a1 1 0 0 0-1 1v1" />
      <rect x="5" y="6" width="14" height="15" rx="1.5" />
      <path d="M9 11.5h6M9 15.5h4" />
    </svg>
  );
}

/** A plain smiley for the happy sheet's heading and history. */
export function SmileIcon({ size = 16 }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 14.5a4.2 4.2 0 0 0 7 0" />
      <path d="M9 9.5h.01M15 9.5h.01" />
    </svg>
  );
}

/** A little bar chart for the sheet history's admin entry point. */
export function BarChartIcon({ size = 16 }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 20h18" />
      <path d="M5.5 20v-6" />
      <path d="M10 20V7" />
      <path d="M14.5 20v-9" />
      <path d="M19 20V10" />
    </svg>
  );
}

/** People icon for employees and workforce attendance. */
export function PeopleIcon({ size = 16 }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

/** Sparkles AI icon. */
export function SparklesIcon({ size = 16, className = '' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 2L14.4 7.6L20 10L14.4 12.4L12 18L9.6 12.4L4 10L9.6 7.6L12 2Z" />
      <path d="M5 2L6 4.5L8.5 5.5L6 6.5L5 9L4 6.5L1.5 5.5L4 4.5L5 2Z" opacity="0.75" />
    </svg>
  );
}


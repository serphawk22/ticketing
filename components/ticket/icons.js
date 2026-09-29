'use client';

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
};

function Svg({ size = 16, children, ...rest }) {
  return (
    <svg {...base} width={size} height={size} {...rest}>
      {children}
    </svg>
  );
}

export const ChevronDown = (p) => (
  <Svg {...p}><path d="M6 9l6 6 6-6" /></Svg>
);
export const ChevronRight = (p) => (
  <Svg {...p}><path d="M9 6l6 6-6 6" /></Svg>
);
export const ChevronUp = (p) => (
  <Svg {...p}><path d="M6 15l6-6 6 6" /></Svg>
);
export const ChevronLeft = (p) => (
  <Svg {...p}><path d="M15 6l-6 6 6 6" /></Svg>
);
export const CloseIcon = (p) => (
  <Svg {...p}><path d="M18 6L6 18M6 6l12 12" /></Svg>
);
export const EyeIcon = (p) => (
  <Svg {...p}><path d="M1.5 12S5 5.5 12 5.5 22.5 12 22.5 12 19 18.5 12 18.5 1.5 12 1.5 12z" /><circle cx="12" cy="12" r="3" /></Svg>
);
export const ShareIcon = (p) => (
  <Svg {...p}><path d="M4 12v7a1 1 0 001 1h14a1 1 0 001-1v-7" /><path d="M16 6l-4-4-4 4" /><path d="M12 2v14" /></Svg>
);
export const DotsIcon = (p) => (
  <Svg {...p} fill="currentColor" stroke="none"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></Svg>
);
export const RestoreIcon = (p) => (
  <Svg {...p}><path d="M15 3h6v6" /><path d="M9 21H3v-6" /><path d="M21 3l-7 7" /><path d="M3 21l7-7" /></Svg>
);
export const PlusIcon = (p) => (
  <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>
);
export const PaperclipIcon = (p) => (
  <Svg {...p}><path d="M21.4 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" /></Svg>
);
export const LinkIcon = (p) => (
  <Svg {...p}><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" /></Svg>
);
export const LightningIcon = (p) => (
  <Svg {...p}><path d="M13 2L4.5 13.5H11l-1 8.5 8.5-11.5H12l1-8.5z" /></Svg>
);
export const GearIcon = (p) => (
  <Svg {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.6 15a1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.6a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9c.14.35.4.64.75.82" /></Svg>
);
export const CheckIcon = (p) => (
  <Svg {...p}><path d="M20 6L9 17l-5-5" /></Svg>
);
export const TrashIcon = (p) => (
  <Svg {...p}><path d="M3 6h18" /><path d="M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2" /><path d="M19 6l-1 14a1 1 0 01-1 1H7a1 1 0 01-1-1L5 6" /><path d="M10 11v6M14 11v6" /></Svg>
);
export const PencilIcon = (p) => (
  <Svg {...p}><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4 12.5-12.5z" /></Svg>
);
export const BoldIcon = (p) => (
  <Svg {...p}><path d="M6 4h7a4 4 0 010 8H6z" /><path d="M6 12h8a4 4 0 010 8H6z" /></Svg>
);
export const ItalicIcon = (p) => (
  <Svg {...p}><path d="M19 4h-9" /><path d="M14 20H5" /><path d="M15 4L9 20" /></Svg>
);
export const ListIcon = (p) => (
  <Svg {...p}><path d="M8 6h13M8 12h13M8 18h13" /><path d="M3 6h.01M3 12h.01M3 18h.01" /></Svg>
);
export const LinkSmallIcon = (p) => (
  <Svg {...p}><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" /></Svg>
);
export const CalendarIcon = (p) => (
  <Svg {...p}><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></Svg>
);
export const ClockIcon = (p) => (
  <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Svg>
);
export const TagIcon = (p) => (
  <Svg {...p}><path d="M20.6 13.4L12 22l-9-9V3h10l7.6 7.6a2 2 0 010 2.8z" /><path d="M7.5 7.5h.01" /></Svg>
);
export const PersonOutlineIcon = (p) => (
  <Svg {...p}><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" /></Svg>
);
export const SortDescIcon = (p) => (
  <Svg {...p}><path d="M11 5h10M11 9h7M11 13h4" /><path d="M3 17l3 3 3-3" /><path d="M6 4v16" /></Svg>
);
export const HistoryIcon = (p) => (
  <Svg {...p}><path d="M3 3v6h6" /><path d="M3.5 13a9 9 0 102.1-6.4L3 9" /><path d="M12 7v5l4 2" /></Svg>
);
export const CommentIcon = (p) => (
  <Svg {...p}><path d="M21 11.5a8.4 8.4 0 01-9 8.4 8.5 8.5 0 01-3.8-.9L3 21l1.9-5.1A8.4 8.4 0 013 11.5 8.5 8.5 0 0112 3a8.4 8.4 0 019 8.5z" /></Svg>
);
export const ArrowRightIcon = (p) => (
  <Svg {...p}><path d="M5 12h14M13 6l6 6-6 6" /></Svg>
);
export const UploadIcon = (p) => (
  <Svg {...p}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><path d="M7 9l5-5 5 5" /><path d="M12 4v12" /></Svg>
);

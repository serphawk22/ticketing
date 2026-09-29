import {
  PRIORITY_META,
  STATUS_META,
  PRIORITY_ORDER,
  STATUS_ORDER,
  TYPE_META,
  TYPE_ORDER,
  DONE_STATUSES,
  PROJECT_COLORS,
  RELATION_META,
  RELATION_ORDER,
  CHILD_RELATION,
  FIELD_META,
  initials,
  colorFor,
  formatShortDate,
  formatFullDateTime,
  formatListDateTime,
  formatDuration,
  parseDuration,
  ticketKey,
} from '../lib/ticketMeta';

export {
  PRIORITY_META,
  STATUS_META,
  PRIORITY_ORDER,
  STATUS_ORDER,
  TYPE_META,
  TYPE_ORDER,
  DONE_STATUSES,
  PROJECT_COLORS,
  RELATION_META,
  RELATION_ORDER,
  CHILD_RELATION,
  FIELD_META,
  initials,
  colorFor,
  formatShortDate,
  formatFullDateTime,
  formatListDateTime,
  formatDuration,
  parseDuration,
  ticketKey,
};

export function TypeIcon({ type, size = 14 }) {
  const meta = TYPE_META[type] || TYPE_META.task;
  const common = {
    viewBox: '0 0 16 16',
    width: size,
    height: size,
    'aria-hidden': 'true',
  };

  if (meta.glyph === 'triangle') {
    return (
      <svg {...common}>
        <path d="M8 1.5 15 14H1L8 1.5Z" fill={meta.color} />
      </svg>
    );
  }
  if (meta.glyph === 'book') {
    return (
      <svg {...common}>
        <rect x="2" y="2" width="12" height="12" rx="2" fill={meta.color} />
        <path d="M5 8h6M8 5v6" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <rect x="2" y="2" width="12" height="12" rx="2" fill={meta.color} />
      <path d="M5.5 8.2 7 9.7l3.5-3.7" stroke="#fff" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function PriorityIcon({ color, arrow }) {
  const common = { fill: color };
  if (arrow === 'up') {
    return (
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <path d="M8 1.5 15 14H1L8 1.5Z" {...common} />
      </svg>
    );
  }
  if (arrow === 'down') {
    return (
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <path d="M8 14.5 1 2h14L8 14.5Z" {...common} />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M8 1.5 15 14H1L8 1.5Z" {...common} />
      <rect x="7" y="6" width="2" height="5" fill="#fff" />
    </svg>
  );
}

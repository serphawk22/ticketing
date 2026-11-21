import {
  PRIORITY_META,
  STATUS_META,
  PRIORITY_ORDER,
  STATUS_ORDER,
  STATUS_PROGRESS,
  CATEGORY_ORDER,
  RESOLUTION_ORDER,
  LOZENGE_TINTS,
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
  formatISTDateTime,
  formatListDateTime,
  formatListDate,
  formatDuration,
  parseDuration,
  ticketKey,
  relationLabelFor,
  INCLUSION_META,
  INCLUSION_ORDER,
  IMPORTANCE_META,
  IMPORTANCE_ORDER,
} from '../lib/ticketMeta';

export {
  PRIORITY_META,
  STATUS_META,
  PRIORITY_ORDER,
  STATUS_ORDER,
  STATUS_PROGRESS,
  CATEGORY_ORDER,
  RESOLUTION_ORDER,
  LOZENGE_TINTS,
  TYPE_META,
  TYPE_ORDER,
  DONE_STATUSES,
  PROJECT_COLORS,
  RELATION_META,
  RELATION_ORDER,
  relationLabelFor,
  CHILD_RELATION,
  FIELD_META,
  initials,
  colorFor,
  formatShortDate,
  formatFullDateTime,
  formatISTDateTime,
  formatListDateTime,
  formatListDate,
  formatDuration,
  parseDuration,
  ticketKey,
  INCLUSION_META,
  INCLUSION_ORDER,
  IMPORTANCE_META,
  IMPORTANCE_ORDER,
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
  // Medium (and anything without an arrow) is Jira's diamond with a
  // horizontal bar, read as an "equals" sign of medium severity.
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M8 1.5 15 14H1L8 1.5Z" {...common} />
      <rect x="5.5" y="7" width="5" height="2" fill="#fff" />
    </svg>
  );
}

export function ImportanceIcon({ color, level = 'medium', size = 14 }) {
  const norm = String(level || 'medium').toLowerCase();
  const c = color || IMPORTANCE_META[norm]?.color || '#d97706';

  if (norm === 'critical') {
    return (
      <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
        <path d="M8 1.5 14.5 8 8 14.5 1.5 8Z" fill={c} stroke={c} strokeWidth="1" strokeLinejoin="round" />
        <circle cx="8" cy="8" r="2.2" fill="#fff" />
      </svg>
    );
  }
  if (norm === 'high') {
    return (
      <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
        <path d="M8 1.5 14.5 8 8 14.5 1.5 8Z" fill={c} stroke={c} strokeWidth="1" strokeLinejoin="round" />
        <path d="M8 4.5v5M8 11.5v.5" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  if (norm === 'low') {
    return (
      <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
        <path d="M8 2.5 13.5 8 8 13.5 2.5 8Z" fill="none" stroke={c} strokeWidth="2" strokeLinejoin="round" />
      </svg>
    );
  }
  // Medium
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
      <path d="M8 2 14 8 8 14 2 8Z" fill={c} fillOpacity="0.4" stroke={c} strokeWidth="1.5" strokeLinejoin="round" />
      <rect x="5.5" y="7.2" width="5" height="1.6" rx="0.8" fill={c} />
    </svg>
  );
}

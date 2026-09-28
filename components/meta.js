export {
  PRIORITY_META,
  STATUS_META,
  PRIORITY_ORDER,
  STATUS_ORDER,
  PROJECT_COLORS,
  initials,
  colorFor,
  formatShortDate,
  formatFullDateTime,
} from '../lib/ticketMeta';

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

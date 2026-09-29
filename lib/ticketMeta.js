export const PRIORITY_META = {
  urgent: {
    label: 'Highest',
    color: '#bf2600',
    bg: '#ffebe6',
    text: '#bf2600',
    arrow: 'up',
  },
  high: {
    label: 'High',
    color: '#de350b',
    bg: '#ffebe6',
    text: '#bf2600',
    arrow: 'up',
  },
  medium: {
    label: 'Medium',
    color: '#ffc400',
    bg: '#fffae6',
    text: '#974f0c',
    arrow: 'right',
  },
  low: {
    label: 'Low',
    color: '#00a3bf',
    bg: '#e3faff',
    text: '#0065ff',
    arrow: 'down',
  },
};

export const STATUS_META = {
  open: { label: 'To Do', color: '#579dff', bg: '#deebff', text: '#0747a6' },
  in_progress: {
    label: 'In Progress',
    color: '#ffc400',
    bg: '#fffae6',
    text: '#974f0c',
  },
  resolved: {
    label: 'Done',
    color: '#00b8d0',
    bg: '#e3faff',
    text: '#0065ff',
  },
  closed: { label: 'Closed', color: '#c1c7d0', bg: '#ebecf0', text: '#5e6c84' },
};

export const PRIORITY_ORDER = ['urgent', 'high', 'medium', 'low'];
export const STATUS_ORDER = ['open', 'in_progress', 'resolved', 'closed'];

export const TYPE_META = {
  task: { label: 'Task', color: '#4FADE6', text: '#0747a6', bg: '#deebff', glyph: 'square' },
  bug: { label: 'Bug', color: '#E2483D', text: '#BF2600', bg: '#ffebe6', glyph: 'triangle' },
  story: { label: 'Story', color: '#6554C0', text: '#403294', bg: '#EAE6FF', glyph: 'book' },
  epic: { label: 'Epic', color: '#1B7F79', text: '#00665F', bg: '#DCFFF1', glyph: 'book' },
};

export const TYPE_ORDER = ['task', 'bug', 'story', 'epic'];

// The statuses that count as finished work, used by the project summary.
export const DONE_STATUSES = ['resolved', 'closed'];

export const PROJECT_COLORS = [
  '#0c66e4',
  '#36b37e',
  '#6554c0',
  '#ff5630',
  '#ff8b00',
  '#00b8d0',
  '#de350b',
  '#57d9a3',
];

const AVATAR_COLORS = [
  '#1d7f8c',
  '#c25100',
  '#6e5dc6',
  '#0c66e4',
  '#1d7f8c',
  '#6e5dc6',
  '#c25100',
  '#0c66e4',
  '#6e5dc6',
  '#1d7f8c',
];

export function initials(name) {
  if (!name) return '?';
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

export function colorFor(name) {
  if (!name) return AVATAR_COLORS[9];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function toDate(value) {
  if (!value) return null;
  const d = new Date(String(value).trim().replace(' ', 'T') + 'Z');
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatShortDate(value) {
  const d = toDate(value);
  if (!d) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function formatFullDateTime(value) {
  const d = toDate(value);
  if (!d) return '';
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) +
    ' · ' +
    d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

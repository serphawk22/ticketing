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

// Timestamps are stored and returned as UTC on both drivers, so they are also
// rendered in UTC with a fixed locale. Left to the environment, the server and
// the browser disagree: Node resolved en-IN here and printed "5:30 pm" while
// Chrome resolved en-GB and printed "17:30", which React reports as a
// hydration mismatch. Pinning both ends removes the class of bug entirely.
const RENDER = { timeZone: 'UTC' };

export function formatShortDate(value) {
  const d = toDate(value);
  if (!d) return '';
  return d.toLocaleDateString('en-US', { ...RENDER, month: 'short', day: 'numeric' });
}

export function formatFullDateTime(value) {
  const d = toDate(value);
  if (!d) return '';
  return d.toLocaleDateString('en-US', { ...RENDER, weekday: 'short', month: 'short', day: 'numeric' }) +
    ' · ' +
    d.toLocaleTimeString('en-US', { ...RENDER, hour: 'numeric', minute: '2-digit' });
}

export function formatListDateTime(value) {
  const d = toDate(value);
  if (!d) return '';
  return (
    d.toLocaleDateString('en-US', {
      ...RENDER,
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }) +
    ', ' +
    d.toLocaleTimeString('en-US', { ...RENDER, hour: 'numeric', minute: '2-digit' })
  );
}

export function ticketKey(ticket) {
  const prefix = ticket.project_key || 'TM';
  return `${prefix}-${ticket.id}`;
}

// Describes every field the detail modal can write, so the API and the activity
// feed agree on permissions and on how a change is rendered.
export const FIELD_META = {
  title: { label: 'Title', kind: 'text', open: true },
  description: { label: 'Description', kind: 'text', open: true },
  status: { label: 'Status', kind: 'status', open: true },
  priority: { label: 'Priority', kind: 'priority', open: true },
  labels: { label: 'Labels', kind: 'text', open: true },
  due_date: { label: 'Due date', kind: 'text', open: true },
  start_date: { label: 'Start date', kind: 'text', open: true },
  estimate_seconds: { label: 'Estimate', kind: 'text', open: true },
  employee_id: { label: 'Assignee', kind: 'person', open: false },
  type: { label: 'Issue type', kind: 'status', open: false },
  category: { label: 'Category', kind: 'text', open: false },
  team: { label: 'Team', kind: 'text', open: false },
  budget: { label: 'Budget', kind: 'text', open: false },
};

export const RELATION_META = {
  parent_of: { label: 'parent of', inverse: 'child_of' },
  child_of: { label: 'is child of', inverse: 'parent_of' },
  blocks: { label: 'blocks', inverse: 'blocked_by' },
  blocked_by: { label: 'is blocked by', inverse: 'blocks' },
  relates_to: { label: 'relates to', inverse: 'relates_to' },
  duplicates: { label: 'duplicates', inverse: 'duplicated_by' },
  duplicated_by: { label: 'is duplicated by', inverse: 'duplicates' },
};

export const RELATION_ORDER = [
  'relates_to',
  'blocks',
  'blocked_by',
  'duplicates',
  'duplicated_by',
];

// Parenting is its own relationship rather than a flavour of "blocks", because
// the modal shows children and plain links in separate sections.
export const CHILD_RELATION = 'parent_of';

export function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  if (!total) return '0m';
  const h = Math.floor(total / 3600);
  const m = Math.round((total % 3600) / 60);
  if (!h) return `${m}m`;
  if (!m) return `${h}h`;
  return `${h}h ${m}m`;
}

export function parseDuration(text) {
  const raw = String(text || '').trim().toLowerCase();
  if (!raw) return 0;
  const h = raw.match(/(\d+(?:\.\d+)?)\s*h/);
  const m = raw.match(/(\d+(?:\.\d+)?)\s*m/);
  const total = (h ? parseFloat(h[1]) * 3600 : 0) + (m ? parseFloat(m[1]) * 60 : 0);
  return Math.round(total);
}

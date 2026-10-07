// The reports a Jira project page offers that this tracker can actually
// compute. Sprint, velocity, and version reports need sprints and releases,
// which the data model does not have, so they are not listed.

export const REPORTS = [
  {
    slug: 'created-vs-resolved',
    section: 'Issue analysis',
    title: 'Created vs Resolved',
    name: 'Created vs Resolved Issues Report',
    description: 'Shows how many work items were created and how many were resolved over a period.',
  },
  {
    slug: 'average-age',
    section: 'Issue analysis',
    title: 'Average Age',
    name: 'Average Age Report',
    description: 'Shows the average age of unresolved work items, grouped by a field you choose.',
  },
  {
    slug: 'pie-chart',
    section: 'Issue analysis',
    title: 'Pie Chart',
    name: 'Pie Chart Report',
    description: 'Shows the share of work items grouped by status, priority, type, assignee, or category.',
  },
  {
    slug: 'recently-created',
    section: 'Issue analysis',
    title: 'Recently Created',
    name: 'Recently Created Issues Report',
    description: 'Shows the rate at which work items are being created, and lists the newest ones.',
  },
  {
    slug: 'resolution-time',
    section: 'Issue analysis',
    title: 'Resolution Time',
    name: 'Resolution Time Report',
    description: 'Shows how long work items take to reach Done or Closed.',
  },
  {
    slug: 'group-by',
    section: 'Issue analysis',
    title: 'Group By',
    name: 'Single Level Group By Report',
    description: 'Groups work items by one field and shows the count and share of each group.',
  },
  {
    slug: 'time-since',
    section: 'Issue analysis',
    title: 'Time Since',
    name: 'Time Since Issues Report',
    description: 'Shows how long ago work items were created or last updated.',
  },
  {
    slug: 'user-workload',
    section: 'Forecast & management',
    title: 'User Workload',
    name: 'User Workload Report',
    description: 'Shows how unresolved work is spread across assignees.',
  },
  {
    slug: 'time-tracking',
    section: 'Forecast & management',
    title: 'Time Tracking',
    name: 'Time Tracking Report',
    description: 'Compares original estimates with the time that has been logged.',
  },
  {
    slug: 'cumulative-flow',
    section: 'Agile',
    title: 'Cumulative Flow',
    name: 'Cumulative Flow Diagram',
    description: 'Shows how many work items sit in each status as the days go by.',
  },
];

export const REPORT_SECTIONS = ['Issue analysis', 'Forecast & management', 'Agile'];

const DAY_OPTIONS = [
  { value: '7', label: 'Last 7 days' },
  { value: '14', label: 'Last 14 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '60', label: 'Last 60 days' },
  { value: '90', label: 'Last 90 days' },
];

const PERIOD_OPTIONS = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
];

const GROUP_OPTIONS = [
  { value: 'status', label: 'Status' },
  { value: 'priority', label: 'Priority' },
  { value: 'type', label: 'Issue type' },
  { value: 'assignee', label: 'Assignee' },
  { value: 'category', label: 'Category' },
];

const SCOPE_OPTIONS = [
  { value: 'all', label: 'All work items' },
  { value: 'unresolved', label: 'Unresolved only' },
];

const FIELD_OPTIONS = [
  { value: 'created', label: 'Created' },
  { value: 'updated', label: 'Updated' },
];

const WITHIN_OPTIONS = [
  { value: '30', label: 'Resolved in the last 30 days' },
  { value: '90', label: 'Resolved in the last 90 days' },
  { value: 'all', label: 'Resolved at any time' },
];

export const REPORT_FILTERS = {
  'created-vs-resolved': [
    { key: 'days', label: 'Date range', options: DAY_OPTIONS },
    { key: 'period', label: 'Period', options: PERIOD_OPTIONS },
  ],
  'average-age': [{ key: 'group', label: 'Group by', options: GROUP_OPTIONS }],
  'pie-chart': [
    { key: 'group', label: 'Statistic type', options: GROUP_OPTIONS },
    { key: 'scope', label: 'Work items', options: SCOPE_OPTIONS },
  ],
  'recently-created': [{ key: 'days', label: 'Date range', options: DAY_OPTIONS }],
  'resolution-time': [{ key: 'within', label: 'Resolved', options: WITHIN_OPTIONS }],
  'group-by': [{ key: 'group', label: 'Group by', options: GROUP_OPTIONS }],
  'time-since': [{ key: 'field', label: 'Date field', options: FIELD_OPTIONS }],
  'cumulative-flow': [{ key: 'days', label: 'Date range', options: DAY_OPTIONS }],
  'user-workload': [],
  'time-tracking': [],
};

export function getReport(slug) {
  return REPORTS.find((report) => report.slug === slug) || null;
}

function one(value) {
  return Array.isArray(value) ? value[0] : value;
}

export function parseReportOptions(slug, query = {}) {
  const read = (key) => one(query[key]);
  const daysRaw = Number(read('days'));
  const days = [7, 14, 30, 60, 90].includes(daysRaw) ? daysRaw : slug === 'recently-created' ? 14 : 30;
  const period = ['daily', 'weekly', 'monthly'].includes(read('period')) ? read('period') : 'daily';
  const fallbackGroup = slug === 'average-age' ? 'priority' : 'status';
  const group = GROUP_OPTIONS.some((option) => option.value === read('group')) ? read('group') : fallbackGroup;
  const scope = read('scope') === 'unresolved' ? 'unresolved' : 'all';
  const field = read('field') === 'updated' ? 'updated' : 'created';
  const within = ['30', '90', 'all'].includes(read('within')) ? read('within') : '90';
  return { days, period, group, scope, field, within };
}

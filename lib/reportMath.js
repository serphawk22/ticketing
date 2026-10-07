import {
  STATUS_META,
  STATUS_ORDER,
  PRIORITY_META,
  PRIORITY_ORDER,
  TYPE_META,
  TYPE_ORDER,
  CATEGORY_ORDER,
  DONE_STATUSES,
  colorFor,
  formatListDateTime,
  formatDuration,
  ticketKey,
} from './ticketMeta';

const DONE = new Set(DONE_STATUSES);

// Timestamps are stored as naive UTC, the same shape ticketMeta parses. Report
// buckets use UTC days so the server render and the browser agree.
function parseStamp(value) {
  if (!value) return null;
  const date = new Date(String(value).trim().replace(' ', 'T') + 'Z');
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDays(date, count) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + count);
  return next;
}

function dayKey(date) {
  return date.toISOString().slice(0, 10);
}

function formatAxis(date) {
  return date.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
}

function formatMonth(date) {
  return date.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', year: 'numeric' });
}

function daysAgoWindow(days, now) {
  const end = startOfDay(now);
  return { start: addDays(end, -(days - 1)), end };
}

function inWindow(date, start, endExclusive) {
  return date && date >= start && date < endExclusive;
}

function ageDays(from, now) {
  const start = parseStamp(from);
  if (!start) return 0;
  return Math.max(0, (now.getTime() - start.getTime()) / 86400000);
}

function formatAge(days) {
  if (days == null || Number.isNaN(days)) return '—';
  if (days < 1) {
    const hours = Math.max(1, Math.round(days * 24));
    return days < 1 / 24 ? '< 1h' : `${hours}h`;
  }
  const rounded = Math.round(days * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}d`;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function pct(count, total) {
  if (!total) return '0%';
  return `${Math.round((count / total) * 100)}%`;
}

function signed(count) {
  if (count > 0) return { text: `+${count}`, tone: 'pos' };
  if (count < 0) return { text: String(count), tone: 'neg' };
  return { text: '0', tone: '' };
}

function eventsByTicket(events) {
  const map = new Map();
  const sorted = [...events].sort(
    (a, b) => String(a.created_at).localeCompare(String(b.created_at)) || a.id - b.id
  );
  for (const event of sorted) {
    const list = map.get(event.ticket_id) || [];
    list.push(event);
    map.set(event.ticket_id, list);
  }
  return map;
}

function isDone(status) {
  return DONE.has(status);
}

// The latest transition into Done or Closed. A work item that is open again
// has no resolution time, even if it was finished once before.
function resolvedAt(ticket, events) {
  if (!isDone(ticket.status)) return null;
  let when = null;
  for (const event of events || []) {
    if (isDone(event.to_value)) when = parseStamp(event.created_at);
  }
  return when || parseStamp(ticket.updated_at);
}

function groupOf(ticket, field) {
  if (field === 'status') {
    return { key: ticket.status, label: STATUS_META[ticket.status]?.label || ticket.status };
  }
  if (field === 'priority') {
    return { key: ticket.priority, label: PRIORITY_META[ticket.priority]?.label || ticket.priority };
  }
  if (field === 'type') {
    const type = ticket.type || 'task';
    return { key: type, label: TYPE_META[type]?.label || type };
  }
  if (field === 'assignee') {
    if (!ticket.employee_id) return { key: '__none__', label: 'Unassigned' };
    return { key: `e${ticket.employee_id}`, label: ticket.employee_name || 'Assignee' };
  }
  const category = String(ticket.category || '').trim();
  return category ? { key: category, label: category } : { key: '__none__', label: 'None' };
}

function colorOf(field, key, label) {
  if (field === 'status') return STATUS_META[key]?.color || '#8590A2';
  if (field === 'priority') return PRIORITY_META[key]?.color || '#8590A2';
  if (field === 'type') return TYPE_META[key]?.color || '#8590A2';
  if (key === '__none__') return '#8590A2';
  return colorFor(label);
}

function knownOrder(field) {
  if (field === 'status') return STATUS_ORDER;
  if (field === 'priority') return PRIORITY_ORDER;
  if (field === 'type') return TYPE_ORDER;
  if (field === 'category') return CATEGORY_ORDER;
  return null;
}

function orderGroups(field, rows) {
  const order = knownOrder(field);
  if (!order) {
    return [...rows].sort((a, b) => {
      if (a.key === '__none__') return 1;
      if (b.key === '__none__') return -1;
      return b.count - a.count || a.label.localeCompare(b.label);
    });
  }
  return [...rows].sort((a, b) => {
    const ai = order.indexOf(a.key);
    const bi = order.indexOf(b.key);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });
}

function emptyGroup(field, key) {
  const sample = { status: key, priority: key, type: key, category: key, employee_id: null };
  const group = groupOf(field === 'assignee' ? { employee_id: null } : sample, field);
  if (field !== 'assignee') {
    group.key = key;
    if (field === 'category') group.label = key;
  }
  return { ...group, color: colorOf(field, key, group.label), count: 0, tickets: [] };
}

function groupTickets(tickets, field, { fillZeros = false } = {}) {
  const map = new Map();
  for (const ticket of tickets) {
    const group = groupOf(ticket, field);
    const row = map.get(group.key) || {
      ...group,
      color: colorOf(field, group.key, group.label),
      count: 0,
      tickets: [],
    };
    row.count += 1;
    row.tickets.push(ticket);
    map.set(group.key, row);
  }
  if (fillZeros) {
    for (const key of knownOrder(field) || []) {
      if (!map.has(key)) map.set(key, emptyGroup(field, key));
    }
  }
  return orderGroups(field, [...map.values()]);
}

function presentIssue(ticket, extra = {}) {
  return {
    id: ticket.id,
    key: ticketKey(ticket),
    title: ticket.title,
    status: ticket.status,
    statusLabel: STATUS_META[ticket.status]?.label || ticket.status,
    priority: ticket.priority,
    priorityLabel: PRIORITY_META[ticket.priority]?.label || ticket.priority,
    type: ticket.type || 'task',
    assignee: ticket.employee_name || 'Unassigned',
    created: formatListDateTime(ticket.created_at),
    bucket: extra.bucket || '',
    more: extra.more || [],
  };
}

function stat(label, value) {
  return { label, value: value == null || value === '' ? '—' : String(value) };
}

function startOfWeek(date) {
  const day = startOfDay(date);
  const weekday = day.getUTCDay();
  return addDays(day, weekday === 0 ? -6 : 1 - weekday);
}

function startOfMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function bucketStart(date, period) {
  if (period === 'weekly') return startOfWeek(date);
  if (period === 'monthly') return startOfMonth(date);
  return startOfDay(date);
}

function nextBucket(date, period) {
  if (period === 'weekly') return addDays(date, 7);
  if (period === 'monthly') return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
  return addDays(date, 1);
}

function bucketLabel(start, period) {
  if (period === 'monthly') return formatMonth(start);
  if (period === 'weekly') return `Week of ${formatAxis(start)}`;
  return formatAxis(start);
}

function buildBuckets(start, end, period) {
  const endExclusive = addDays(end, 1);
  const buckets = [];
  let cursor = bucketStart(start, period);
  while (cursor < endExclusive && buckets.length < 400) {
    const next = nextBucket(cursor, period);
    buckets.push({
      key: dayKey(cursor),
      label: bucketLabel(cursor, period),
      start: cursor,
      end: next,
      created: 0,
      resolved: 0,
    });
    cursor = next;
  }
  return buckets;
}

function place(buckets, date) {
  return buckets.find((bucket) => date >= bucket.start && date < bucket.end);
}

function labelEvery(series) {
  const step = series.length > 24 ? Math.ceil(series.length / 8) : series.length > 12 ? 2 : 1;
  return series.map((item, index) => ({
    ...item,
    tick: index % step === 0 || index === series.length - 1 ? item.label : '',
  }));
}

function createdVsResolved(tickets, byTicket, options, now) {
  const { start, end } = daysAgoWindow(options.days, now);
  const endExclusive = addDays(end, 1);
  const buckets = buildBuckets(start, end, options.period);

  for (const ticket of tickets) {
    const created = parseStamp(ticket.created_at);
    if (inWindow(created, start, endExclusive)) {
      const bucket = place(buckets, created);
      if (bucket) bucket.created += 1;
    }
    const resolved = resolvedAt(ticket, byTicket.get(ticket.id));
    if (inWindow(resolved, start, endExclusive)) {
      const bucket = place(buckets, resolved);
      if (bucket) bucket.resolved += 1;
    }
  }

  const created = buckets.reduce((sum, bucket) => sum + bucket.created, 0);
  const resolved = buckets.reduce((sum, bucket) => sum + bucket.resolved, 0);
  return {
    stats: [
      stat('Created', created),
      stat('Resolved', resolved),
      stat('Net', signed(created - resolved).text),
      stat('Periods', buckets.length),
    ],
    chart: {
      type: 'trend',
      label: `${created} created and ${resolved} resolved over the last ${options.days} days`,
      series: labelEvery(
        buckets.map((bucket) => ({
          key: bucket.key,
          label: formatAxis(bucket.start),
          created: bucket.created,
          resolved: bucket.resolved,
        }))
      ),
    },
    table: {
      columns: [
        { key: 'period', label: 'Period' },
        { key: 'created', label: 'Created', numeric: true },
        { key: 'resolved', label: 'Resolved', numeric: true },
        { key: 'difference', label: 'Difference', numeric: true },
      ],
      rows: buckets.map((bucket) => {
        const difference = signed(bucket.created - bucket.resolved);
        return {
          id: bucket.key,
          cells: {
            period: bucket.label,
            created: String(bucket.created),
            resolved: String(bucket.resolved),
            difference: difference.text,
          },
          tones: { difference: difference.tone },
        };
      }),
    },
  };
}

function averageAge(tickets, options, now) {
  const open = tickets.filter((ticket) => !isDone(ticket.status));
  const groups = groupTickets(open, options.group).map((group) => {
    const ages = group.tickets.map((ticket) => ageDays(ticket.created_at, now));
    const total = ages.reduce((sum, age) => sum + age, 0);
    return { ...group, average: group.count ? total / group.count : 0, total };
  });
  const overall = open.length
    ? open.reduce((sum, ticket) => sum + ageDays(ticket.created_at, now), 0) / open.length
    : null;

  return {
    stats: [
      stat('Unresolved', open.length),
      stat('Average age', overall == null ? '—' : formatAge(overall)),
      stat('Oldest group', groups[0] ? groups.slice().sort((a, b) => b.average - a.average)[0].label : '—'),
    ],
    empty: open.length ? '' : 'No unresolved work items in this project.',
    chart: open.length
      ? {
          type: 'meters',
          label: `Average age of ${open.length} unresolved work items`,
          rows: groups.map((group) => ({
            key: group.key,
            label: group.label,
            color: group.color,
            value: group.average,
            display: formatAge(group.average),
          })),
        }
      : null,
    table: {
      columns: [
        { key: 'label', label: 'Group' },
        { key: 'count', label: 'Issues', numeric: true },
        { key: 'average', label: 'Average age', numeric: true },
        { key: 'total', label: 'Total age', numeric: true },
      ],
      rows: groups.map((group) => ({
        id: group.key,
        bucket: group.key,
        cells: {
          label: group.label,
          count: String(group.count),
          average: formatAge(group.average),
          total: formatAge(group.total),
        },
      })),
    },
    issues: open.map((ticket) => presentIssue(ticket, { bucket: groupOf(ticket, options.group).key })),
    issueColumns: [],
  };
}

function pieChart(tickets, options) {
  const scoped = options.scope === 'unresolved' ? tickets.filter((ticket) => !isDone(ticket.status)) : tickets;
  const groups = groupTickets(scoped, options.group, { fillZeros: options.group !== 'assignee' });
  const total = scoped.length;
  return {
    stats: [
      stat('Work items', total),
      stat('Groups', groups.filter((group) => group.count > 0).length),
      stat('Largest', groups.slice().sort((a, b) => b.count - a.count)[0]?.label || '—'),
    ],
    empty: total ? '' : 'No work items match this statistic.',
    chart: {
      type: 'pie',
      label: `${total} work items by ${options.group}`,
      total,
      segments: groups.map((group) => ({
        key: group.key,
        label: group.label,
        color: group.color,
        value: group.count,
      })),
    },
    table: {
      columns: [
        { key: 'label', label: 'Group' },
        { key: 'count', label: 'Issues', numeric: true },
        { key: 'percent', label: 'Percentage', numeric: true },
      ],
      rows: groups.map((group) => ({
        id: group.key,
        bucket: group.key,
        cells: {
          label: group.label,
          count: String(group.count),
          percent: pct(group.count, total),
        },
      })),
    },
    issues: scoped.map((ticket) => presentIssue(ticket, { bucket: groupOf(ticket, options.group).key })),
  };
}

function recentlyCreated(tickets, options, now) {
  const { start, end } = daysAgoWindow(options.days, now);
  const endExclusive = addDays(end, 1);
  const days = [];
  for (let cursor = new Date(start); cursor <= end; cursor = addDays(cursor, 1)) {
    days.push({ key: dayKey(cursor), label: formatAxis(cursor), value: 0 });
  }
  const recent = [];
  for (const ticket of tickets) {
    const created = parseStamp(ticket.created_at);
    if (!inWindow(created, start, endExclusive)) continue;
    const bucket = days.find((day) => day.key === dayKey(startOfDay(created)));
    if (bucket) bucket.value += 1;
    recent.push(ticket);
  }
  recent.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const perDay = options.days ? (recent.length / options.days).toFixed(1) : '0';
  return {
    stats: [
      stat('Created', recent.length),
      stat('Per day', perDay),
      stat('Date range', `Last ${options.days} days`),
    ],
    chart: {
      type: 'columns',
      label: `${recent.length} work items created in the last ${options.days} days`,
      color: '#0C66E4',
      series: labelEvery(days),
    },
    issues: recent.map((ticket) => presentIssue(ticket)),
  };
}

const RESOLUTION_BUCKETS = [
  { key: 'lt1', label: 'Less than 1 day' },
  { key: 'd3', label: '1 to 3 days' },
  { key: 'd7', label: '3 to 7 days' },
  { key: 'w2', label: '1 to 2 weeks' },
  { key: 'w4', label: '2 to 4 weeks' },
  { key: 'gt', label: 'More than 4 weeks' },
];

function resolutionBucket(days) {
  if (days < 1) return RESOLUTION_BUCKETS[0];
  if (days <= 3) return RESOLUTION_BUCKETS[1];
  if (days <= 7) return RESOLUTION_BUCKETS[2];
  if (days <= 14) return RESOLUTION_BUCKETS[3];
  if (days <= 28) return RESOLUTION_BUCKETS[4];
  return RESOLUTION_BUCKETS[5];
}

function resolutionTime(tickets, byTicket, options, now) {
  const windowed = options.within === 'all' ? null : daysAgoWindow(Number(options.within), now);
  const endExclusive = windowed ? addDays(windowed.end, 1) : null;
  const finished = [];
  for (const ticket of tickets) {
    const resolved = resolvedAt(ticket, byTicket.get(ticket.id));
    if (!resolved) continue;
    if (windowed && !inWindow(resolved, windowed.start, endExclusive)) continue;
    const created = parseStamp(ticket.created_at);
    const days = created ? Math.max(0, (resolved.getTime() - created.getTime()) / 86400000) : 0;
    finished.push({ ticket, days, bucket: resolutionBucket(days).key });
  }
  const counts = new Map(RESOLUTION_BUCKETS.map((bucket) => [bucket.key, 0]));
  for (const item of finished) counts.set(item.bucket, counts.get(item.bucket) + 1);
  const ages = finished.map((item) => item.days);
  const average = ages.length ? ages.reduce((sum, age) => sum + age, 0) / ages.length : null;
  return {
    stats: [
      stat('Resolved', finished.length),
      stat('Average', formatAge(average)),
      stat('Median', formatAge(median(ages))),
    ],
    empty: finished.length ? '' : 'No work items were resolved in this period.',
    chart: {
      type: 'meters',
      label: `Resolution time for ${finished.length} work items`,
      rows: RESOLUTION_BUCKETS.map((bucket) => ({
        key: bucket.key,
        label: bucket.label,
        color: '#0C66E4',
        value: counts.get(bucket.key),
        display: String(counts.get(bucket.key)),
      })),
    },
    table: {
      columns: [
        { key: 'label', label: 'Resolution time' },
        { key: 'count', label: 'Issues', numeric: true },
        { key: 'percent', label: 'Percentage', numeric: true },
      ],
      rows: RESOLUTION_BUCKETS.map((bucket) => ({
        id: bucket.key,
        bucket: bucket.key,
        cells: {
          label: bucket.label,
          count: String(counts.get(bucket.key)),
          percent: pct(counts.get(bucket.key), finished.length),
        },
      })),
    },
    issueColumns: ['Resolution time'],
    issues: finished
      .sort((a, b) => b.days - a.days)
      .map((item) => presentIssue(item.ticket, { bucket: item.bucket, more: [formatAge(item.days)] })),
  };
}

function groupBy(tickets, options) {
  const groups = groupTickets(tickets, options.group, { fillZeros: options.group !== 'assignee' });
  const max = Math.max(1, ...groups.map((group) => group.count));
  return {
    stats: [
      stat('Work items', tickets.length),
      stat('Groups', groups.filter((group) => group.count > 0).length),
    ],
    empty: tickets.length ? '' : 'This project has no work items yet.',
    table: {
      columns: [
        { key: 'label', label: 'Group' },
        { key: 'count', label: 'Issues', numeric: true },
        { key: 'percent', label: 'Percentage', numeric: true },
        { key: 'share', label: 'Share', meter: true },
      ],
      rows: groups.map((group) => ({
        id: group.key,
        bucket: group.key,
        color: group.color,
        meter: Math.round((group.count / max) * 100),
        cells: {
          label: group.label,
          count: String(group.count),
          percent: pct(group.count, tickets.length),
        },
      })),
    },
    issues: tickets.map((ticket) => presentIssue(ticket, { bucket: groupOf(ticket, options.group).key })),
  };
}

const TIME_SINCE = [
  { key: 'day', label: 'Less than 1 day', test: (days) => days < 1 },
  { key: 'week', label: '1 day to 1 week', test: (days) => days >= 1 && days < 7 },
  { key: 'month', label: '1 week to 1 month', test: (days) => days >= 7 && days < 30 },
  { key: 'quarter', label: '1 to 3 months', test: (days) => days >= 30 && days < 90 },
  { key: 'older', label: 'More than 3 months', test: (days) => days >= 90 },
];

function timeSince(tickets, options, now) {
  const field = options.field === 'updated' ? 'updated_at' : 'created_at';
  const placed = tickets.map((ticket) => {
    const days = ageDays(ticket[field], now);
    const bucket = TIME_SINCE.find((item) => item.test(days)) || TIME_SINCE[TIME_SINCE.length - 1];
    return { ticket, bucket: bucket.key, days };
  });
  const counts = new Map(TIME_SINCE.map((bucket) => [bucket.key, 0]));
  for (const item of placed) counts.set(item.bucket, counts.get(item.bucket) + 1);
  return {
    stats: [
      stat('Work items', tickets.length),
      stat('Date field', options.field === 'updated' ? 'Updated' : 'Created'),
      stat('Within a week', counts.get('day') + counts.get('week')),
    ],
    chart: {
      type: 'meters',
      label: `Age of the ${options.field === 'updated' ? 'updated' : 'created'} date`,
      rows: TIME_SINCE.map((bucket) => ({
        key: bucket.key,
        label: bucket.label,
        color: '#6554C0',
        value: counts.get(bucket.key),
        display: String(counts.get(bucket.key)),
      })),
    },
    table: {
      columns: [
        { key: 'label', label: 'Period' },
        { key: 'count', label: 'Issues', numeric: true },
        { key: 'percent', label: 'Percentage', numeric: true },
      ],
      rows: TIME_SINCE.map((bucket) => ({
        id: bucket.key,
        bucket: bucket.key,
        cells: {
          label: bucket.label,
          count: String(counts.get(bucket.key)),
          percent: pct(counts.get(bucket.key), tickets.length),
        },
      })),
    },
    issues: placed
      .sort((a, b) => a.days - b.days)
      .map((item) => presentIssue(item.ticket, { bucket: item.bucket, more: [formatAge(item.days)] })),
    issueColumns: [options.field === 'updated' ? 'Since updated' : 'Age'],
  };
}

function userWorkload(tickets) {
  const groups = groupTickets(tickets, 'assignee');
  const rows = groups.map((group) => {
    const count = (status) => group.tickets.filter((ticket) => ticket.status === status).length;
    const open = count('open');
    const progress = count('in_progress');
    const done = count('resolved') + count('closed');
    const remaining = group.tickets
      .filter((ticket) => !isDone(ticket.status))
      .reduce((sum, ticket) => sum + (Number(ticket.estimate_seconds) || 0), 0);
    return {
      id: group.key,
      bucket: group.key,
      bar: [
        { key: 'open', value: open, color: STATUS_META.open.color, label: 'To Do' },
        { key: 'in_progress', value: progress, color: STATUS_META.in_progress.color, label: 'In Progress' },
        { key: 'done', value: done, color: '#36B37E', label: 'Done' },
      ],
      cells: {
        label: group.label,
        open: String(open),
        progress: String(progress),
        done: String(done),
        unresolved: String(open + progress),
        estimate: formatDuration(remaining),
      },
    };
  });
  const unresolved = tickets.filter((ticket) => !isDone(ticket.status)).length;
  return {
    stats: [
      stat('Assignees', groups.filter((group) => group.key !== '__none__').length),
      stat('Unresolved', unresolved),
      stat('Unassigned', groups.find((group) => group.key === '__none__')?.count || 0),
    ],
    empty: tickets.length ? '' : 'This project has no work items yet.',
    table: {
      columns: [
        { key: 'label', label: 'Assignee' },
        { key: 'open', label: 'To Do', numeric: true },
        { key: 'progress', label: 'In Progress', numeric: true },
        { key: 'done', label: 'Done', numeric: true },
        { key: 'unresolved', label: 'Unresolved', numeric: true },
        { key: 'estimate', label: 'Remaining estimate', numeric: true },
        { key: 'mix', label: 'Mix', bar: true },
      ],
      rows,
    },
    issues: tickets.map((ticket) => presentIssue(ticket, { bucket: groupOf(ticket, 'assignee').key })),
  };
}

function timeTracking(tickets, timeByTicket) {
  const tracked = tickets
    .map((ticket) => ({
      ticket,
      estimate: Number(ticket.estimate_seconds) || 0,
      spent: Number(timeByTicket[ticket.id]) || 0,
    }))
    .filter((item) => item.estimate > 0 || item.spent > 0);

  const byAssignee = new Map();
  for (const item of tracked) {
    const group = groupOf(item.ticket, 'assignee');
    const row = byAssignee.get(group.key) || { ...group, issues: 0, estimate: 0, spent: 0 };
    row.issues += 1;
    row.estimate += item.estimate;
    row.spent += item.spent;
    byAssignee.set(group.key, row);
  }
  const people = [...byAssignee.values()].sort((a, b) => b.spent - a.spent || a.label.localeCompare(b.label));
  const estimate = tracked.reduce((sum, item) => sum + item.estimate, 0);
  const spent = tracked.reduce((sum, item) => sum + item.spent, 0);

  return {
    stats: [
      stat('Estimate', formatDuration(estimate)),
      stat('Logged', formatDuration(spent)),
      stat('Remaining', formatDuration(Math.max(0, estimate - spent))),
      stat('Tracked items', tracked.length),
    ],
    empty: tracked.length ? '' : 'No estimates or time logs yet. Add an estimate or log time on a work item to see it here.',
    table: people.length
      ? {
          columns: [
            { key: 'label', label: 'Assignee' },
            { key: 'issues', label: 'Issues', numeric: true },
            { key: 'estimate', label: 'Estimate', numeric: true },
            { key: 'logged', label: 'Logged', numeric: true },
            { key: 'remaining', label: 'Remaining', numeric: true },
          ],
          rows: people.map((person) => ({
            id: person.key,
            bucket: person.key,
            cells: {
              label: person.label,
              issues: String(person.issues),
              estimate: formatDuration(person.estimate),
              logged: formatDuration(person.spent),
              remaining: formatDuration(Math.max(0, person.estimate - person.spent)),
            },
          })),
        }
      : null,
    issueColumns: ['Estimate', 'Logged', 'Remaining'],
    issues: tracked
      .sort((a, b) => b.spent - a.spent)
      .map((item) =>
        presentIssue(item.ticket, {
          bucket: groupOf(item.ticket, 'assignee').key,
          more: [
            formatDuration(item.estimate),
            formatDuration(item.spent),
            formatDuration(Math.max(0, item.estimate - item.spent)),
          ],
        })
      ),
  };
}

function cumulativeFlow(tickets, byTicket, options, now) {
  const { start, end } = daysAgoWindow(options.days, now);
  const days = [];
  for (let cursor = new Date(start); cursor <= end; cursor = addDays(cursor, 1)) days.push(new Date(cursor));

  const series = days.map((day) => ({
    key: dayKey(day),
    label: formatAxis(day),
    counts: { open: 0, in_progress: 0, resolved: 0, closed: 0 },
  }));

  for (const ticket of tickets) {
    const created = parseStamp(ticket.created_at);
    if (!created) continue;
    const events = byTicket.get(ticket.id) || [];
    let status = events.length ? events[0].from_value || 'open' : ticket.status;
    if (!STATUS_ORDER.includes(status)) status = 'open';
    let index = 0;
    for (let i = 0; i < days.length; i++) {
      const dayEnd = addDays(days[i], 1);
      if (created >= dayEnd) continue;
      while (index < events.length) {
        const when = parseStamp(events[index].created_at);
        if (!when || when >= dayEnd) break;
        if (STATUS_ORDER.includes(events[index].to_value)) status = events[index].to_value;
        index += 1;
      }
      series[i].counts[status] += 1;
    }
  }

  const latest = series[series.length - 1]?.counts || { open: 0, in_progress: 0, resolved: 0, closed: 0 };
  return {
    stats: [
      stat('To Do', latest.open),
      stat('In Progress', latest.in_progress),
      stat('Done', latest.resolved),
      stat('Closed', latest.closed),
    ],
    note: 'Each day replays status changes. A work item with no history stays in its current status from the day it was created.',
    chart: {
      type: 'area',
      label: `Cumulative flow for the last ${options.days} days`,
      series: labelEvery(series),
      keys: STATUS_ORDER.map((key) => ({
        key,
        label: STATUS_META[key].label,
        color: key === 'resolved' ? '#36B37E' : STATUS_META[key].color,
      })),
    },
  };
}

export function buildReport(slug, source, options, now = new Date()) {
  const tickets = source?.tickets || [];
  const byTicket = eventsByTicket(source?.events || []);
  const timeByTicket = source?.timeByTicket || {};

  switch (slug) {
    case 'created-vs-resolved':
      return createdVsResolved(tickets, byTicket, options, now);
    case 'average-age':
      return averageAge(tickets, options, now);
    case 'pie-chart':
      return pieChart(tickets, options);
    case 'recently-created':
      return recentlyCreated(tickets, options, now);
    case 'resolution-time':
      return resolutionTime(tickets, byTicket, options, now);
    case 'group-by':
      return groupBy(tickets, options);
    case 'time-since':
      return timeSince(tickets, options, now);
    case 'user-workload':
      return userWorkload(tickets);
    case 'time-tracking':
      return timeTracking(tickets, timeByTicket);
    case 'cumulative-flow':
      return cumulativeFlow(tickets, byTicket, options, now);
    default:
      return null;
  }
}

/**
 * Layout math for the project timeline.
 *
 * The timeline is the Jira schedule view: a fixed list of work items beside a
 * horizontally scrolling scale, with a bar for every item that has both a
 * start date and a due date. Parent bars cover the union of their own dates
 * and their descendants, and a "blocks" link is drawn from the end of the
 * blocker to the start of the item it blocks.
 *
 * Dates stay `YYYY-MM-DD` strings, built at UTC midnight, for the same reason
 * the calendar does: the server and the browser must agree on which day a bar
 * lands on.
 */

import { addDays, dateFromISO, normalizeDueDate, toISO } from './calendar';
import { buildTicketTree, isDone } from './ticketTree';

export const ROW_H = 40;
export const HEAD_H = 48;
export const SIDE_W = 320;

export const ZOOMS = {
  weeks: { id: 'weeks', label: 'Weeks', dayWidth: 36, padBefore: 14, padAfter: 35 },
  months: { id: 'months', label: 'Months', dayWidth: 16, padBefore: 21, padAfter: 70 },
  quarters: { id: 'quarters', label: 'Quarters', dayWidth: 8, padBefore: 28, padAfter: 140 },
};

export const ZOOM_ORDER = ['weeks', 'months', 'quarters'];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function addDaysISO(iso, days) {
  return toISO(addDays(dateFromISO(iso), days));
}

/** Whole days from `a` to `b`. Negative when `b` is earlier. */
export function daysBetween(a, b) {
  return Math.round((dateFromISO(b) - dateFromISO(a)) / 86400000);
}

/**
 * The bar a ticket draws from its own columns.
 *
 * Jira only puts a bar on the scale once both dates exist. A single date stays
 * in the list and is scheduled by dragging across the row. Stored dates that
 * are backwards are swapped for display so the bar still shows; a later edit
 * writes them back in order.
 */
export function ownSpan(ticket) {
  const start = normalizeDueDate(ticket?.start_date);
  const due = normalizeDueDate(ticket?.due_date);
  if (!start || !due) return null;
  return start <= due ? { start, end: due } : { start: due, end: start };
}

export function unionSpans(spans) {
  const list = spans.filter(Boolean);
  if (!list.length) return null;
  let start = list[0].start;
  let end = list[0].end;
  for (const span of list) {
    if (span.start < start) start = span.start;
    if (span.end > end) end = span.end;
  }
  return { start, end };
}

/**
 * The day under a pointer, clamped to the scale so a drag cannot schedule a
 * date the header does not show.
 */
export function dateAtX(rangeStart, dayCount, x, dayWidth) {
  const maxIndex = Math.max(0, dayCount - 1);
  const index = Math.min(maxIndex, Math.max(0, Math.floor(x / dayWidth)));
  return addDaysISO(rangeStart, index);
}

export function barGeometry(rangeStart, span, dayWidth) {
  const left = daysBetween(rangeStart, span.start) * dayWidth + 3;
  const days = daysBetween(span.start, span.end) + 1;
  const width = Math.max(days * dayWidth - 6, 18);
  return { left, width };
}

/**
 * How far a bar may slide without leaving the scale.
 *
 * The parent bar is the union of the subtree, so clamping that one span keeps
 * every dated descendant on the scale too.
 */
export function clampDelta(span, delta, range) {
  if (!span || !delta) return 0;
  const minDelta = daysBetween(span.start, range.start);
  const maxDelta = daysBetween(span.end, range.end);
  return Math.max(minDelta, Math.min(maxDelta, delta));
}

/** Start and due after dragging one edge. Always returned in order. */
export function resizePatch(ticket, edge, deltaDays, range) {
  const span = ownSpan(ticket);
  if (!span || !deltaDays) return null;
  let start = span.start;
  let end = span.end;
  if (edge === 'start') {
    start = addDaysISO(span.start, deltaDays);
    if (start < range.start) start = range.start;
    if (start > end) start = end;
  } else {
    end = addDaysISO(span.end, deltaDays);
    if (end > range.end) end = range.end;
    if (end < start) end = start;
  }
  if (start === span.start && end === span.end) return null;
  return { start_date: start, due_date: end };
}

/**
 * Shift every dated ticket in a subtree by the same number of days.
 *
 * Moving a parent on the Jira timeline takes its children with it. Tickets
 * with no dates are left where they are, because there is nothing to shift.
 */
export function shiftPatches(node, deltaDays) {
  if (!deltaDays) return [];
  const patches = [];
  const visit = (current) => {
    const fields = {};
    const start = normalizeDueDate(current.ticket.start_date);
    const due = normalizeDueDate(current.ticket.due_date);
    if (start) fields.start_date = addDaysISO(start, deltaDays);
    if (due) fields.due_date = addDaysISO(due, deltaDays);
    if (start || due) patches.push({ id: current.ticket.id, fields });
    for (const child of current.children) visit(child);
  };
  visit(node);
  return patches;
}

export function scheduleFields(a, b) {
  return a <= b
    ? { start_date: a, due_date: b }
    : { start_date: b, due_date: a };
}

/**
 * The scale covers every scheduled bar and today, padded per zoom and aligned
 * to Monday/Sunday so week headers are not cut in half.
 */
export function buildRange(today, spans, zoom) {
  let start = today;
  let end = today;
  for (const span of spans) {
    if (!span) continue;
    if (span.start < start) start = span.start;
    if (span.end > end) end = span.end;
  }
  start = addDaysISO(start, -zoom.padBefore);
  end = addDaysISO(end, zoom.padAfter);

  const startDow = dateFromISO(start).getUTCDay();
  start = addDaysISO(start, -((startDow + 6) % 7));
  const endDow = dateFromISO(end).getUTCDay();
  end = addDaysISO(end, (7 - endDow) % 7);

  return { start, end, count: daysBetween(start, end) + 1 };
}

export function buildColumns(start, count) {
  const cols = [];
  for (let i = 0; i < count; i += 1) {
    const iso = addDaysISO(start, i);
    const date = dateFromISO(iso);
    const month = date.getUTCMonth();
    const year = date.getUTCFullYear();
    cols.push({
      iso,
      weekend: date.getUTCDay() === 0 || date.getUTCDay() === 6,
      dayNum: date.getUTCDate(),
      monthStart: date.getUTCDate() === 1,
      monthLabel: `${MONTHS[month]} ${year}`,
      monthShort: MONTHS[month],
      quarterLabel: `Q${Math.floor(month / 3) + 1} ${year}`,
    });
  }
  return cols;
}

export function groupBy(cols, labelOf) {
  const groups = [];
  cols.forEach((col, index) => {
    const label = labelOf(col);
    const last = groups[groups.length - 1];
    if (last && last.label === label) {
      last.span += 1;
      if (col.iso) last.isos.push(col.iso);
    } else {
      groups.push({ label, span: 1, index, isos: [col.iso] });
    }
  });
  return groups;
}

/** Monday of the week containing `iso`, used as the month-zoom tick. */
export function weekStart(iso) {
  const date = dateFromISO(iso);
  return addDaysISO(iso, -((date.getUTCDay() + 6) % 7));
}

export function weekGroups(cols) {
  const groups = [];
  for (const col of cols) {
    const key = weekStart(col.iso);
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.span += 1;
      last.isos.push(col.iso);
    } else {
      groups.push({
        key,
        label: String(dateFromISO(key).getUTCDate()),
        span: 1,
        isos: [col.iso],
      });
    }
  }
  return groups;
}

function decorateNode(node) {
  const children = node.children.map(decorateNode);
  const childSpans = children.map((child) => child.span).filter(Boolean);
  const own = ownSpan(node.ticket);
  let descendantTotal = 0;
  let descendantDone = 0;
  for (const child of children) {
    descendantTotal += 1 + child.descendantTotal;
    descendantDone += (isDone(child.ticket) ? 1 : 0) + child.descendantDone;
  }
  return {
    ticket: node.ticket,
    depth: node.depth,
    children,
    hasChildren: children.length > 0,
    own,
    span: unionSpans([...(own ? [own] : []), ...childSpans]),
    rolledUp: childSpans.length > 0,
    descendantTotal,
    descendantDone,
    progress: descendantTotal === 0 ? 0 : descendantDone / descendantTotal,
  };
}

/**
 * Parent/child rows in the order the tickets were loaded.
 *
 * Order is rank, not schedule. Sorting by start date would make a row jump
 * to a new place the moment a drag committed, which is not how the Jira
 * timeline behaves: dragging changes dates, not the list order.
 */
export function buildTimelineRows(tickets) {
  const { roots } = buildTicketTree(tickets);
  return roots.map(decorateNode);
}

export function visibleRows(roots, collapsed) {
  const rows = [];
  const walk = (node) => {
    rows.push(node);
    if (!node.hasChildren || collapsed.has(node.ticket.id)) return;
    for (const child of node.children) walk(child);
  };
  for (const root of roots) walk(root);
  return rows;
}

/**
 * Recompute bar spans from a date preview without reordering the tree.
 */
export function withDatePatch(roots, patch) {
  if (!patch || Object.keys(patch).length === 0) return roots;
  const mapNode = (node) => {
    const ticket = patch[node.ticket.id]
      ? { ...node.ticket, ...patch[node.ticket.id] }
      : node.ticket;
    const children = node.children.map(mapNode);
    const childSpans = children.map((child) => child.span).filter(Boolean);
    const own = ownSpan(ticket);
    return {
      ...node,
      ticket,
      children,
      own,
      span: unionSpans([...(own ? [own] : []), ...childSpans]),
      rolledUp: childSpans.length > 0,
    };
  };
  return roots.map(mapNode);
}

/**
 * Keep a parent on screen when a filter matches only its child.
 *
 * Otherwise the child would be promoted to the top of the tree and the
 * timeline would no longer show which epic it belongs to.
 */
export function includeAncestors(tickets, matched) {
  const byId = new Map(tickets.map((ticket) => [Number(ticket.id), ticket]));
  const keep = new Set(matched.map((ticket) => Number(ticket.id)));
  for (const ticket of matched) {
    const seen = new Set();
    let parentId = ticket.parent_id == null ? null : Number(ticket.parent_id);
    while (parentId != null && byId.has(parentId) && !seen.has(parentId)) {
      seen.add(parentId);
      keep.add(parentId);
      parentId = byId.get(parentId).parent_id;
      if (parentId != null) parentId = Number(parentId);
    }
  }
  return tickets.filter((ticket) => keep.has(Number(ticket.id)));
}

/**
 * Elbow from the end of the blocker to the start of the blocked item.
 *
 * When the blocked item starts before the blocker ends the line routes
 * around the bars instead of cutting back through them. That case is also a
 * schedule conflict: the blocked work is planned to start too early.
 */
export function linkPath(x1, y1, x2, y2) {
  if (x2 >= x1 + 20) {
    return `M ${x1} ${y1} C ${x1 + 28} ${y1}, ${x2 - 28} ${y2}, ${x2} ${y2}`;
  }
  const around = y2 >= y1 ? 18 : -18;
  return `M ${x1} ${y1} H ${x1 + 16} V ${y2 + around} H ${x2 - 16} V ${y2} H ${x2}`;
}

export function isScheduleConflict(fromSpan, toSpan) {
  return Boolean(fromSpan && toSpan && toSpan.start <= fromSpan.end);
}

const PRETTY_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function prettyDate(iso) {
  if (!iso) return '';
  const date = dateFromISO(iso);
  return `${date.getUTCDate()} ${PRETTY_MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

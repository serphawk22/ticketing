import { STATUS_ORDER, PRIORITY_ORDER, TYPE_ORDER } from './ticketMeta';
import { getClientRequestTickets } from './tickets';
import { getEmployees } from './employees';

const WINDOW_DAYS = 7;

function num(value) {
  return Number(value || 0);
}

function toTime(value) {
  if (!value) return NaN;
  if (value instanceof Date) return value.getTime();
  return Date.parse(String(value).trim().replace(' ', 'T') + 'Z');
}

function countBy(tickets, field, keys) {
  const counts = Object.fromEntries(keys.map((key) => [key, 0]));
  for (const ticket of tickets) {
    if (keys.includes(ticket[field])) counts[ticket[field]] += 1;
  }
  return counts;
}

function assigneeScope(assigneeId) {
  const n = Number(assigneeId);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function buildClientRequestSummary(
  tickets,
  employees = [],
  { activityLimit = 8, assigneeId = null } = {}
) {
  const assignee = assigneeScope(assigneeId);
  const scoped = assignee == null
    ? tickets
    : tickets.filter((ticket) => Number(ticket.employee_id) === assignee);

  const cutoff = Date.now() - WINDOW_DAYS * 86400000;
  const recent = (value) => {
    const time = toTime(value);
    return Number.isFinite(time) && time >= cutoff;
  };

  const activity = [...scoped]
    .sort((a, b) => toTime(b.updated_at) - toTime(a.updated_at) || Number(b.id) - Number(a.id))
    .slice(0, activityLimit)
    .map((ticket) => ({
      id: ticket.id,
      title: ticket.title,
      status: ticket.status,
      priority: ticket.priority,
      type: ticket.type,
      project_id: ticket.project_id ?? null,
      project_key: ticket.project_key ?? null,
      updated_at: ticket.updated_at,
      created_at: ticket.created_at,
      created_by_name: ticket.created_by_name,
      employee_name: ticket.employee_name,
      employee_id: ticket.employee_id,
    }));

  const peopleById = new Map();
  for (const employee of employees) {
    if (employee.active === 0 || employee.active === false) continue;
    peopleById.set(Number(employee.id), {
      id: employee.id,
      name: employee.name,
      email: employee.email,
      active: employee.active,
      project_count: 0,
    });
  }
  for (const ticket of tickets) {
    if (ticket.employee_id == null) continue;
    const person = peopleById.get(Number(ticket.employee_id));
    if (person) person.project_count += 1;
  }
  const people = [...peopleById.values()]
    .filter((person) => person.project_count > 0)
    .sort((a, b) => b.project_count - a.project_count || a.name.localeCompare(b.name));

  return {
    projectId: null,
    total: scoped.length,
    windowDays: WINDOW_DAYS,
    byStatus: countBy(scoped, 'status', STATUS_ORDER),
    byPriority: countBy(scoped, 'priority', PRIORITY_ORDER),
    byType: countBy(scoped, 'type', TYPE_ORDER),
    metrics: {
      completed: scoped.filter(
        (ticket) => ['resolved', 'closed'].includes(ticket.status) && recent(ticket.updated_at)
      ).length,
      updated: scoped.filter((ticket) => recent(ticket.updated_at)).length,
      created: scoped.filter((ticket) => recent(ticket.created_at)).length,
      unassigned: scoped.filter((ticket) => ticket.employee_id == null).length,
    },
    people,
    activity,
  };
}

export async function getClientRequestSummary(options = {}) {
  const [tickets, employees] = await Promise.all([
    getClientRequestTickets(),
    getEmployees(),
  ]);
  return buildClientRequestSummary(tickets, employees, options);
}

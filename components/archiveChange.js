/**
 * Apply an archive or restore to a view's ticket list.
 *
 * `home` is where the list lives. An active list (board, list, calendar)
 * drops work that was just archived and puts restored work back. The archived
 * list does the reverse.
 */
export function mergeArchiveChange(current, change, home) {
  const tickets = change?.tickets || [];
  if (!tickets.length) return current;
  const ids = new Set(tickets.map((ticket) => Number(ticket.id)));
  const archived = Boolean(change.archived);
  const leaving = home === 'archived' ? !archived : archived;
  if (leaving) return current.filter((ticket) => !ids.has(Number(ticket.id)));
  const rest = current.filter((ticket) => !ids.has(Number(ticket.id)));
  return [...tickets, ...rest].sort((a, b) => Number(b.id) - Number(a.id));
}

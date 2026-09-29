/**
 * Parent/child hierarchy helpers.
 *
 * A ticket's place in the tree lives in `tickets.parent_id`: null means the
 * ticket is top-level, otherwise it is the id of the ticket that owns it. The
 * list view renders the tree from that field alone, so nothing here needs the
 * ticket_relations rows that used to carry parenting.
 */

export function isDone(ticket) {
  return ticket.status === 'resolved' || ticket.status === 'closed';
}

function makeNode(ticket, depth) {
  return {
    ticket,
    depth,
    children: [],
    hasChildren: false,
    childCount: 0,
    doneCount: 0,
  };
}

/**
 * Build the tree for an already-filtered, already-sorted ticket list.
 *
 * Input order is preserved within each level, so whatever sort the list view
 * applied to the flat array carries into the tree for free. A ticket whose
 * parent is not in `tickets` is treated as top-level: that is what makes a
 * filtered or paginated list still show every visible row rather than silently
 * dropping the children of an off-page parent.
 */
export function buildTicketTree(tickets) {
  const byId = new Map();
  for (const t of tickets) byId.set(t.id, t);

  const nodes = new Map();
  for (const t of tickets) nodes.set(t.id, makeNode(t, 0));

  const roots = [];
  for (const t of tickets) {
    const node = nodes.get(t.id);
    const parentId = t.parent_id == null ? null : Number(t.parent_id);

    if (parentId == null || parentId === t.id || !byId.has(parentId)) {
      roots.push(node);
      continue;
    }
    nodes.get(parentId).children.push(node);
  }

  // Assign depth, child counts, and the "n/m done" roll-up. Stored data can
  // already contain a loop, whether from a pre-migration database or a manual
  // edit, so the walk has to terminate and has to show every ticket: an edge
  // back onto a node already rendered is cut, and any node the walk never
  // reaches is promoted to the top level. Without that second step a closed
  // loop would render as nothing and its tickets would silently vanish.
  const visited = new Set();
  const walk = (node, depth) => {
    if (visited.has(node.ticket.id)) return;
    visited.add(node.ticket.id);

    node.depth = depth;
    node.hasChildren = node.children.length > 0;
    node.childCount = node.children.length;
    node.doneCount = node.children.filter((c) => isDone(c.ticket)).length;

    node.children = node.children.filter((child) => {
      if (visited.has(child.ticket.id)) return false; // closes a loop: cut it
      walk(child, depth + 1);
      return true;
    });
    node.hasChildren = node.children.length > 0;
    node.childCount = node.children.length;
  };

  for (const root of [...roots]) walk(root, 0);

  // Only a cycle can leave a ticket unreachable, and the API refuses to create
  // one, so this is a safety net for data that predates the check.
  for (const node of nodes.values()) {
    if (visited.has(node.ticket.id)) continue;
    roots.push(node);
    walk(node, 0);
  }

  return { roots, byId: nodes };
}

/**
 * How many tickets are hidden because an ancestor is closed. Counts the whole
 * subtree rather than just direct children, so a footer that says "4 child
 * items nested" stays truthful when a closed parent sits under a closed one.
 */
export function countHidden(roots, collapsed) {
  const subtree = (node) =>
    node.children.reduce((sum, child) => sum + 1 + subtree(child), 0);

  let hidden = 0;
  const walk = (node) => {
    if (collapsed.has(node.ticket.id)) {
      hidden += subtree(node);
      return;
    }
    node.children.forEach(walk);
  };
  roots.forEach(walk);
  return hidden;
}

/**
 * Flatten the tree into the rows the list actually draws, in draw order.
 *
 * `collapsed` holds the ids whose children are hidden. A parent that is absent
 * from the set is open: that matches the list view, which shows a parent's
 * subtree until the user closes it, and it means a parent nobody has touched
 * yet needs no special case.
 */
export function flattenTree(roots, collapsed) {
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
 * True when making `parentId` the parent of `ticketId` would build a loop.
 *
 * Walks up from the proposed parent instead of using a recursive CTE so the
 * check is identical on both drivers. The hop limit is a belt-and-braces stop
 * in case the stored data is already cyclic.
 */
export async function wouldCreateCycle(loadParentId, ticketId, parentId) {
  if (parentId == null) return false;
  if (Number(parentId) === Number(ticketId)) return true;

  const seen = new Set();
  let current = Number(parentId);
  for (let hops = 0; hops < 1000; hops += 1) {
    if (seen.has(current)) return true;
    seen.add(current);
    if (current === Number(ticketId)) return true;
    const next = await loadParentId(current);
    if (next == null) return false;
    current = Number(next);
  }
  return true;
}

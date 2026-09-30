'use client';

import { useEffect, useRef, useState } from 'react';

import { STATUS_META, STATUS_ORDER, PRIORITY_META, PRIORITY_ORDER, TYPE_META, TYPE_ORDER } from '../meta';
import { isDone } from '../../lib/ticketTree';

/**
 * View preferences that outlive a visit to the list: which columns are hidden,
 * whether finished work is hidden, whether the tree is shown, and any
 * conditional format rules. They are per project (or per workspace for the
 * cross-project list) because Jira treats a saved view as per project.
 */

const KEY = (scopeId) => `ticketing:list-view:${scopeId}`;

const DEFAULTS = {
  hideDone: false,
  showHierarchy: true,
  formatRules: [],
};

export function readViewPrefs(scopeId) {
  if (typeof window === 'undefined') return { ...DEFAULTS };
  try {
    const raw = window.localStorage.getItem(KEY(scopeId));
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    return {
      hideDone: Boolean(parsed.hideDone),
      // Hierarchy is on unless it was explicitly switched off, so a save from an
      // older build that predates the flag still opens in tree view.
      showHierarchy: parsed.showHierarchy !== false,
      formatRules: Array.isArray(parsed.formatRules) ? parsed.formatRules.filter(isValidRule) : [],
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function writeViewPrefs(scopeId, prefs) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      KEY(scopeId),
      JSON.stringify({
        hideDone: prefs.hideDone,
        showHierarchy: prefs.showHierarchy,
        formatRules: prefs.formatRules,
      })
    );
  } catch {
    // A full or blocked storage is not worth failing the view over.
  }
}

const FIELDS = {
  priority: { label: 'Priority', kind: 'status' },
  status: { label: 'Status', kind: 'status' },
  type: { label: 'Issue type', kind: 'status' },
  assignee: { label: 'Assignee', kind: 'person' },
  overdue: { label: 'Overdue', kind: 'flag' },
  label: { label: 'Label', kind: 'text' },
};

const EFFECTS = {
  bold: { label: 'Bold row' },
  red: { label: 'Red text' },
  green: { label: 'Green text' },
  highlight: { label: 'Yellow highlight' },
  strike: { label: 'Strikethrough' },
};

export { FIELDS as RULE_FIELDS, EFFECTS as RULE_EFFECTS };

function isValidRule(rule) {
  return (
    rule &&
    typeof rule.id === 'string' &&
    FIELDS[rule.field] &&
    EFFECTS[rule.effect] &&
    typeof rule.value === 'string'
  );
}

export function newRule() {
  return {
    id: `rule-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    field: 'priority',
    value: 'high',
    effect: 'bold',
  };
}

/** Options offered for a rule's value, given its field. Empty for free text. */
export function ruleValueOptions(field) {
  if (field === 'priority') return PRIORITY_ORDER.map((p) => ({ value: p, label: PRIORITY_META[p].label }));
  if (field === 'status') return STATUS_ORDER.map((s) => ({ value: s, label: STATUS_META[s].label }));
  if (field === 'type') return TYPE_ORDER.map((t) => ({ value: t, label: TYPE_META[t].label }));
  if (field === 'overdue') return [{ value: 'true', label: 'Is overdue' }];
  return [];
}

/** The values a rule's field can actually hold, for matching. */
function fieldValue(ticket, field) {
  if (field === 'assignee') {
    return ticket.employee_id == null ? 'unassigned' : String(ticket.employee_id);
  }
  if (field === 'label') {
    return (ticket.labels || '')
      .split(',')
      .map((l) => l.trim().toLowerCase())
      .filter(Boolean);
  }
  if (field === 'type') return ticket.type || 'task';
  return ticket[field];
}

/**
 * Whether a ticket is past its due date and not finished. A ticket with no due
 * date is never overdue, and a done ticket is not either: the work already
 * landed, so red text on it would be noise.
 */
export function isOverdue(ticket, today = new Date()) {
  const due = String(ticket.due_date || '').trim();
  if (!due) return false;
  if (isDone(ticket)) return false;
  const start = new Date(`${due}T00:00:00Z`).getTime();
  if (!Number.isFinite(start)) return false;
  const end = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  ).getTime();
  return start < end;
}

/** Effects that apply to a row, in rule order. Later rules win on conflict. */
export function matchRules(ticket, rules) {
  const hit = [];
  for (const rule of rules) {
    const actual = fieldValue(ticket, rule.field);
    let matched = false;
    if (rule.field === 'label') {
      matched = Array.isArray(actual) && actual.includes(rule.value.trim().toLowerCase());
    } else if (rule.field === 'overdue') {
      matched = isOverdue(ticket);
    } else {
      matched = String(actual ?? '') === rule.value;
    }
    if (matched) hit.push(rule);
  }
  return hit;
}

/**
 * Custom properties for a row from its matched rules.
 *
 * Values are passed as custom properties rather than plain `color` or
 * `background` because every cell paints its own surface and colour, so
 * anything set directly on the row would be overridden by the cell rules.
 * The stylesheet applies these to the cells instead, where they are visible.
 */
export function rowStyle(effects) {
  const style = {};
  for (const effect of effects) {
    if (effect === 'bold') style['--fmt-weight'] = '600';
    if (effect === 'red') style['--fmt-color'] = '#ae2e24';
    if (effect === 'green') style['--fmt-color'] = '#216e4e';
    if (effect === 'highlight') style['--fmt-bg'] = '#fffae6';
    if (effect === 'strike') style['--fmt-decoration'] = 'line-through';
  }
  return style;
}

export function describeRule(rule) {
  if (rule.field === 'overdue') return `If ${FIELDS.overdue.label} → ${EFFECTS[rule.effect].label}`;
  const options = ruleValueOptions(rule.field);
  const match = options.find((o) => o.value === rule.value);
  return `If ${FIELDS[rule.field].label} = ${match ? match.label : rule.value} → ${EFFECTS[rule.effect].label}`;
}

/**
 * Hover a toggle row without activating it. A switch inside a button is not a
 * real control, so the row is a button for the keyboard and the pointer rests
 * on it to reveal the switch; clicking toggles straight away, as Jira does.
 */
export function ToggleRow({ label, checked, onToggle, disabled, title }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className="menu-item list-toggle-row"
      disabled={disabled}
      title={title}
      onClick={onToggle}
    >
      <span className="menu-item-text">{label}</span>
      <span className={`switch${checked ? ' is-on' : ''}`} aria-hidden="true">
        <span className="switch-knob" />
      </span>
    </button>
  );
}

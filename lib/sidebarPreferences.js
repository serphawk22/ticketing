export const SIDEBAR_SECTION_IDS = [
  'reports',
  'issues',
  'people',
  'client-requests',
  'workspaces',
];

function defaults() {
  const sections = {};
  for (const id of SIDEBAR_SECTION_IDS) {
    sections[id] = { collapsed: false, favorite: false };
  }
  return {
    sectionOrder: [...SIDEBAR_SECTION_IDS],
    sections,
    workspaceOrder: [],
    workspaces: {},
    projectOrder: [],
    projects: {},
  };
}

export function createDefaultSidebarPreferences() {
  return defaults();
}

/**
 * Preferences come from a JSON column and from the browser, so every field is
 * kept only when it has the shape the sidebar knows how to use. Unknown section
 * ids are dropped and newly added sections are appended to the current order.
 */
export function normalizeSidebarPreferences(input) {
  let raw = input;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = null;
    }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return defaults();

  const defaultPrefs = defaults();
  const rawOrder = Array.isArray(raw.sectionOrder) ? raw.sectionOrder : [];
  const sectionOrder = [];
  for (const id of rawOrder) {
    if (SIDEBAR_SECTION_IDS.includes(id) && !sectionOrder.includes(id)) {
      sectionOrder.push(id);
    }
  }
  for (const id of SIDEBAR_SECTION_IDS) {
    if (!sectionOrder.includes(id)) sectionOrder.push(id);
  }

  const sections = {};
  for (const id of SIDEBAR_SECTION_IDS) {
    const value = raw.sections && typeof raw.sections === 'object' ? raw.sections[id] : null;
    sections[id] = {
      collapsed: Boolean(value?.collapsed),
      favorite: Boolean(value?.favorite),
    };
  }

  const workspaceOrder = [];
  if (Array.isArray(raw.workspaceOrder)) {
    for (const id of raw.workspaceOrder) {
      const key = String(id);
      if (!workspaceOrder.includes(key)) workspaceOrder.push(key);
    }
  }

  const workspaces = {};
  if (raw.workspaces && typeof raw.workspaces === 'object' && !Array.isArray(raw.workspaces)) {
    for (const [id, value] of Object.entries(raw.workspaces)) {
      if (id === '__proto__' || id === 'constructor' || id === 'prototype') continue;
      if (!value || typeof value !== 'object') continue;
      workspaces[id] = {
        collapsed: Boolean(value.collapsed),
        favorite: Boolean(value.favorite),
      };
    }
  }

  const projectOrder = [];
  if (Array.isArray(raw.projectOrder)) {
    for (const id of raw.projectOrder) {
      const key = String(id);
      if (!projectOrder.includes(key)) projectOrder.push(key);
    }
  }

  const projects = {};
  if (raw.projects && typeof raw.projects === 'object' && !Array.isArray(raw.projects)) {
    for (const [id, value] of Object.entries(raw.projects)) {
      if (id === '__proto__' || id === 'constructor' || id === 'prototype') continue;
      if (!value || typeof value !== 'object') continue;
      projects[id] = {
        favorite: Boolean(value.favorite),
      };
    }
  }

  return {
    ...defaultPrefs,
    sectionOrder,
    sections,
    workspaceOrder,
    workspaces,
    projectOrder,
    projects,
  };
}

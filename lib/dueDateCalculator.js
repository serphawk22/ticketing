/**
 * lib/dueDateCalculator.js
 *
 * Centralized business logic for automatic due date calculation in SerpHawk Ticketing.
 *
 * Rules:
 * - Internal Tickets: 7 calendar days after ticket creation, regardless of project or internal category.
 * - Client-Created Tickets (categorized SLA):
 *     - Incident: 1 calendar day after ticket creation
 *     - Access Issue: 2 calendar days after ticket creation
 *     - Feature Request: 7 calendar days after ticket creation
 * - Dates are stored as bare 'YYYY-MM-DD' strings.
 * - Calendar day arithmetic using UTC boundaries prevents timezone shifts and daylight saving jumps.
 */

export const CLIENT_CATEGORIES = {
  ACCESS_ISSUE: 'Access Issue',
  INCIDENT: 'Incident',
  FEATURE_REQUEST: 'Feature Request',
};

export const CLIENT_CATEGORY_DAYS = {
  access_issue: 2,
  incident: 1,
  feature_request: 7,
};

export const INTERNAL_TICKET_DUE_DAYS = 7;

/**
 * Normalizes client category strings into canonical keys ('access_issue', 'incident', 'feature_request')
 * or returns null if invalid/unsupported.
 *
 * Handles variants like:
 * - "Access Issue", "access_issue", "access-issue", "access issue" -> "access_issue"
 * - "Incident", "incident" -> "incident"
 * - "Feature Request", "feature_request", "feature-request", "feature request" -> "feature_request"
 */
export function normalizeClientCategory(input) {
  if (!input || typeof input !== 'string') return null;
  const cleaned = input.trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (cleaned === 'accessissue') return 'access_issue';
  if (cleaned === 'incident') return 'incident';
  if (cleaned === 'featurerequest') return 'feature_request';
  return null;
}

/**
 * Returns the human-readable canonical display label for a valid client category key or input.
 */
export function getClientCategoryLabel(input) {
  const normalized = normalizeClientCategory(input);
  if (normalized === 'access_issue') return CLIENT_CATEGORIES.ACCESS_ISSUE;
  if (normalized === 'incident') return CLIENT_CATEGORIES.INCIDENT;
  if (normalized === 'feature_request') return CLIENT_CATEGORIES.FEATURE_REQUEST;
  return null;
}

/**
 * Validates if the given input is a supported client category.
 */
export function isValidClientCategory(input) {
  return normalizeClientCategory(input) !== null;
}

/**
 * Adds exact calendar days to a base date without timezone shifts.
 * Returns date in 'YYYY-MM-DD' format.
 */
export function addCalendarDays(baseDate = new Date(), days = 0) {
  let dateObj;
  if (baseDate instanceof Date) {
    dateObj = new Date(baseDate.getTime());
  } else if (typeof baseDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(baseDate.trim())) {
    dateObj = new Date(`${baseDate.trim()}T00:00:00.000Z`);
  } else if (typeof baseDate === 'string' && baseDate.trim()) {
    dateObj = new Date(baseDate.trim().replace(' ', 'T') + (baseDate.includes('Z') ? '' : 'Z'));
  } else {
    dateObj = new Date();
  }

  if (Number.isNaN(dateObj.getTime())) {
    dateObj = new Date();
  }

  const utcYear = dateObj.getUTCFullYear();
  const utcMonth = dateObj.getUTCMonth();
  const utcDay = dateObj.getUTCDate();

  const target = new Date(Date.UTC(utcYear, utcMonth, utcDay + Number(days || 0)));
  return target.toISOString().slice(0, 10);
}

/**
 * Authoritatively calculates ticket due date based on creator role and category.
 *
 * @param {Object} params
 * @param {string} params.role - User role ('client', 'admin', 'employee', etc.)
 * @param {string} [params.category] - Ticket category (required for clients)
 * @param {string} [params.type] - Ticket type (fallback inspect)
 * @param {Date|string} [params.creationDate] - Creation date/timestamp
 * @param {string|null} [params.customDueDate] - Admin/Owner custom due date (only permitted for admin/owner)
 * @param {boolean} [params.isAdminOrOwner] - Whether actor has admin/owner privileges
 * @returns {{ dueDate: string, initialDueDate: string, clientCategory: string|null }}
 */
export function calculateAutomaticDueDate({
  role,
  category = '',
  type = '',
  creationDate = new Date(),
  customDueDate = null,
  isAdminOrOwner = false,
}) {
  const isClient = String(role || '').toLowerCase() === 'client';

  if (isClient) {
    const rawVal = category || type || '';
    const normalized = normalizeClientCategory(rawVal);
    if (!normalized) {
      throw new Error(
        'Client requests require a valid request type. Allowed: Access Issue, Incident, Feature Request.'
      );
    }
    const days = CLIENT_CATEGORY_DAYS[normalized];
    const dueDate = addCalendarDays(creationDate, days);
    return {
      dueDate,
      initialDueDate: dueDate,
      clientCategory: getClientCategoryLabel(normalized),
    };
  }

  // Internal ticket: Admin/Owner can specify custom due date during creation
  if (isAdminOrOwner && customDueDate && /^\d{4}-\d{2}-\d{2}$/.test(String(customDueDate).trim())) {
    const cleanCustom = String(customDueDate).trim();
    return {
      dueDate: cleanCustom,
      initialDueDate: cleanCustom,
      clientCategory: null,
    };
  }

  // Default internal ticket: 7 calendar days
  const dueDate = addCalendarDays(creationDate, INTERNAL_TICKET_DUE_DAYS);
  return {
    dueDate,
    initialDueDate: dueDate,
    clientCategory: null,
  };
}

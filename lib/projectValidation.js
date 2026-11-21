const KEY_PATTERN = /^[A-Z0-9]{2,6}$/;
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

export function isValidProjectKey(key) {
  return typeof key === 'string' && KEY_PATTERN.test(key);
}

export function isValidProjectColor(color) {
  return typeof color === 'string' && COLOR_PATTERN.test(color);
}

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Validates and normalizes an optional YYYY-MM-DD project target date.
 * Empty/nullish inputs normalize to `null`.
 */
export function normalizeProjectTargetDate(value) {
  if (value === undefined || value === null) {
    return { valid: true, value: null };
  }
  const trimmed = String(value).trim();
  if (!trimmed) {
    return { valid: true, value: null };
  }
  const match = ISO_DATE_PATTERN.exec(trimmed);
  if (!match) {
    return { valid: false, value: null };
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== month - 1 ||
    dt.getUTCDate() !== day
  ) {
    return { valid: false, value: null };
  }
  return { valid: true, value: trimmed };
}

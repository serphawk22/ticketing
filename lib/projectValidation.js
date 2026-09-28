const KEY_PATTERN = /^[A-Z0-9]{2,6}$/;
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

export function isValidProjectKey(key) {
  return typeof key === 'string' && KEY_PATTERN.test(key);
}

export function isValidProjectColor(color) {
  return typeof color === 'string' && COLOR_PATTERN.test(color);
}

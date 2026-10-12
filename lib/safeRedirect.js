/**
 * Reduce a `next` query value to a same-origin path, or '' when it is not one.
 *
 * Login and the forced password-change screen both honour a `next` target so a
 * ticket link survives sign-in. That value comes from the URL, so it is treated
 * as untrusted: a full URL, a protocol-relative `//host`, a backslash or a
 * scheme separator would all let an attacker turn the form into an open
 * redirect. Only a plain absolute path is allowed through.
 */
export function safeRedirectPath(value) {
  if (typeof value !== 'string' || value === '') return '';
  if (value[0] !== '/' || value[1] === '/') return '';
  if (value.includes('\\') || value.includes(':')) return '';
  return value;
}

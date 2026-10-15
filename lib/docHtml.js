const ALLOWED = new Set([
  'p', 'br', 'div', 'strong', 'b', 'em', 'i', 'u', 's',
  'h1', 'h2', 'h3', 'ul', 'ol', 'li', 'a', 'code', 'pre', 'blockquote',
]);

function escapeAttr(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

function safeUrl(url) {
  const value = String(url || '').trim();
  if (/^https?:\/\//i.test(value)) return value;
  if (/^mailto:/i.test(value)) return value;
  if (value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\')) return value;
  return '';
}

function rewriteTag(match, tag, attrs) {
  const name = tag.toLowerCase();
  if (!ALLOWED.has(name)) return '';
  if (match.startsWith('</')) return `</${name}>`;
  if (name === 'br') return '<br>';
  if (name !== 'a') return `<${name}>`;

  const hrefMatch = /href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs || '');
  const href = safeUrl(hrefMatch ? (hrefMatch[1] ?? hrefMatch[2] ?? hrefMatch[3] ?? '') : '');
  const keyMatch = /data-key\s*=\s*"([A-Za-z][A-Za-z0-9]*-\d+)"/i.exec(attrs || '');
  const classMatch = /class\s*=\s*"([^"]*)"/i.exec(attrs || '');
  const isIssue = Boolean(keyMatch) && classMatch && classMatch[1].split(/\s+/).includes('doc-issue');

  let built = '<a';
  if (href) built += ` href="${escapeAttr(href)}"`;
  if (isIssue) built += ` class="doc-issue" data-key="${keyMatch[1]}"`;
  return `${built}>`;
}

// Keeps the marks the editor produces and drops everything else, including
// scripts and event handlers. The page renders this HTML directly.
export function sanitizeDocHtml(input) {
  const html = String(input || '').replace(/\0/g, '');
  const stripped = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|iframe|object|embed|link|meta)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<(script|style|iframe|object|embed|link|meta)\b[^>]*\/?>/gi, '');

  return stripped
    .replace(/<\/?([a-zA-Z0-9]+)([^>]*)>/g, rewriteTag)
    .replace(/<(?!\/?(?:p|br|div|strong|b|em|i|u|s|h1|h2|h3|ul|ol|li|a|code|pre|blockquote)\b)[^>]*>/gi, '');
}

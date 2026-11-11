/**
 * Shared ticket-reference detection, validation, and safe HTML/text tokenization.
 *
 * Project keys follow `lib/projectValidation.js` (`^[A-Z0-9]{2,6}$`), with `'TM'`
 * as the unassigned fallback prefix from `lib/ticketMeta.js`.
 */

const TICKET_KEY_EXACT_RE = /^([A-Z0-9]{2,6})-([1-9]\d*)$/i;
const URL_SPAN_RE = /(?:https?:\/\/|mailto:|www\.)[^\s<>"')\]}]+/gi;
const TOKEN_RE =
  /(^|[^A-Za-z0-9_/-])(\[[A-Za-z0-9]{2,6}-[1-9]\d*\]|[A-Za-z0-9]{2,6}-[1-9]\d*)(?![A-Za-z0-9_-])/g;

const SKIP_HTML_TAGS = new Set(['a', 'code', 'pre', 'script', 'style', 'textarea']);

/**
 * Parses a ticket key string such as `"TM-101"` or `"[WEB-104]"`.
 * Returns normalized `{ prefix, id, key }` or `null` if invalid.
 */
export function parseTicketKey(raw) {
  if (typeof raw !== 'string') return null;
  let trimmed = raw.trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    trimmed = trimmed.slice(1, -1).trim();
  }
  const match = TICKET_KEY_EXACT_RE.exec(trimmed);
  if (!match) return null;
  const prefix = match[1].toUpperCase();
  const id = Number(match[2]);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return {
    prefix,
    id,
    key: `${prefix}-${id}`,
  };
}

/**
 * Builds the set of valid uppercase project prefixes from a project list.
 * Always includes `'TM'` for unassigned/default tickets.
 */
export function buildValidPrefixSet(projects = []) {
  const prefixes = new Set(['TM']);
  for (const project of projects || []) {
    const key = typeof project === 'string' ? project : project?.key;
    if (typeof key !== 'string') continue;
    const clean = key.trim().toUpperCase();
    if (/^[A-Z0-9]{2,6}$/.test(clean)) {
      prefixes.add(clean);
    }
  }
  return prefixes;
}

/**
 * Normalizes a collection of ticket objects or key strings into a Set of
 * uppercase ticket keys (`"TM-101"`).
 */
export function buildExistingKeySet(ticketsOrKeys = []) {
  const keys = new Set();
  for (const item of ticketsOrKeys || []) {
    if (!item) continue;
    if (typeof item === 'string') {
      const parsed = parseTicketKey(item);
      if (parsed) keys.add(parsed.key);
      continue;
    }
    if (item.id != null) {
      const prefix = String(item.project_key || 'TM').trim().toUpperCase();
      const id = Number(item.id);
      if (/^[A-Z0-9]{2,6}$/.test(prefix) && Number.isSafeInteger(id) && id > 0) {
        keys.add(`${prefix}-${id}`);
      }
    } else if (typeof item.key === 'string') {
      const parsed = parseTicketKey(item.key);
      if (parsed) keys.add(parsed.key);
    }
  }
  return keys;
}

function toSet(value) {
  if (!value) return null;
  if (value instanceof Set) return value;
  return new Set([...value].map((v) => String(v).trim().toUpperCase()).filter(Boolean));
}

function findUrlSpans(text) {
  const spans = [];
  URL_SPAN_RE.lastIndex = 0;
  let match;
  while ((match = URL_SPAN_RE.exec(text)) !== null) {
    spans.push([match.index, match.index + match[0].length]);
  }
  return spans;
}

function insideSpans(start, end, spans) {
  for (const [s, e] of spans) {
    if (start < e && end > s) return true;
  }
  return false;
}

/**
 * Extracts validated ticket-reference tokens from plain text.
 *
 * When `existingKeys` is provided, only keys present in `existingKeys` match.
 * When `validPrefixes` is provided without `existingKeys`, only keys whose
 * prefix is in `validPrefixes` match (useful for collecting candidates before
 * backend existence verification).
 */
export function extractTicketRefTokens(text, { validPrefixes = null, existingKeys = null } = {}) {
  if (!text || typeof text !== 'string') return [];

  const prefixSet = toSet(validPrefixes);
  const existingSet = toSet(existingKeys);
  const urlSpans = findUrlSpans(text);
  const tokens = [];

  TOKEN_RE.lastIndex = 0;
  let match;
  while ((match = TOKEN_RE.exec(text)) !== null) {
    const boundary = match[1] || '';
    const raw = match[2];
    const start = match.index + boundary.length;
    const end = start + raw.length;

    if (insideSpans(start, end, urlSpans)) continue;

    const bracketed = raw.startsWith('[') && raw.endsWith(']');
    const parsed = parseTicketKey(raw);
    if (!parsed) continue;

    if (existingSet) {
      if (!existingSet.has(parsed.key)) continue;
    } else if (prefixSet) {
      if (!prefixSet.has(parsed.prefix)) continue;
    }

    tokens.push({
      start,
      end,
      raw,
      key: parsed.key,
      prefix: parsed.prefix,
      id: parsed.id,
      bracketed,
    });
  }

  return tokens;
}

/**
 * Extracts unique candidate ticket keys from text (or an array of strings).
 * Filters by `validPrefixes` if supplied to avoid spurious lookups.
 */
export function extractCandidateTicketKeys(input, { validPrefixes = null } = {}) {
  const list = Array.isArray(input) ? input : [input];
  const seen = new Set();
  for (const item of list) {
    if (typeof item !== 'string' || !item) continue;
    for (const token of extractTicketRefTokens(item, { validPrefixes })) {
      seen.add(token.key);
    }
  }
  return [...seen];
}

/**
 * Splits plain text into alternating `{ type: 'text', value }` and
 * `{ type: 'ticket', key, raw, bracketed }` segments.
 *
 * Requires `existingKeys` (or `requireExisting: false` with `validPrefixes`)
 * so unverified hyphenated tokens are never linkified.
 */
export function tokenizeTicketRefs(
  text,
  { validPrefixes = null, existingKeys = null, requireExisting = true } = {}
) {
  if (!text || typeof text !== 'string') {
    return text ? [{ type: 'text', value: String(text) }] : [];
  }

  if (requireExisting && !existingKeys) {
    return [{ type: 'text', value: text }];
  }

  const tokens = extractTicketRefTokens(text, { validPrefixes, existingKeys });
  if (tokens.length === 0) {
    return [{ type: 'text', value: text }];
  }

  const segments = [];
  let cursor = 0;

  for (const tok of tokens) {
    if (tok.start > cursor) {
      segments.push({ type: 'text', value: text.slice(cursor, tok.start) });
    }
    segments.push({
      type: 'ticket',
      key: tok.key,
      raw: tok.raw,
      bracketed: tok.bracketed,
    });
    cursor = tok.end;
  }

  if (cursor < text.length) {
    segments.push({ type: 'text', value: text.slice(cursor) });
  }

  return segments;
}

/**
 * Returns the canonical URL path for opening a ticket in a browser tab.
 */
export function ticketHref(key) {
  return `/t/${encodeURIComponent(String(key || '').toUpperCase())}`;
}

/**
 * Safely linkifies plain-text ticket references inside an HTML string while
 * preserving all existing HTML structure and skipping `<a>`, `<code>`,
 * `<pre>`, `<script>`, `<style>`, and `<textarea>` elements.
 */
export function linkifyHtmlTicketRefs(
  html,
  {
    validPrefixes = null,
    existingKeys = null,
    requireExisting = true,
    className = 'doc-issue',
  } = {}
) {
  const source = String(html || '');
  if (!source) return '';
  if (requireExisting && !existingKeys) return source;

  const existingSet = toSet(existingKeys);
  const prefixSet = toSet(validPrefixes);
  if (requireExisting && existingSet && existingSet.size === 0) return source;

  const skipCounts = Object.create(null);
  let skipDepth = 0;

  // Tokenize HTML into tags (`<...>`) and text runs.
  const parts = source.split(/(<[^>]+>)/g);
  const out = [];

  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (!part) continue;

    if (part.startsWith('<') && part.endsWith('>')) {
      const tagMatch = /^<\/?\s*([a-zA-Z0-9]+)/.exec(part);
      if (tagMatch) {
        const tag = tagMatch[1].toLowerCase();
        if (SKIP_HTML_TAGS.has(tag)) {
          const isClosing = part.startsWith('</');
          const isSelfClosing = /\/>$/.test(part);
          if (isClosing) {
            if ((skipCounts[tag] || 0) > 0) {
              skipCounts[tag] -= 1;
              skipDepth -= 1;
            }
          } else if (!isSelfClosing) {
            skipCounts[tag] = (skipCounts[tag] || 0) + 1;
            skipDepth += 1;
          }
        }
      }
      out.push(part);
      continue;
    }

    if (skipDepth > 0) {
      out.push(part);
      continue;
    }

    const segments = tokenizeTicketRefs(part, {
      validPrefixes: prefixSet,
      existingKeys: existingSet,
      requireExisting,
    });

    if (segments.length === 1 && segments[0].type === 'text') {
      out.push(part);
      continue;
    }

    for (const seg of segments) {
      if (seg.type === 'text') {
        out.push(seg.value);
      } else {
        const href = ticketHref(seg.key);
        const anchor = `<a class="${className}" data-key="${seg.key}" href="${href}">${seg.key}</a>`;
        out.push(seg.bracketed ? `[${anchor}]` : anchor);
      }
    }
  }

  return out.join('');
}

/**
 * Collects candidate ticket keys from plain text inside an HTML string,
 * skipping `<a>`, `<code>`, `<pre>`, `<script>`, `<style>`, and `<textarea>`.
 */
export function extractCandidateTicketKeysFromHtml(html, { validPrefixes = null } = {}) {
  const source = String(html || '');
  if (!source) return [];

  const skipCounts = Object.create(null);
  let skipDepth = 0;
  const parts = source.split(/(<[^>]+>)/g);
  const seen = new Set();

  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith('<') && part.endsWith('>')) {
      const tagMatch = /^<\/?\s*([a-zA-Z0-9]+)/.exec(part);
      if (tagMatch) {
        const tag = tagMatch[1].toLowerCase();
        if (SKIP_HTML_TAGS.has(tag)) {
          const isClosing = part.startsWith('</');
          const isSelfClosing = /\/>$/.test(part);
          if (isClosing) {
            if ((skipCounts[tag] || 0) > 0) {
              skipCounts[tag] -= 1;
              skipDepth -= 1;
            }
          } else if (!isSelfClosing) {
            skipCounts[tag] = (skipCounts[tag] || 0) + 1;
            skipDepth += 1;
          }
        }
      }
      continue;
    }

    if (skipDepth > 0) continue;
    for (const key of extractCandidateTicketKeys(part, { validPrefixes })) {
      seen.add(key);
    }
  }

  return [...seen];
}

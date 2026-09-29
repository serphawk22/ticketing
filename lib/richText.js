/**
 * A deliberately small rich-text format for ticket descriptions.
 *
 * Descriptions are stored as markdown text rather than HTML. That keeps the
 * column a plain string (no schema change, no HTML sanitiser to maintain) and
 * every render escapes its input, so a description can never inject markup.
 *
 * Supported: paragraphs, hard line breaks, **bold**, *italic*, bullets, ordered
 * lists, and [links](https://...).
 */

const SAFE_SCHEME = /^(https?:|mailto:)/i;

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function safeHref(url) {
  const trimmed = String(url || '').trim();
  return SAFE_SCHEME.test(trimmed) ? escapeHtml(trimmed) : null;
}

/** Markdown -> HTML. Every piece of user text is escaped first. */
export function markdownToHtml(md) {
  const source = String(md || '');
  if (!source.trim()) return '';

  const inline = (raw) =>
    escapeHtml(raw)
      .replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, (match, label, url) => {
        const href = safeHref(url);
        return href ? `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>` : match;
      })
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/__([^_]+)__/g, '<strong>$1</strong>');

  const blocks = source.replace(/\r\n/g, '\n').split(/\n{2,}/);

  return blocks
    .map((block) => {
      const lines = block.split('\n');
      const text = lines.map((l) => l.trim()).filter(Boolean);
      if (!text.length) return '';

      if (text.every((l) => /^- /.test(l))) {
        const items = text.map((l) => `<li>${inline(l.slice(2))}</li>`).join('');
        return `<ul>${items}</ul>`;
      }

      if (text.every((l) => /^\d+\. /.test(l))) {
        const items = text.map((l) => `<li>${inline(l.replace(/^\d+\. /, ''))}</li>`).join('');
        return `<ol>${items}</ol>`;
      }

      return `<p>${text.map(inline).join('<br />')}</p>`;
    })
    .filter(Boolean)
    .join('');
}

const INLINE_TAGS = { B: '**', STRONG: '**', I: '*', EM: '*' };

/**
 * Reads a contentEditable subtree back into markdown. `root` may be a DOM node
 * or an HTML string.
 */
export function htmlToMarkdown(input) {
  const root = typeof input === 'string' ? parseHtml(input) : input;
  if (!root) return '';

  const out = [];
  const inline = (node) => {
    if (node.nodeType === 3) {
      out.push(node.nodeValue);
      return;
    }
    if (node.nodeType !== 1) return;

    const tag = node.tagName;
    if (tag === 'BR') {
      out.push('\n');
      return;
    }
    if (tag === 'A') {
      const href = node.getAttribute('href') || '';
      const label = collect(node).trim();
      out.push(href && label ? `[${label}](${href})` : label);
      return;
    }

    const marker = INLINE_TAGS[tag];
    if (marker) {
      out.push(marker);
      node.childNodes.forEach(inline);
      out.push(marker);
      return;
    }

    node.childNodes.forEach(inline);
  };

  const collect = (node) => {
    const parts = [];
    const push = (child) => {
      if (child.nodeType === 3) parts.push(child.nodeValue);
      else if (child.nodeType === 1) parts.push(collect(child));
    };
    node.childNodes.forEach(push);
    return parts.join('');
  };

  const isBlock = (node) =>
    node.nodeType === 1 && /^(P|DIV|LI|UL|OL|BLOCKQUOTE|PRE|H[1-6])$/.test(node.tagName);

  const walk = (node, depth) => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === 3) {
        out.push(child.nodeValue);
        return;
      }
      if (child.nodeType !== 1) return;

      const tag = child.tagName;
      if (tag === 'UL' || tag === 'OL') {
        if (depth >= 0) out.push('\n\n');
        let index = 0;
        child.childNodes.forEach((li) => {
          if (li.nodeType !== 1 || li.tagName !== 'LI') return;
          index += 1;
          if (depth >= 0) out.push('\n');
          out.push(tag === 'OL' ? `${index}. ` : '- ');
          li.childNodes.forEach(inline);
        });
        if (depth >= 0) out.push('\n\n');
        return;
      }
      if (tag === 'DIV' || tag === 'P') {
        if (depth >= 0) out.push('\n\n');
        walk(child, depth + 1);
        if (depth >= 0) out.push('\n\n');
        return;
      }
      if (isBlock(child)) {
        if (depth >= 0) out.push('\n\n');
        walk(child, depth + 1);
        if (depth >= 0) out.push('\n\n');
        return;
      }
      inline(child);
    });
  };

  walk(root, -1);

  return out
    .join('')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseHtml(html) {
  if (typeof document === 'undefined') return null;
  const holder = document.createElement('div');
  holder.innerHTML = html;
  return holder;
}

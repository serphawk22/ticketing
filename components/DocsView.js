'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AppShell from './AppShell';
import PageHeader from './PageHeader';
import ProjectTabs from './ProjectTabs';
import EmptyState from './EmptyState';
import ConfirmModal from './ConfirmModal';
import TicketDetailModal from './ticket/TicketDetailModal';
import useTicketModal from './useTicketModal';
import { TicketModalStatus, validateTicketKeys } from './TicketText';
import { useToasts, Toaster } from './Toaster';
import { TypeIcon, formatListDateTime, ticketKey } from './meta';
import {
  buildExistingKeySet,
  buildValidPrefixSet,
  extractCandidateTicketKeys,
  extractCandidateTicketKeysFromHtml,
  extractTicketRefTokens,
  linkifyHtmlTicketRefs,
  parseTicketKey,
  ticketHref,
} from '../lib/ticketRefs';

const SLASH = [
  { id: 'h2', label: 'Heading', hint: 'Large section heading' },
  { id: 'text', label: 'Text', hint: 'Plain paragraph' },
  { id: 'ul', label: 'Bullet list', hint: 'An unordered list' },
  { id: 'ol', label: 'Numbered list', hint: 'An ordered list' },
  { id: 'quote', label: 'Quote', hint: 'Call out a note' },
  { id: 'code', label: 'Code', hint: 'A code snippet' },
  { id: 'issue', label: 'Work item', hint: 'Link a work item in this project' },
];

function docLabel(doc) {
  return doc?.title?.trim() || 'Untitled';
}

function PageIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function ChevronIcon({ open }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className={open ? 'docs-chevron is-open' : 'docs-chevron'}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

function buildRows(docs, query, collapsed) {
  const byParent = new Map();
  for (const doc of docs) {
    const key = doc.parent_id == null ? 0 : Number(doc.parent_id);
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(doc);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => a.position - b.position || a.id - b.id);
  }

  const byId = new Map(docs.map((doc) => [Number(doc.id), doc]));
  const needle = query.trim().toLowerCase();
  const matched = new Set();
  if (needle) {
    for (const doc of docs) {
      if (!docLabel(doc).toLowerCase().includes(needle)) continue;
      let cursor = doc;
      while (cursor) {
        matched.add(Number(cursor.id));
        cursor = cursor.parent_id == null ? null : byId.get(Number(cursor.parent_id));
      }
    }
  }

  const rows = [];
  function walk(parentKey, depth) {
    for (const doc of byParent.get(parentKey) || []) {
      if (needle && !matched.has(Number(doc.id))) continue;
      const children = (byParent.get(Number(doc.id)) || []).filter((child) => !needle || matched.has(Number(child.id)));
      rows.push({ doc, depth, hasChildren: children.length > 0 });
      const open = Boolean(needle) || !collapsed[doc.id];
      if (open) walk(Number(doc.id), depth + 1);
    }
  }
  walk(0, 0);
  return rows;
}

const SKIP_DOC_TAGS = new Set(['A', 'CODE', 'PRE', 'SCRIPT', 'STYLE', 'TEXTAREA']);

function isInsideSkippedDocTag(node, root) {
  let cursor = node?.nodeType === 3 ? node.parentElement : node;
  while (cursor && cursor !== root) {
    if (SKIP_DOC_TAGS.has(cursor.tagName)) return true;
    cursor = cursor.parentElement;
  }
  return false;
}

function createDocIssueAnchor(key) {
  const anchor = document.createElement('a');
  anchor.className = 'doc-issue';
  anchor.setAttribute('data-key', key);
  anchor.setAttribute('href', ticketHref(key));
  anchor.textContent = key;
  return anchor;
}

/**
 * Replaces validated ticket references inside `textNode` with `<a class="doc-issue">`
 * elements while preserving collapsed caret position if it lies inside `textNode`.
 */
function replaceTicketsInTextNode(textNode, validSet, root) {
  const text = textNode.nodeValue || '';
  const tokens = extractTicketRefTokens(text, { existingKeys: validSet });
  if (tokens.length === 0) return false;

  const selection = typeof window !== 'undefined' ? window.getSelection() : null;
  const hasCaret =
    selection &&
    selection.rangeCount > 0 &&
    selection.isCollapsed &&
    selection.anchorNode === textNode &&
    root.contains(textNode);
  const caretOffset = hasCaret ? selection.anchorOffset : -1;

  const frag = document.createDocumentFragment();
  let cursor = 0;
  let targetNode = null;
  let targetOffset = 0;

  const appendText = (str) => {
    if (!str) return null;
    const node = document.createTextNode(str);
    frag.appendChild(node);
    return node;
  };

  for (const tok of tokens) {
    if (tok.start > cursor) {
      const beforeStr = text.slice(cursor, tok.start);
      const beforeNode = appendText(beforeStr);
      if (hasCaret && !targetNode && caretOffset >= cursor && caretOffset <= tok.start) {
        targetNode = beforeNode;
        targetOffset = caretOffset - cursor;
      }
    }

    if (tok.bracketed) appendText('[');
    const anchor = createDocIssueAnchor(tok.key);
    frag.appendChild(anchor);
    if (tok.bracketed) appendText(']');

    if (hasCaret && !targetNode && caretOffset > tok.start && caretOffset <= tok.end) {
      // Place caret immediately after the chip (or closing bracket) if it was at token end.
      const afterTokenNode = appendText('');
      targetNode = afterTokenNode;
      targetOffset = 0;
    }

    cursor = tok.end;
  }

  if (cursor < text.length) {
    const tailStr = text.slice(cursor);
    const tailNode = appendText(tailStr);
    if (hasCaret && !targetNode && caretOffset >= cursor) {
      targetNode = tailNode;
      targetOffset = caretOffset - cursor;
    }
  } else if (hasCaret && !targetNode) {
    targetNode = appendText('');
    targetOffset = 0;
  }

  textNode.parentNode?.replaceChild(frag, textNode);

  if (hasCaret && targetNode && selection) {
    const nextRange = document.createRange();
    nextRange.setStart(targetNode, Math.min(targetOffset, targetNode.nodeValue?.length || 0));
    nextRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(nextRange);
  }

  return true;
}

function linkifyDomSubtree(root, validSet) {
  if (!root || !validSet || validSet.size === 0) return false;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const targets = [];
  let current;
  while ((current = walker.nextNode())) {
    if (!current.nodeValue || isInsideSkippedDocTag(current, root)) continue;
    targets.push(current);
  }
  let changed = false;
  for (const textNode of targets) {
    if (replaceTicketsInTextNode(textNode, validSet, root)) {
      changed = true;
    }
  }
  return changed;
}

function unwrapBrokenDocIssues(root) {
  if (!root) return false;
  let changed = false;
  const links = root.querySelectorAll('a.doc-issue');
  for (const link of links) {
    const text = (link.textContent || '').trim();
    const parsed = parseTicketKey(text);
    if (!parsed) {
      link.replaceWith(document.createTextNode(link.textContent || ''));
      changed = true;
    } else if (parsed.key !== (link.getAttribute('data-key') || '').toUpperCase()) {
      link.setAttribute('data-key', parsed.key);
      link.setAttribute('href', ticketHref(parsed.key));
      changed = true;
    }
  }
  return changed;
}

function DocEditor({
  doc,
  project,
  tickets,
  validPrefixes,
  knownKeys,
  currentUser,
  canMoveUp,
  canMoveDown,
  onSaved,
  onCreateChild,
  onDuplicate,
  onMove,
  onDelete,
  onOpenTicket,
  clientRequests = false,
}) {
  const docsApiBase = clientRequests
    ? '/api/client-requests/docs'
    : `/api/projects/${project.id}/docs`;
  const docsHref = (docId) =>
    clientRequests
      ? docId
        ? `/client-requests/docs/${docId}`
        : '/client-requests/docs'
      : docId
        ? `/projects/${project.id}/docs/${docId}`
        : `/projects/${project.id}/docs`;
  const titleRef = useRef(null);
  const editorRef = useRef(null);
  const timer = useRef(null);
  const pending = useRef(null);
  const [title, setTitle] = useState(doc.title || '');
  const [savedMeta, setSavedMeta] = useState(doc);
  const [status, setStatus] = useState('Saved');
  const [slash, setSlash] = useState(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');

  const initialBodyHtml = useMemo(
    () =>
      linkifyHtmlTicketRefs(doc.body || '', {
        validPrefixes,
        existingKeys: knownKeys,
        requireExisting: true,
      }),
    // Only compute when switching documents so auto-save updates never reset the editor caret.
    [doc.id] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Also resolve any archived or remote ticket references present in the saved doc.
  useEffect(() => {
    const candidates = extractCandidateTicketKeysFromHtml(doc.body || '', { validPrefixes });
    const missing = candidates.filter((k) => !knownKeys.has(k));
    if (missing.length === 0) return undefined;

    let cancelled = false;
    validateTicketKeys(missing, knownKeys).then((verified) => {
      if (cancelled || !editorRef.current || verified.size === 0) return;
      linkifyDomSubtree(editorRef.current, verified);
    });
    return () => {
      cancelled = true;
    };
  }, [doc.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!doc.title) titleRef.current?.focus();
  }, [doc.id, doc.title]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    const payload = pending.current;
    if (!payload) return;
    fetch(`${docsApiBase}/${doc.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    });
  }, [project.id, doc.id]);

  function readBody() {
    return editorRef.current?.innerHTML || '';
  }

  async function save(nextTitle, nextBody) {
    setStatus('Saving…');
    try {
      const res = await fetch(`${docsApiBase}/${doc.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: nextTitle, body: nextBody }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not save this doc.');
      setStatus('Saved');
      setSavedMeta(data.doc);
      onSaved(data.doc);
    } catch (err) {
      setStatus(err.message);
    }
  }

  function schedule(nextTitle, nextBody) {
    pending.current = { title: nextTitle, body: nextBody };
    if (timer.current) clearTimeout(timer.current);
    setStatus('Saving…');
    timer.current = setTimeout(() => {
      const payload = pending.current;
      pending.current = null;
      if (payload) save(payload.title, payload.body);
    }, 600);
  }

  function currentTitle() {
    return titleRef.current?.value ?? title;
  }

  function exec(command, value) {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
    schedule(currentTitle(), readBody());
  }

  function clearSlashChar() {
    const selection = window.getSelection();
    const node = selection?.anchorNode;
    if (!node || node.nodeType !== 3) return;
    const index = node.textContent.lastIndexOf('/');
    if (index < 0) return;
    const range = document.createRange();
    range.setStart(node, index);
    range.setEnd(node, index + 1);
    selection.removeAllRanges();
    selection.addRange(range);
    document.execCommand('delete');
  }

  function runSlash(item) {
    clearSlashChar();
    setSlash(null);
    if (item.id === 'h2') exec('formatBlock', 'H2');
    else if (item.id === 'text') exec('formatBlock', 'P');
    else if (item.id === 'ul') exec('insertUnorderedList');
    else if (item.id === 'ol') exec('insertOrderedList');
    else if (item.id === 'quote') exec('formatBlock', 'BLOCKQUOTE');
    else if (item.id === 'code') exec('formatBlock', 'PRE');
    else if (item.id === 'issue') {
      setPickerQuery('');
      setPickerOpen(true);
    }
  }

  function detectSlash() {
    const selection = window.getSelection();
    if (!selection?.rangeCount || !editorRef.current?.contains(selection.anchorNode)) {
      setSlash(null);
      return;
    }
    const node = selection.anchorNode.nodeType === 3 ? selection.anchorNode.parentElement : selection.anchorNode;
    const block = node?.closest('p,div,li,h1,h2,h3,blockquote,pre') || editorRef.current;
    if ((block?.textContent || '') !== '/') {
      setSlash(null);
      return;
    }
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    setSlashIndex(0);
    setSlash({ top: rect.bottom + 6, left: Math.max(12, rect.left) });
  }

  function insertIssue(ticket) {
    const key = ticketKey(ticket);
    const href = ticketHref(key);
    editorRef.current?.focus();
    document.execCommand(
      'insertHTML',
      false,
      `<a class="doc-issue" data-key="${key}" href="${href}">${key}</a>&nbsp;`
    );
    setPickerOpen(false);
    setPickerQuery('');
    schedule(currentTitle(), readBody());
  }

  async function linkifyEditor({ checkRemote = false } = {}) {
    const root = editorRef.current;
    if (!root) return false;

    let changed = linkifyDomSubtree(root, knownKeys);
    if (checkRemote) {
      const candidates = extractCandidateTicketKeys(root.textContent || '', { validPrefixes });
      const missing = candidates.filter((k) => !knownKeys.has(k));
      if (missing.length > 0) {
        const verified = await validateTicketKeys(missing, knownKeys);
        if (editorRef.current === root && verified.size > 0) {
          if (linkifyDomSubtree(root, verified)) {
            changed = true;
          }
        }
      }
    }
    return changed;
  }

  function linkifyAtCaretDelimiter() {
    const root = editorRef.current;
    const selection = window.getSelection();
    if (!root || !selection?.rangeCount || !selection.isCollapsed) return;
    const node = selection.anchorNode;
    if (!node || node.nodeType !== 3 || !root.contains(node)) return;
    if (isInsideSkippedDocTag(node, root)) return;

    const beforeCaret = (node.nodeValue || '').slice(0, selection.anchorOffset);
    const candidates = extractCandidateTicketKeys(beforeCaret, { validPrefixes });
    if (candidates.length === 0) return;

    const immediateLocal = new Set(candidates.filter((k) => knownKeys.has(k)));
    if (immediateLocal.size > 0) {
      if (replaceTicketsInTextNode(node, immediateLocal, root)) {
        schedule(currentTitle(), readBody());
      }
    }

    const missing = candidates.filter((k) => !knownKeys.has(k));
    if (missing.length > 0) {
      const snapshotText = node.nodeValue;
      validateTicketKeys(missing, knownKeys).then((verified) => {
        if (!editorRef.current || !node.isConnected || node.nodeValue !== snapshotText) return;
        if (replaceTicketsInTextNode(node, verified, editorRef.current)) {
          schedule(currentTitle(), readBody());
        }
      });
    }
  }

  function applyLink(event) {
    event.preventDefault();
    const raw = linkUrl.trim();
    if (!raw) return;
    const url = /^(https?:\/\/|mailto:|\/)/i.test(raw) ? raw : `https://${raw}`;
    if (/^(javascript|data):/i.test(url)) return;
    exec('createLink', url);
    setLinkOpen(false);
    setLinkUrl('');
  }

  const matches = useMemo(() => {
    const needle = pickerQuery.trim().toLowerCase();
    return tickets
      .filter((ticket) => {
        if (!needle) return true;
        return ticketKey(ticket).toLowerCase().includes(needle) || (ticket.title || '').toLowerCase().includes(needle);
      })
      .slice(0, 8);
  }, [tickets, pickerQuery]);

  const who = Number(savedMeta.updated_by) === Number(currentUser.id) ? 'you' : (savedMeta.updated_by_name || 'someone');

  return (
    <div className="docs-main">
      <div className="docs-toolbar" role="toolbar" aria-label="Doc formatting">
        <button type="button" title="Bold" aria-label="Bold" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('bold')}>B</button>
        <button type="button" title="Italic" aria-label="Italic" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('italic')}><em>I</em></button>
        <button type="button" title="Underline" aria-label="Underline" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('underline')}><span className="docs-tool-u">U</span></button>
        <button type="button" title="Strikethrough" aria-label="Strikethrough" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('strikeThrough')}><span className="docs-tool-s">S</span></button>
        <span className="docs-tool-gap" />
        <button type="button" title="Heading" aria-label="Heading" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('formatBlock', 'H2')}>H</button>
        <button type="button" title="Bullet list" aria-label="Bullet list" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('insertUnorderedList')}>•</button>
        <button type="button" title="Numbered list" aria-label="Numbered list" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('insertOrderedList')}>1.</button>
        <button type="button" title="Quote" aria-label="Quote" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('formatBlock', 'BLOCKQUOTE')}>“</button>
        <button type="button" title="Code" aria-label="Code" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('formatBlock', 'PRE')}>{'</>'}</button>
        <span className="docs-tool-gap" />
        <button type="button" title="Link" aria-label="Link" onMouseDown={(e) => e.preventDefault()} onClick={() => { setLinkOpen((open) => !open); setPickerOpen(false); }}>Link</button>
        <button type="button" title="Work item" aria-label="Insert work item" onMouseDown={(e) => e.preventDefault()} onClick={() => { setPickerOpen((open) => !open); setLinkOpen(false); setPickerQuery(''); }}>Work item</button>
        <span className="docs-tool-status">{status}</span>
        <div className="docs-menu">
          <button type="button" className="docs-more" aria-expanded={menuOpen} aria-label="Doc actions" onClick={() => setMenuOpen((open) => !open)}>
            ···
          </button>
          {menuOpen && (
            <div className="docs-menu-pop" role="menu">
              <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onCreateChild(); }}>Add child page</button>
              <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onDuplicate(); }}>Duplicate</button>
              <button type="button" role="menuitem" disabled={!canMoveUp} onClick={() => { setMenuOpen(false); onMove('up'); }}>Move up</button>
              <button type="button" role="menuitem" disabled={!canMoveDown} onClick={() => { setMenuOpen(false); onMove('down'); }}>Move down</button>
              <button
                type="button"
                role="menuitem"
                onClick={async () => {
                  setMenuOpen(false);
                  try {
                    await navigator.clipboard.writeText(window.location.href);
                    setStatus('Link copied');
                  } catch {
                    setStatus('Could not copy the link');
                  }
                }}
              >
                Copy link
              </button>
              <button type="button" role="menuitem" className="is-danger" onClick={() => { setMenuOpen(false); onDelete(); }}>Delete</button>
            </div>
          )}
        </div>
      </div>

      {linkOpen && (
        <form className="docs-pop" onSubmit={applyLink}>
          <input
            type="url"
            value={linkUrl}
            onChange={(event) => setLinkUrl(event.target.value)}
            placeholder="https://"
            aria-label="Link address"
            autoFocus
          />
          <button type="submit" className="btn-primary">Add</button>
          <button type="button" className="btn-secondary" onClick={() => setLinkOpen(false)}>Cancel</button>
        </form>
      )}

      {pickerOpen && (
        <div className="docs-pop docs-picker">
          <input
            type="search"
            value={pickerQuery}
            onChange={(event) => setPickerQuery(event.target.value)}
            placeholder="Search work items"
            aria-label="Search work items"
            autoFocus
          />
          {matches.length === 0 ? (
            <p className="docs-picker-empty">No work items match.</p>
          ) : (
            <ul>
              {matches.map((ticket) => (
                <li key={ticket.id}>
                  <button type="button" onClick={() => insertIssue(ticket)}>
                    <TypeIcon type={ticket.type} size={14} />
                    <strong>{ticketKey(ticket)}</strong>
                    <span>{ticket.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="docs-sheet">
        <input
          ref={titleRef}
          className="docs-title"
          value={title}
          placeholder="Untitled"
          aria-label="Doc title"
          onChange={(event) => {
            setTitle(event.target.value);
            schedule(event.target.value, readBody());
          }}
        />
        <p className="docs-meta">
          Updated {formatListDateTime(savedMeta.updated_at)} by {who}
        </p>
        <div
          ref={editorRef}
          className="docs-body"
          contentEditable
          spellCheck="true"
          role="textbox"
          aria-multiline="true"
          aria-label="Doc content"
          data-placeholder="Type / to add a heading, list, quote, or work item"
          suppressContentEditableWarning
          dangerouslySetInnerHTML={{ __html: initialBodyHtml }}
          onInput={(event) => {
            detectSlash();
            const data = event.nativeEvent?.data;
            const inputType = event.nativeEvent?.inputType;
            if (data === ' ' || data === '\u00a0') {
              linkifyAtCaretDelimiter();
            } else if (inputType === 'insertParagraph' || inputType === 'insertLineBreak') {
              linkifyEditor({ checkRemote: true }).then((changed) => {
                if (changed) schedule(currentTitle(), readBody());
              });
            }
            schedule(currentTitle(), readBody());
          }}
          onPaste={() => {
            requestAnimationFrame(async () => {
              const changed = await linkifyEditor({ checkRemote: true });
              if (changed) schedule(currentTitle(), readBody());
            });
          }}
          onBlur={async () => {
            const unwrapped = unwrapBrokenDocIssues(editorRef.current);
            const changed = await linkifyEditor({ checkRemote: true });
            if (unwrapped || changed) {
              schedule(currentTitle(), readBody());
            }
          }}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
              event.preventDefault();
              if (timer.current) clearTimeout(timer.current);
              pending.current = null;
              save(currentTitle(), readBody());
              return;
            }
            if (!slash) return;
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setSlashIndex((index) => (index + 1) % SLASH.length);
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setSlashIndex((index) => (index - 1 + SLASH.length) % SLASH.length);
            } else if (event.key === 'Enter') {
              event.preventDefault();
              runSlash(SLASH[slashIndex]);
            } else if (event.key === 'Escape') {
              setSlash(null);
            }
          }}
          onMouseDown={(event) => {
            const link = event.target.closest?.('a.doc-issue');
            if (!link) return;
            const key = link.dataset.key;
            if (!key) return;
            if (event.button === 0 && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              window.open(link.getAttribute('href') || ticketHref(key), '_blank', 'noopener,noreferrer');
              return;
            }
            if (event.button === 0 && !event.shiftKey && !event.altKey) {
              event.preventDefault();
              onOpenTicket(key);
            }
          }}
          onAuxClick={(event) => {
            if (event.button !== 1) return;
            const link = event.target.closest?.('a.doc-issue');
            if (!link) return;
            const key = link.dataset.key;
            if (!key) return;
            event.preventDefault();
            window.open(link.getAttribute('href') || ticketHref(key), '_blank', 'noopener,noreferrer');
          }}
        />
      </div>

      {slash && (
        <div className="docs-slash" style={{ top: slash.top, left: slash.left }} role="listbox" aria-label="Insert">
          {SLASH.map((item, index) => (
            <button
              key={item.id}
              type="button"
              role="option"
              aria-selected={index === slashIndex}
              className={index === slashIndex ? 'is-active' : ''}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => runSlash(item)}
            >
              <strong>{item.label}</strong>
              <span>{item.hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function DocsView({
  docs: initialDocs,
  activeDoc,
  tickets,
  allTickets = null,
  project,
  projects,
  employees,
  projectCounts,
  myIssuesCount,
  currentUser,
  clientRequests = false,
}) {
  const router = useRouter();
  const docsApiBase = clientRequests
    ? '/api/client-requests/docs'
    : `/api/projects/${project.id}/docs`;
  const docsHref = (docId) =>
    clientRequests
      ? docId
        ? `/client-requests/docs/${docId}`
        : '/client-requests/docs'
      : docId
        ? `/projects/${project.id}/docs/${docId}`
        : `/projects/${project.id}/docs`;
  const lookupTickets = useMemo(
    () => (Array.isArray(allTickets) && allTickets.length > 0 ? allTickets : tickets),
    [allTickets, tickets]
  );
  const validPrefixes = useMemo(() => buildValidPrefixSet(projects), [projects]);
  const knownKeys = useMemo(() => buildExistingKeySet(lookupTickets), [lookupTickets]);
  const modal = useTicketModal({ visible: tickets, lookup: lookupTickets });
  const { toasts, push, dismiss, pause, resume } = useToasts();
  const [docs, setDocs] = useState(initialDocs);
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState({});
  const [pendingDelete, setPendingDelete] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setDocs(initialDocs);
  }, [initialDocs]);

  const rows = useMemo(
    () => buildRows(docs, query, collapsed),
    [docs, query, collapsed]
  );

  const siblings = useMemo(() => {
    if (!activeDoc) return [];
    return docs
      .filter((doc) => Number(doc.parent_id) === Number(activeDoc.parent_id) || (doc.parent_id == null && activeDoc.parent_id == null))
      .sort((a, b) => a.position - b.position || a.id - b.id);
  }, [docs, activeDoc]);
  const siblingIndex = siblings.findIndex((doc) => Number(doc.id) === Number(activeDoc?.id));

  async function createPage(parentId) {
    setError('');
    const res = await fetch(docsApiBase, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parent_id: parentId || null }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error || 'Could not create the doc.');
      return;
    }
    router.push(docsHref(data.doc.id));
    router.refresh();
  }

  async function duplicatePage() {
    if (!activeDoc) return;
    setError('');
    const res = await fetch(docsApiBase, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ duplicate_of: activeDoc.id }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error || 'Could not duplicate the doc.');
      return;
    }
    push({ message: 'Doc duplicated.' });
    router.push(docsHref(data.doc.id));
    router.refresh();
  }

  async function movePage(direction) {
    if (!activeDoc) return;
    setError('');
    const res = await fetch(`${docsApiBase}/${activeDoc.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ move: direction }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error || 'Could not move the doc.');
      return;
    }
    router.refresh();
  }

  async function confirmDelete() {
    const target = pendingDelete;
    if (!target) return;
    try {
      const res = await fetch(`${docsApiBase}/${target.id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not delete the doc.');
      setPendingDelete(null);
      push({ message: `${docLabel(target)} deleted.` });
      if (Number(activeDoc?.id) === Number(target.id)) {
        router.push(docsHref(data.parent_id || null));
      }
      router.refresh();
    } catch (err) {
      setPendingDelete(null);
      setError(err.message);
    }
  }

  function openTicket(key) {
    modal.open(key);
  }

  return (
    <AppShell
      currentUser={currentUser}
      projects={projects}
      projectCounts={projectCounts}
      myIssuesCount={myIssuesCount}
      view={clientRequests ? 'client-requests' : 'summary'}
      filter="all"
      onFilterChange={() => {}}
      projectId={String(project.id)}
      onProjectChange={(id) =>
        router.push(clientRequests ? '/client-requests/docs' : `/projects/${id}/docs`)
      }
    >
      <div className="board">
        {error && (
          <div className="error-banner">
            <strong>Error:</strong> {error}
            <button type="button" onClick={() => setError('')}>Dismiss</button>
          </div>
        )}
        <TicketModalStatus modal={modal} />

        <PageHeader
          breadcrumb={
            clientRequests
              ? [{ label: 'Client requests', href: '/client-requests' }, { label: 'Docs' }]
              : [
                  { label: 'Workspaces', href: '/projects' },
                  { label: project.name, href: `/projects/${project.id}/summary` },
                  { label: 'Docs' },
                ]
          }
          project={project}
          title="Docs"
          subtitle={
            clientRequests
              ? 'Pages for decisions, specs, and notes about client requests.'
              : 'Pages for decisions, specs, and notes in this project.'
          }
          actions={(
            <button type="button" className="btn-primary" onClick={() => createPage(null)}>
              <PlusIcon />
              Create
            </button>
          )}
        />
        <ProjectTabs projectId={project.id} active="docs" clientRequests={clientRequests} />

        {docs.length === 0 ? (
          <EmptyState
            icon={<PageIcon size={40} />}
            title="No docs yet"
            text="Create a page for a spec, a decision, or notes that belong with this project's work."
          >
            <button type="button" className="btn-primary" onClick={() => createPage(null)}>
              Create a doc
            </button>
          </EmptyState>
        ) : (
          <div className="docs-layout">
            <aside className="docs-tree" aria-label="Docs">
              <div className="docs-tree-head">
                <div className="search-field docs-search">
                  <input
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search docs"
                    aria-label="Search docs"
                  />
                </div>
                <button type="button" className="docs-tree-add" onClick={() => createPage(null)} aria-label="Create doc" title="Create doc">
                  <PlusIcon />
                </button>
              </div>
              {rows.length === 0 ? (
                <p className="docs-tree-empty">No docs match this search.</p>
              ) : (
                <ul>
                  {rows.map(({ doc, depth, hasChildren }) => {
                    const open = !collapsed[doc.id];
                    const active = Number(doc.id) === Number(activeDoc?.id);
                    return (
                      <li key={doc.id}>
                        <div className={`docs-tree-row${active ? ' is-active' : ''}`} style={{ paddingLeft: 8 + depth * 16 }}>
                          {hasChildren ? (
                            <button
                              type="button"
                              className="docs-twist"
                              aria-label={open ? 'Collapse' : 'Expand'}
                              onClick={() => setCollapsed((current) => ({ ...current, [doc.id]: open }))}
                            >
                              <ChevronIcon open={open} />
                            </button>
                          ) : (
                            <span className="docs-twist-spacer" />
                          )}
                          <Link href={docsHref(doc.id)}>
                            <PageIcon />
                            <span>{docLabel(doc)}</span>
                          </Link>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </aside>

            {activeDoc ? (
              <DocEditor
                key={activeDoc.id}
                doc={activeDoc}
                project={project}
                tickets={tickets}
                validPrefixes={validPrefixes}
                knownKeys={knownKeys}
                currentUser={currentUser}
                canMoveUp={siblingIndex > 0}
                canMoveDown={siblingIndex >= 0 && siblingIndex < siblings.length - 1}
                onSaved={(saved) => {
                  setDocs((list) => list.map((item) => (Number(item.id) === Number(saved.id) ? { ...item, ...saved } : item)));
                }}
                onCreateChild={() => createPage(activeDoc.id)}
                onDuplicate={duplicatePage}
                onMove={movePage}
                onDelete={() => setPendingDelete(activeDoc)}
                onOpenTicket={openTicket}
                clientRequests={clientRequests}
              />
            ) : (
              <div className="docs-main docs-main-empty">
                <p>Select a doc from the list.</p>
              </div>
            )}
          </div>
        )}
      </div>

      {modal.selected && (
        <TicketDetailModal
          ticket={modal.selected}
          employees={employees}
          currentUser={currentUser}
          siblingTickets={lookupTickets}
          projects={projects}
          canStep={modal.canStep}
          onClose={modal.close}
          onNext={modal.next}
          onPrev={modal.prev}
          onOpenTicket={modal.open}
        />
      )}

      {pendingDelete && (
        <ConfirmModal
          title="Delete doc"
          message={
            docs.some((doc) => Number(doc.parent_id) === Number(pendingDelete.id))
              ? `Delete ${docLabel(pendingDelete)}? Its child pages will move up a level.`
              : `Delete ${docLabel(pendingDelete)}? This cannot be undone.`
          }
          confirmLabel="Delete"
          onCancel={() => setPendingDelete(null)}
          onConfirm={confirmDelete}
        />
      )}

      <Toaster toasts={toasts} onDismiss={dismiss} onPause={pause} onResume={resume} />
    </AppShell>
  );
}

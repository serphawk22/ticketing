'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  isMisspelled,
  loadSpellchecker,
  topSuggestions,
} from './spellcheckEngine';

const EDITABLE_SELECTOR = [
  'textarea',
  'input:not([type])',
  'input[type="text"]',
  'input[type="search"]',
  '[contenteditable="true"]',
  '[contenteditable=""]',
  '[contenteditable="plaintext-only"]',
].join(',');

const WORD_PATTERN = /[A-Za-z]+(?:['’-][A-Za-z]+)*/g;
const POPUP_WIDTH = 200;
const POPUP_HEIGHT = 124;

const COPIED_STYLES = [
  'direction',
  'fontFamily',
  'fontSize',
  'fontStretch',
  'fontStyle',
  'fontVariant',
  'fontWeight',
  'letterSpacing',
  'lineHeight',
  'textAlign',
  'textIndent',
  'textRendering',
  'textTransform',
  'wordSpacing',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'borderTopStyle',
  'borderRightStyle',
  'borderBottomStyle',
  'borderLeftStyle',
  'boxSizing',
];

function isEditable(element) {
  if (!(element instanceof HTMLElement) || !element.matches(EDITABLE_SELECTOR)) return false;
  if (element.matches(':disabled')) return false;
  if ('readOnly' in element && element.readOnly) return false;
  return true;
}

function isCheckableWord(word) {
  return Boolean(word);
}

function caretRangeFromPoint(x, y) {
  if (document.caretRangeFromPoint) {
    return document.caretRangeFromPoint(x, y);
  }

  if (document.caretPositionFromPoint) {
    const position = document.caretPositionFromPoint(x, y);
    if (!position) return null;
    const range = document.createRange();
    range.setStart(position.offsetNode, position.offset);
    range.collapse(true);
    return range;
  }

  return null;
}

function textOffsetWithin(root, node, offset) {
  try {
    const range = document.createRange();
    range.selectNodeContents(root);
    range.setEnd(node, offset);
    return range.toString().length;
  } catch {
    return null;
  }
}

function wordAtOffset(text, offset) {
  if (!text) return null;

  const target = Math.min(Math.max(offset, 0), text.length);
  WORD_PATTERN.lastIndex = 0;

  let match = WORD_PATTERN.exec(text);
  while (match) {
    const start = match.index;
    const end = start + match[0].length;
    if (target >= start && target <= end) {
      return { word: match[0], start, end };
    }
    if (start > target) break;
    match = WORD_PATTERN.exec(text);
  }

  return null;
}

function pointInRect(rect, clientX, clientY, padding = 2) {
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    clientX >= rect.left - padding &&
    clientX <= rect.right + padding &&
    clientY >= rect.top - padding &&
    clientY <= rect.bottom + padding
  );
}

function inputHitAtPoint(field, clientX, clientY) {
  const rect = field.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;

  const style = window.getComputedStyle(field);
  const mirror = document.createElement('div');

  for (const property of COPIED_STYLES) {
    mirror.style[property] = style[property];
  }

  const borderX =
    (Number.parseFloat(style.borderLeftWidth) || 0) +
    (Number.parseFloat(style.borderRightWidth) || 0);
  const scrollbarX = Math.max(0, field.offsetWidth - field.clientWidth - borderX);

  mirror.style.position = 'fixed';
  mirror.style.left = `${rect.left}px`;
  mirror.style.top = `${rect.top}px`;
  mirror.style.width = `${Math.max(0, rect.width - scrollbarX)}px`;
  mirror.style.height = `${rect.height}px`;
  mirror.style.margin = '0';
  mirror.style.borderColor = 'transparent';
  mirror.style.background = 'transparent';
  mirror.style.color = 'transparent';
  mirror.style.caretColor = 'transparent';
  mirror.style.overflow = 'hidden';
  mirror.style.whiteSpace =
    field instanceof HTMLTextAreaElement ? style.whiteSpace : 'pre';
  mirror.style.overflowWrap = style.overflowWrap;
  mirror.style.wordBreak = style.wordBreak;
  mirror.style.opacity = '0';
  mirror.style.pointerEvents = 'auto';
  mirror.style.zIndex = '2147482000';
  mirror.textContent = field.value;

  document.body.appendChild(mirror);

  try {
    mirror.scrollTop = field.scrollTop;
    mirror.scrollLeft = field.scrollLeft;

    const range = caretRangeFromPoint(clientX, clientY);
    if (!range) return null;
    if (range.startContainer !== mirror && !mirror.contains(range.startContainer)) {
      return null;
    }

    const offset = textOffsetWithin(mirror, range.startContainer, range.startOffset);
    if (offset == null) return null;

    const found = wordAtOffset(field.value, offset);
    if (!found || !mirror.firstChild) return null;

    const wordRange = document.createRange();
    wordRange.setStart(mirror.firstChild, found.start);
    wordRange.setEnd(mirror.firstChild, found.end);

    return { ...found, rect: wordRange.getBoundingClientRect() };
  } finally {
    mirror.remove();
  }
}

function hitTestWord(field, clientX, clientY) {
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
    const hit = inputHitAtPoint(field, clientX, clientY);
    if (!hit || !pointInRect(hit.rect, clientX, clientY)) return null;
    return { ...hit, field };
  }

  let range = caretRangeFromPoint(clientX, clientY);
  if (!range) {
    const selection = window.getSelection();
    range = selection?.rangeCount ? selection.getRangeAt(0) : null;
  }
  if (
    !range ||
    !field.contains(range.startContainer) ||
    range.startContainer.nodeType !== Node.TEXT_NODE
  ) {
    return null;
  }

  const found = wordAtOffset(range.startContainer.textContent || '', range.startOffset);
  if (!found) return null;

  const wordRange = document.createRange();
  wordRange.setStart(range.startContainer, found.start);
  wordRange.setEnd(range.startContainer, found.end);

  const rect = wordRange.getBoundingClientRect();
  if (!pointInRect(rect, clientX, clientY, 3)) return null;

  return {
    ...found,
    field,
    range: wordRange,
    rect,
  };
}

function replaceInputWord(field, start, end, replacement) {
  const value = field.value;
  const next = `${value.slice(0, start)}${replacement}${value.slice(end)}`;
  const prototype =
    field instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;

  field.focus({ preventScroll: true });
  if (setter) {
    setter.call(field, next);
  } else {
    field.value = next;
  }

  const caret = start + replacement.length;
  try {
    field.setSelectionRange(caret, caret);
  } catch {}

  const event =
    typeof InputEvent === 'function'
      ? new InputEvent('input', {
          bubbles: true,
          inputType: 'insertReplacementText',
          data: replacement,
        })
      : new Event('input', { bubbles: true });

  field.dispatchEvent(event);
}

function replaceContentEditableWord(field, range, replacement) {
  if (!range || !range.startContainer?.isConnected) return;

  field.focus({ preventScroll: true });
  const selection = window.getSelection();
  if (!selection) return;

  selection.removeAllRanges();
  selection.addRange(range);
  range.deleteContents();

  const text = document.createTextNode(replacement);
  range.insertNode(text);

  const after = document.createRange();
  after.setStartAfter(text);
  after.collapse(true);
  selection.removeAllRanges();
  selection.addRange(after);

  const event =
    typeof InputEvent === 'function'
      ? new InputEvent('input', {
          bubbles: true,
          inputType: 'insertReplacementText',
          data: replacement,
        })
      : new Event('input', { bubbles: true });

  field.dispatchEvent(event);
}

function popupPosition(x, y) {
  const left = Math.max(
    8,
    Math.min(x, window.innerWidth - POPUP_WIDTH - 8)
  );
  let top = y + 14;
  if (top + POPUP_HEIGHT > window.innerHeight - 8) {
    top = y - POPUP_HEIGHT - 14;
  }
  return { left, top: Math.max(8, top) };
}

export default function SpellcheckProvider() {
  const [popup, setPopup] = useState(null);
  const popupRef = useRef(null);

  useEffect(() => {
    if (!popup) return undefined;

    function close(event) {
      if (popupRef.current?.contains(event.target)) return;
      setPopup(null);
    }

    function closeOnEscape(event) {
      if (event.key === 'Escape') setPopup(null);
    }

    function closeOnMove() {
      setPopup(null);
    }

    document.addEventListener('mousedown', close, true);
    document.addEventListener('contextmenu', close, true);
    document.addEventListener('keydown', closeOnEscape, true);
    window.addEventListener('scroll', closeOnMove, true);
    window.addEventListener('resize', closeOnMove);

    return () => {
      document.removeEventListener('mousedown', close, true);
      document.removeEventListener('contextmenu', close, true);
      document.removeEventListener('keydown', closeOnEscape, true);
      window.removeEventListener('scroll', closeOnMove, true);
      window.removeEventListener('resize', closeOnMove);
    };
  }, [popup]);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const watched = new WeakSet();
    let spellchecker = null;
    let disposed = false;

    loadSpellchecker()
      .then((instance) => {
        if (!disposed) spellchecker = instance;
      })
      .catch(() => {});

    function handleClick(event) {
      if (event.button !== 0) return;

      const field = event.currentTarget;
      if (!isEditable(field)) return;
      if (field.getAttribute('spellcheck') === 'false') return;

      if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
        if (field.selectionStart !== field.selectionEnd) return;
      } else {
        const selection = window.getSelection();
        if (selection && !selection.isCollapsed) return;
      }

      const hit = hitTestWord(field, event.clientX, event.clientY);
      if (!hit || !isCheckableWord(hit.word)) return;

      const anchorX = hit.rect?.width ? hit.rect.left : event.clientX;
      const anchorY = hit.rect?.height ? hit.rect.bottom : event.clientY;

      void (async () => {
        try {
          const instance = spellchecker || (await loadSpellchecker());
          spellchecker = instance;

          if (disposed || !field.isConnected) return;

          if (!isMisspelled(instance, hit.word)) {
            setPopup(null);
            return;
          }

          const suggestions = topSuggestions(instance, hit.word, 3);
          if (suggestions.length === 0) {
            setPopup(null);
            return;
          }

          setPopup({
            suggestions,
            field,
            start: hit.start,
            end: hit.end,
            range: hit.range || null,
            ...popupPosition(anchorX, anchorY),
          });
        } catch {
          setPopup(null);
        }
      })();
    }

    function enable(element) {
      if (!isEditable(element)) return;
      if (element.getAttribute('spellcheck') === 'false') return;

      if (element.getAttribute('spellcheck') !== 'true') {
        element.setAttribute('spellcheck', 'true');
      }
      if (!element.hasAttribute('lang')) {
        element.setAttribute('lang', 'en');
      }
      if (!watched.has(element)) {
        watched.add(element);
        element.addEventListener('click', handleClick, { signal });
      }
    }

    function scan(root) {
      if (!(root instanceof Element)) return;
      if (isEditable(root)) enable(root);
      root.querySelectorAll(EDITABLE_SELECTOR).forEach(enable);
    }

    scan(document.documentElement);

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach((node) => {
            if (node instanceof Element) scan(node);
          });
          continue;
        }

        if (mutation.attributeName === 'spellcheck') {
          if (mutation.target.getAttribute('spellcheck') === 'false') continue;
        }
        enable(mutation.target);
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['spellcheck', 'contenteditable'],
    });

    return () => {
      disposed = true;
      observer.disconnect();
      controller.abort();
    };
  }, []);

  function applySuggestion(suggestion) {
    if (!popup) return;

    if (!popup.field?.isConnected) {
      setPopup(null);
      return;
    }

    if (popup.range) {
      replaceContentEditableWord(popup.field, popup.range, suggestion);
    } else {
      replaceInputWord(popup.field, popup.start, popup.end, suggestion);
    }

    setPopup(null);
  }

  if (!popup || typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={popupRef}
      className="spellcheck-suggestions"
      role="menu"
      aria-label="Spelling suggestions"
      style={{ left: popup.left, top: popup.top }}
      onMouseDown={(event) => event.preventDefault()}
    >
      {popup.suggestions.map((suggestion) => (
        <button
          key={suggestion}
          type="button"
          role="menuitem"
          className="spellcheck-suggestion"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => applySuggestion(suggestion)}
        >
          {suggestion}
        </button>
      ))}
    </div>,
    document.body
  );
}

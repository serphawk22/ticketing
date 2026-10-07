'use client';

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from './ticket/icons';

/**
 * The one inline, click-to-edit dropdown in the app.
 *
 * A cell that turns into a combobox in place, filters as you type, and commits
 * on click or Enter. No dialog, no navigation. Assignee, Reporter, Priority,
 * Status and Category are all this component with different options and
 * different leading art, because five hand-rolled versions of the same
 * positioning, keyboard and cancel logic drift apart within a week.
 *
 * The shell owns everything that is not field specific:
 *
 *   - the trigger/input swap, and focusing the input with its value selected so
 *     typing replaces the value instead of appending to it
 *   - anchoring the panel under the cell through a portal, so it is never clipped
 *     by the table's own overflow, and flipping above when there is no room
 *   - the scroll chevrons, which track real scroll state
 *   - ArrowUp/ArrowDown/Enter/Escape/Tab and click-outside-to-cancel
 *   - the listbox wiring, so the input announces the active option
 *
 * Callers supply only what makes their field different:
 *
 *   value           the selected option's value, '' or null when unset
 *   options         [{ value, label, keywords?, leading?, trailing? }] where
 *                   leading/trailing are already-rendered nodes
 *   onSelect        (value) => void — the caller's update mutation
 *   searchable      false for a short fixed list, which keeps the caret in the
 *                   box anyway so Enter and Escape behave identically
 *   allowCustom     true when the field has to hold values that are not in
 *                   options (Category, Resolution). The list stays a set of
 *                   suggestions: typing and pressing Enter saves exactly what
 *                   was typed, matching an option's label when one is hit or
 *                   saving the raw text otherwise, instead of forcing a choice.
 *   readOnly        shows the value with no edit affordance
 *   variant         'cell' for a table cell, 'button' for the modal's larger
 *                   status button
 */
export default function InlineDropdownField({
  value = '',
  options = [],
  onSelect,
  searchable = true,
  allowCustom = false,
  readOnly = false,
  label = 'Value',
  emptyText = 'No matching options',
  className = '',
  variant = 'cell',
  renderValue,
  renderOption,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const [scroll, setScroll] = useState({ top: false, bottom: false });

  const triggerRef = useRef(null);
  const inputRef = useRef(null);
  const panelRef = useRef(null);
  const listRef = useRef(null);
  const listId = useId();

  const current = useMemo(
    () => options.find((o) => o.value === value) || null,
    [options, value]
  );

  // A value with no matching option is still a real value: a ticket raised by a
  // client keeps that client as its reporter even though the roster is the team
  // directory. Falling back to the empty-state text would claim it is unset.
  const currentLabel =
    current ? current.label : value === '' || value == null ? emptyText : String(value);

  // Filtering is by label plus whatever extra words the caller attached, so a
  // person can be found by email or a status by any word of its name.
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => {
      const hay = `${o.label} ${(o.keywords || []).join(' ')}`.toLowerCase();
      return hay.includes(q);
    });
  }, [options, query]);

  // The panel is anchored to the input's own box, the same width as the input,
  // and flips above it when the viewport has no room below.
  const place = useCallback(() => {
    const anchor = inputRef.current || triggerRef.current;
    const panel = panelRef.current;
    if (!anchor || !panel) return;
    const r = anchor.getBoundingClientRect();
    const p = panel.getBoundingClientRect();
    const gap = 2;
    const margin = 8;

    const left = Math.max(margin, Math.min(r.left, window.innerWidth - p.width - margin));

    let top = r.bottom + gap;
    if (top + p.height > window.innerHeight - margin) {
      top = r.top - p.height - gap;
    }
    top = Math.max(margin, Math.min(top, window.innerHeight - p.height - margin));

    setPos((prev) =>
      prev.top === top && prev.left === left && prev.width === r.width
        ? prev
        : { top, left, width: r.width }
    );
  }, []);

  // The list is capped in height, so the chevrons track real scroll state
  // rather than being always-on decoration.
  const syncScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    setScroll({ top: el.scrollTop > 1, bottom: max - el.scrollTop > 1 });
  }, []);

  useLayoutEffect(() => {
    if (!open) return undefined;
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, place]);

  useLayoutEffect(() => {
    if (!open) return undefined;
    syncScroll();
    const el = listRef.current;
    el?.addEventListener('scroll', syncScroll, { passive: true });
    return () => el?.removeEventListener('scroll', syncScroll);
  }, [open, syncScroll]);

  // Opening puts the caret in a box that already holds the current value, with
  // that value selected, so typing replaces it instead of appending to it.
  useEffect(() => {
    if (!open) return;
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [open]);

  function close({ focusTrigger = false } = {}) {
    setOpen(false);
    setQuery('');
    setActive(0);
    if (focusTrigger) triggerRef.current?.focus();
  }

  // A click anywhere else abandons the edit, which is the same as never having
  // opened it: the cell goes back to the value it already had.
  useEffect(() => {
    if (!open) return undefined;
    function onDown(e) {
      if (panelRef.current?.contains(e.target)) return;
      if (triggerRef.current?.contains(e.target)) return;
      if (inputRef.current?.contains(e.target)) return;
      close();
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  function commit(option) {
    if (!option) return;
    if (option.value !== value) onSelect?.(option.value);
    close({ focusTrigger: true });
  }

  // For a field that accepts custom text, Enter commits what is in the box
  // rather than forcing a suggestion back on the user. An exact match against
  // an option's label commits that option (so typing "None" clears and "Bug"
  // picks the category); anything else is saved verbatim. An unchanged box --
  // the value was opened and Enter pressed without typing -- just closes, and
  // arrow/hover navigation onto a concrete option still commits that option.
  function commitDraft() {
    const draft = (query === '' ? currentLabel : query).trim();
    const currentValue = String(value ?? '').trim();
    if (active > 0) {
      commit(visible[active]);
      return;
    }
    const option = options.find((o) => String(o.label).trim() === draft);
    const next = option ? option.value : draft;
    if (next === currentValue) {
      close({ focusTrigger: true });
      return;
    }
    onSelect?.(next);
    close({ focusTrigger: true });
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => {
        const next = e.key === 'ArrowDown' ? a + 1 : a - 1;
        return Math.max(0, Math.min(next, visible.length - 1));
      });
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (allowCustom) commitDraft();
      else commit(visible[active]);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.key === 'Tab') close();
  }

  const shellClass = `idf-trigger${variant === 'button' ? ' idf-trigger-button' : ''}${
    className ? ` ${className}` : ''
  }`;

  if (!open) {
    return (
      <button
        ref={triggerRef}
        type="button"
        className={shellClass}
        onClick={() => {
          if (readOnly) return;
          setOpen(true);
        }}
        aria-disabled={readOnly || undefined}
        aria-haspopup={readOnly ? undefined : 'listbox'}
        aria-expanded={readOnly ? undefined : false}
        aria-label={`${label}, ${currentLabel}`}
        title={readOnly ? currentLabel : `Change ${label.toLowerCase()}`}
      >
        {renderValue ? renderValue(current) : <span className="idf-label">{currentLabel}</span>}
        {/* Keeps the menu affordance the replaced status button had. */}
        {variant === 'button' && <ChevronDown size={12} className="idf-caret" aria-hidden="true" />}
      </button>
    );
  }

  return (
    <>
      <span className="idf-edit">
        {current?.leading ? (
          <span className="idf-edit-leading" aria-hidden="true">
            {current.leading}
          </span>
        ) : null}
        <input
          ref={inputRef}
          className="idf-input"
          defaultValue={currentLabel}
          onChange={(e) => {
            if (!searchable) return;
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={`${listId}-${active}`}
          aria-label={`${label}, ${searchable ? 'search' : 'choose'}`}
          autoComplete="off"
          spellCheck="false"
        />
      </span>

      {createPortal(
        <div
          ref={panelRef}
          className="idf-panel"
          style={{ top: pos.top, left: pos.left, minWidth: Math.max(pos.width, 180) }}
        >
          {scroll.top && (
            <span className="idf-chev idf-chev-top" aria-hidden="true" />
          )}
          <div className="idf-scroll" ref={listRef} id={listId} role="listbox">
            {visible.length === 0 &&
              (allowCustom ? (
                <p className="idf-empty">{emptyText} · press Enter to add</p>
              ) : (
                <p className="idf-empty">{emptyText}</p>
              ))}
            {visible.map((option, i) => {
              const isCurrent = option.value === value;
              return (
                <button
                  key={option.value === '' ? '__empty' : option.value}
                  id={`${listId}-${i}`}
                  type="button"
                  role="option"
                  aria-selected={isCurrent}
                  className={`idf-option${i === active ? ' is-active' : ''}${
                    isCurrent ? ' is-current' : ''
                  }`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => commit(option)}
                >
                  {option.leading ? (
                    <span className="idf-option-leading" aria-hidden="true">
                      {option.leading}
                    </span>
                  ) : null}
                  <span className="idf-option-label">{option.label}</span>
                  {option.trailing ? (
                    <span className="idf-option-trailing" aria-hidden="true">
                      {option.trailing}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
          {scroll.bottom && (
            <span className="idf-chev idf-chev-bottom" aria-hidden="true" />
          )}
        </div>,
        document.body
      )}
    </>
  );
}
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
import Avatar from './Avatar';

const UNASSIGNED = { id: null, name: 'Unassigned' };

/**
 * Inline, click-to-edit person field, in the shape Jira uses: a cell that turns
 * into a combobox in place, filters as you type, and commits on click or Enter.
 * No dialog, no navigation.
 *
 * Every person field in the app renders this one component, so the trigger, the
 * dropdown and the keyboard handling cannot drift apart between the list cells
 * and the detail sidebar.
 *
 *   value            selected user id, or null when unassigned
 *   users            assignable people, already filtered by the caller
 *   onSelect         (id | null) => void — the caller's update mutation
 *   allowUnassigned  false for a field that always has a person on it
 *   readOnly         shows the value without the edit affordance, for a field
 *                    this app has no write path for
 */
export default function UserPicker({
  value = null,
  users = [],
  onSelect,
  allowUnassigned = true,
  readOnly = false,
  label = 'Assignee',
  className = '',
  size = 24,
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
    () => users.find((u) => u.id === Number(value)) || null,
    [users, value]
  );
  const currentName = current ? current.name : UNASSIGNED.name;

  // "Unassigned" stays at the top while it still matches what was typed, which
  // is what Jira does: an empty box shows it, typing narrows the list away.
  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = (name) => name.toLowerCase().includes(q);
    const list = [];
    if (allowUnassigned && (!q || matches(UNASSIGNED.name))) list.push(UNASSIGNED);
    for (const u of users) {
      if (matches(u.name)) list.push(u);
    }
    return list;
  }, [allowUnassigned, query, users]);

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
    if (option.id !== (current?.id ?? null)) onSelect?.(option.id);
    close({ focusTrigger: true });
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => {
        const next = e.key === 'ArrowDown' ? a + 1 : a - 1;
        return Math.max(0, Math.min(next, options.length - 1));
      });
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      commit(options[active]);
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

  if (!open) {
    return (
      <button
        ref={triggerRef}
        type="button"
        className={`user-picker-trigger${className ? ` ${className}` : ''}`}
        onClick={() => {
          if (readOnly) return;
          setOpen(true);
        }}
        aria-disabled={readOnly || undefined}
        aria-haspopup={readOnly ? undefined : 'listbox'}
        aria-expanded={readOnly ? undefined : false}
        aria-label={`${label}, ${currentName}`}
        title={readOnly ? currentName : `Change ${label.toLowerCase()}`}
      >
        <Avatar
          name={current?.name}
          assigned={Boolean(current)}
          size={size}
          unassignedIcon
          showTitle={false}
        />
        <span className={`user-picker-name${current ? '' : ' is-empty'}`}>{currentName}</span>
      </button>
    );
  }

  return (
    <>
      <span className="user-picker-edit">
        <span className="user-picker-edit-avatar" aria-hidden="true">
          <Avatar
            name={current?.name}
            assigned={Boolean(current)}
            size={size}
            unassignedIcon
            showTitle={false}
          />
        </span>
        <input
          ref={inputRef}
          className="user-picker-input"
          defaultValue={currentName}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={`${listId}-${active}`}
          aria-label={`${label}, search people`}
          autoComplete="off"
          spellCheck="false"
        />
      </span>

      {createPortal(
        <div
          ref={panelRef}
          className="user-picker-panel"
          style={{ top: pos.top, left: pos.left, minWidth: Math.max(pos.width, 180) }}
        >
          {scroll.top && (
            <span className="user-picker-chev user-picker-chev-top" aria-hidden="true" />
          )}
          <div className="user-picker-scroll" ref={listRef} id={listId} role="listbox">
            {options.length === 0 && <p className="user-picker-empty">No matching people</p>}
            {options.map((option, i) => {
              const isCurrent = (option.id ?? null) === (current?.id ?? null);
              return (
                <button
                  key={option.id ?? 'unassigned'}
                  id={`${listId}-${i}`}
                  type="button"
                  role="option"
                  aria-selected={isCurrent}
                  className={`user-picker-option${i === active ? ' is-active' : ''}${
                    isCurrent ? ' is-current' : ''
                  }`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => commit(option)}
                >
                  <Avatar
                    name={option.id == null ? undefined : option.name}
                    assigned={option.id != null}
                    size={24}
                    unassignedIcon
                    showTitle={false}
                  />
                  <span className="user-picker-option-name">{option.name}</span>
                </button>
              );
            })}
          </div>
          {scroll.bottom && (
            <span className="user-picker-chev user-picker-chev-bottom" aria-hidden="true" />
          )}
        </div>,
        document.body
      )}
    </>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * The one inline, click-to-edit date in the app: the due date in a list row
 * and the due date in the ticket sidebar are both this component, so opening
 * the picker, pre-filling the date already on the ticket, committing on Enter
 * or Save and reverting on Escape behave identically in both places.
 *
 * The shell owns everything that is not field specific:
 *
 *   - the trigger/box swap, with the current date already in the box
 *   - handing the click to the browser's own picker
 *   - Enter to commit, Save to commit, Escape to cancel, blur to commit
 * Callers supply only what makes their field different:
 *
 *   value       'YYYY-MM-DD' or null/'' when unset
 *   onSave      (next) => void, next is 'YYYY-MM-DD' or null
 *   format      (value) => the string a set date reads as
 *   emptyText   what an unset date reads as
 *   readOnly    shows the value with no edit affordance
 *   variant     'cell' for a table row, 'sidebar' for the modal's field rows
 */
export default function InlineDateField({
  value = '',
  onSave,
  readOnly = false,
  label = 'Due date',
  emptyText = 'None',
  format = (v) => v,
  variant = 'cell',
  className = '',
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef(null);
  // Enter and blur can both land for one edit; the ref makes the first one
  // win so a single pick is never patched twice.
  const openRef = useRef(false);

  // The next edit starts from whatever the ticket holds now, so a date changed
  // from another view is the one the picker opens on, and a cancelled edit
  // always falls back to the saved value rather than a stale draft.
  useEffect(() => {
    if (!editing) setDraft(value || '');
  }, [value, editing]);

  useEffect(() => {
    if (!editing) return;
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    // Clicking the field opens the calendar rather than only the box, wherever
    // the browser allows it from a click. Where it does not, the box still has
    // the focus and opens its picker on the first click or Alt+Down.
    try {
      input.showPicker?.();
    } catch {
      /* not every engine offers showPicker, and none of them treat that as an error worth showing */
    }
  }, [editing]);

  function commit() {
    if (!openRef.current) return;
    openRef.current = false;
    setEditing(false);
    const next = draft || null;
    if (next !== (value || null)) onSave?.(next);
  }

  function cancel() {
    if (!openRef.current) return;
    openRef.current = false;
    setDraft(value || '');
    setEditing(false);
  }

  function onKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      // The detail modal closes on a window-level Escape, so the edit has to
      // swallow it: Escape here means "keep the date I already had".
      e.preventDefault();
      e.stopPropagation();
      cancel();
    }
  }

  if (editing) {
    return (
      <span className="idf-edit">
        <input
          ref={inputRef}
          type="date"
          className="idf-input idf-date-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={onKeyDown}
          aria-label={label}
        />
        {/* Saving on blur would drop the click that aims at this button, so the
            mousedown stays with the input and only the click commits. */}
        <button
          type="button"
          className="idf-date-save"
          onMouseDown={(e) => e.preventDefault()}
          onClick={commit}
        >
          Save
        </button>
      </span>
    );
  }

  const text = value ? format(value) : emptyText;
  const shellClass =
    variant === 'sidebar'
      ? `inline-value${value ? '' : ' is-empty'}${className ? ` ${className}` : ''}`
      : `idf-trigger idf-date-trigger${className ? ` ${className}` : ''}`;

  return (
    <button
      type="button"
      className={shellClass}
      onClick={() => {
        if (readOnly) return;
        setDraft(value || '');
        openRef.current = true;
        setEditing(true);
      }}
      disabled={readOnly}
      aria-label={`${label}, ${text}`}
      title={readOnly ? text : `Change ${label.toLowerCase()}`}
    >
      {text}
    </button>
  );
}

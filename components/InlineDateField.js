'use client';

import { useRef, useState } from 'react';

/**
 * The click-to-edit date control: a label that reads "None" or the current
 * date, with a date input kept mounted underneath it.
 *
 * Clicking the label opens the native calendar on that input, so a picked date
 * always lands on an element that still exists. Browsers blur a date input
 * while their calendar popup is up, and an editor that unmounted on that blur
 * would swallow the change event that commits the date. Browsers without
 * showPicker get the input revealed so they can use the field directly.
 *
 * Shared by the detail sidebar (Due date) and the list's Due date cell so both
 * behave identically: click to add, click to change, the current value
 * pre-filled in the picker, and every change handed straight back through
 * onSave as 'YYYY-MM-DD' or null.
 */
export default function InlineDateField({
  value = null,
  onSave,
  label = 'Due date',
  buttonClassName = 'idf-trigger',
  renderValue,
}) {
  const [revealed, setRevealed] = useState(false);
  const inputRef = useRef(null);

  function openPicker() {
    const input = inputRef.current;
    if (!input) return;
    if (typeof input.showPicker !== 'function') {
      setRevealed(true);
      input.focus();
      return;
    }
    try {
      input.showPicker();
    } catch {
      setRevealed(true);
      input.focus();
    }
  }

  return (
    <span className="inline-date">
      <button
        type="button"
        className={buttonClassName}
        onClick={openPicker}
        title={value ? `Change ${label.toLowerCase()}` : `Add ${label.toLowerCase()}`}
        aria-label={`${label}, ${value || 'None'}`}
      >
        {renderValue ? renderValue(value) : value || 'None'}
      </button>
      <input
        ref={inputRef}
        type="date"
        className={revealed ? 'tm-date-input' : 'tm-date-input tm-date-hidden'}
        value={value || ''}
        onChange={(e) => {
          const next = e.target.value || null;
          setRevealed(false);
          if (next === (value || null)) return;
          onSave(next);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setRevealed(false);
        }}
        tabIndex={revealed ? 0 : -1}
        aria-hidden={revealed ? undefined : true}
        aria-label={label}
      />
    </span>
  );
}

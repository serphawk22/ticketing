'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, CloseIcon, PlusIcon } from './icons';

/**
 * A value that is read-only until clicked, then edited in place. Commits on
 * Enter or blur and reverts on Escape.
 */
export function InlineText({
  value,
  placeholder,
  onSave,
  multiline = false,
  disabled = false,
  className = '',
  inputClassName = '',
  ariaLabel,
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const ref = useRef(null);

  useEffect(() => {
    if (!editing) setDraft(value ?? '');
  }, [value, editing]);

  useEffect(() => {
    if (editing && ref.current) {
      ref.current.focus();
      if (ref.current.select) ref.current.select();
    }
  }, [editing]);

  function commit() {
    const next = draft.trim();
    setEditing(false);
    if (next !== (value ?? '')) onSave(next);
  }

  function cancel() {
    setDraft(value ?? '');
    setEditing(false);
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      cancel();
    } else if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      commit();
    }
  }

  if (editing) {
    const shared = {
      ref,
      value: draft,
      onChange: (e) => setDraft(e.target.value),
      onBlur: commit,
      onKeyDown,
      className: `inline-input ${inputClassName}`,
      'aria-label': ariaLabel,
    };
    return multiline ? <textarea rows={3} {...shared} /> : <input type="text" {...shared} />;
  }

  const empty = !String(value ?? '').trim();
  return (
    <button
      type="button"
      className={`inline-value ${empty ? 'is-empty' : ''} ${className}`}
      onClick={() => !disabled && setEditing(true)}
      disabled={disabled}
      aria-label={ariaLabel}
    >
      {empty ? placeholder : value}
    </button>
  );
}

/** Labelled row used throughout the Details sidebar. */
export function FieldRow({ label, children, htmlFor }) {
  return (
    <div className="tm-field">
      <span className="tm-field-label" id={htmlFor}>
        {label}
      </span>
      <div className="tm-field-value">{children}</div>
    </div>
  );
}

/** Closes when a click lands outside, and on Escape. */
export function useDismiss(open, onClose) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    function onDown(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    }
    function onKey(e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);
  return ref;
}

export function Menu({ open, onClose, children, className = '', align = 'left' }) {
  const ref = useDismiss(open, onClose);
  if (!open) return null;
  return (
    <div ref={ref} className={`tm-menu ${className} align-${align}`} role="menu">
      {children}
    </div>
  );
}

export function MenuItem({ children, onClick, active, tone = '', icon }) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`tm-menu-item${active ? ' is-active' : ''}${tone ? ` is-${tone}` : ''}`}
      onClick={onClick}
    >
      {icon}
      <span>{children}</span>
    </button>
  );
}

export function MenuLabel({ children }) {
  return <div className="tm-menu-label">{children}</div>;
}

/** Removable chip list with an inline add field. */
export function ChipInput({ values, onSave, placeholder = 'Add labels', disabled }) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (adding && inputRef.current) inputRef.current.focus();
  }, [adding]);

  function add() {
    const next = draft.trim().replace(/,$/, '');
    setDraft('');
    if (!next) {
      setAdding(false);
      return;
    }
    const merged = values.includes(next) ? values : [...values, next];
    onSave(merged);
    inputRef.current?.focus();
  }

  return (
    <div className="tm-chips">
      {values.map((label) => (
        <span key={label} className="tm-chip">
          {label}
          {!disabled && (
            <button
              type="button"
              className="tm-chip-x"
              onClick={() => onSave(values.filter((l) => l !== label))}
              aria-label={`Remove label ${label}`}
            >
              <CloseIcon size={10} />
            </button>
          )}
        </span>
      ))}
      {adding ? (
        <input
          ref={inputRef}
          className="tm-chip-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={add}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            } else if (e.key === 'Escape') {
              e.stopPropagation();
              setDraft('');
              setAdding(false);
            }
          }}
          placeholder="label"
          aria-label="New label"
        />
      ) : (
        !disabled && (
          <button type="button" className="tm-add-chip" onClick={() => setAdding(true)}>
            <PlusIcon size={12} />
            {values.length ? '' : placeholder}
          </button>
        )
      )}
    </div>
  );
}

export { ChevronDown };

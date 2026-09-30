'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

function ColumnsIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16M15 4v16" />
    </svg>
  );
}

/**
 * The trailing column-settings icon in the table header.
 *
 * It opens a "manage columns" picker pinned under the icon. The picker renders
 * into document.body because the header cell is a sticky element inside a
 * horizontal scroll container: an absolutely positioned child would be clipped
 * by the scroll box and dragged along with the columns.
 */
export default function ListColumnsMenu({ children }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const wrapRef = useRef(null);
  const menuRef = useRef(null);
  const triggerRef = useRef(null);

  const close = useCallback(() => {
    setOpen(false);
    setPos(null);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    function onDown(e) {
      const inside =
        wrapRef.current?.contains(e.target) || menuRef.current?.contains(e.target);
      if (!inside) close();
    }
    function onKey(e) {
      if (e.key === 'Escape') close();
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  useLayoutEffect(() => {
    if (!open) return undefined;
    const trigger = triggerRef.current;
    if (!trigger) return undefined;
    const t = trigger.getBoundingClientRect();
    const width = menuRef.current?.offsetWidth || 208;
    const height = menuRef.current?.offsetHeight || 200;
    const gap = 4;
    const top = t.bottom + gap;
    let right = window.innerWidth - t.right;
    if (right + width > window.innerWidth - 8) right = 8;
    setPos((prev) =>
      prev && prev.top === top && prev.right === right ? prev : { top, right }
    );
    function onViewportChange() {
      setPos(null);
      setOpen(false);
    }
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('scroll', onViewportChange, true);
    return () => {
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('scroll', onViewportChange, true);
    };
  }, [open]);

  return (
    <div className="list-columns-wrap" ref={wrapRef}>
      <button
        ref={triggerRef}
        type="button"
        className="list-columns-btn"
        aria-expanded={open}
        aria-haspopup="true"
        aria-label="Manage columns"
        title="Manage columns"
        onClick={() => setOpen((o) => !o)}
      >
        <ColumnsIcon />
      </button>

      {open &&
        createPortal(
          <div ref={menuRef} className="menu-popup list-menu list-columns-menu" role="menu" style={{ top: pos?.top, right: pos?.right }}>
            {children}
          </div>,
          document.body
        )}
    </div>
  );
}
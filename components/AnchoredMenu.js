'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * A menu pinned to a trigger that lives inside a clipping container.
 *
 * The sidebar rows scroll inside `overflow-y: auto`, so a menu rendered in
 * place is cut off at the sidebar's edge. Rendering to the body removes both
 * that clipping and any stacking-context fight with the rows behind it.
 *
 * Placement matches the row menus used by the ticket list: aligned to the
 * trigger's right edge, opened below it, flipped above when there is no room
 * below, and clamped inside the viewport on both axes.
 */
export default function AnchoredMenu({
  open,
  onClose,
  // A getter rather than an element, so the trigger can be a ref that is
  // assigned after this component renders without re-rendering it.
  getAnchor,
  align = 'right',
  className = '',
  children,
}) {
  const panelRef = useRef(null);
  const [pos, setPos] = useState(null);

  const place = useCallback(() => {
    const anchor = getAnchor?.();
    const panel = panelRef.current;
    if (!anchor || !panel) return;

    const r = anchor.getBoundingClientRect();
    // The panel has to be laid out before it can be measured, hence the
    // fallback width for the frame where it is not painted yet.
    const p = panel.getBoundingClientRect();
    const gap = 4;
    const margin = 8;

    let left = align === 'right' ? r.right - (p.width || 176) : r.left;
    left = Math.max(margin, Math.min(left, window.innerWidth - (p.width || 176) - margin));

    let top = r.bottom + gap;
    if (top + (p.height || 80) > window.innerHeight - margin) {
      top = r.top - (p.height || 80) - gap;
    }
    top = Math.max(margin, Math.min(top, window.innerHeight - (p.height || 80) - margin));

    setPos((prev) => (prev && prev.top === top && prev.left === left ? prev : { top, left }));
  }, [getAnchor, align]);

  // Measured in a layout effect so the panel is already in the DOM, and has a
  // size to measure, before the browser paints it anywhere.
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return undefined;
    }
    place();
    // Scrolling the sidebar moves the trigger, so the menu follows it rather
    // than being left pointing at where the row used to be.
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, place]);

  useEffect(() => {
    if (!open) return undefined;
    function onDown(e) {
      const panel = panelRef.current;
      const anchor = getAnchor?.();
      if (panel?.contains(e.target)) return;
      if (anchor?.contains(e.target)) return;
      onClose();
    }
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose, getAnchor]);

  if (!open) return null;

  return createPortal(
    <div
      ref={panelRef}
      className={`menu-popup anchored-menu ${className}`.trim()}
      role="menu"
      style={{
        top: pos?.top ?? 0,
        left: pos?.left ?? 0,
        // Hidden only until the first measurement lands, which happens before
        // paint, so this is never seen as a flash at the wrong spot.
        visibility: pos ? 'visible' : 'hidden',
      }}
    >
      {children}
    </div>,
    document.body
  );
}
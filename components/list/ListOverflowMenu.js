'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { ToggleRow } from './viewPrefs';
import { PRIORITY_META, STATUS_META } from '../meta';
import { buildCsv, downloadCsv } from '../../lib/csv';

function ChevronRight() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

function FeedbackIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2Z" />
    </svg>
  );
}

/**
 * Where to pin the flyout before it has been measured.
 *
 * Laying it out over the trigger row is a sane first frame, and the layout
 * effect refines it to the measured position before the browser paints. That
 * avoids a "not measured yet" state, which would have to be hidden -- and a
 * hidden element cannot receive the mouseenter that keeps it open.
 */
function flyoutStyle(pos, trigger) {
  if (pos) return { top: pos.top, left: pos.left };
  if (!trigger || typeof trigger.getBoundingClientRect !== 'function') return null;
  const t = trigger.getBoundingClientRect();
  return { top: t.top - 4, left: t.left };
}

function useOutsideClose(open, refs, onClose) {
  useEffect(() => {
    if (!open) return undefined;
    function onDown(e) {
      const inside = refs.some((r) => r.current && r.current.contains(e.target));
      if (!inside) onClose();
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
  }, [open, refs, onClose]);
}

/**
 * The "..." menu at the right of the list toolbar.
 *
 * The two toggles write straight through to the list's own state, so the
 * table updates under the menu while it stays open. Everything else opens a
 * modal or starts a download, which is allowed to close the menu first.
 */
export default function ListOverflowMenu({
  isAdmin,
  hideDone,
  showHierarchy,
  selectedCount,
  scopeName,
  visibleColumns,
  rows,
  columns,
  resetView,
  onToggleHideDone,
  onToggleHierarchy,
  onOpenChart,
  onOpenFormatRules,
  onOpenImport,
  onOpenBulk,
  onGoToAll,
  onOpenFeedback,
}) {
  const [open, setOpen] = useState(false);
  // Open state and position are kept apart deliberately. The measuring effect
  // below sets the position, so it must depend on the boolean only; keying it
  // on the position re-runs it forever.
  const [exportOpen, setExportOpen] = useState(false);
  const [exportPos, setExportPos] = useState(null);
  const closeTimer = useRef(null);
  const wrapRef = useRef(null);
  const submenuRef = useRef(null);
  const triggerRef = useRef(null);

  const close = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setOpen(false);
    setExportOpen(false);
    setExportPos(null);
  }, []);

  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    []
  );

  useOutsideClose(open, [wrapRef, submenuRef], close);

  // The parent menu is a scroll container, so a flyout placed inside it would
  // be clipped. Render it to the body instead, pinned to the trigger's box and
  // nudged back inside the viewport when it would run off an edge.
  const placeSubmenu = useCallback(() => {
    const el = submenuRef.current;
    const trigger = triggerRef.current;
    if (!el || !trigger) return;
    const t = trigger.getBoundingClientRect();
    const width = el.offsetWidth || 232;
    const height = el.offsetHeight || 72;
    const gap = 4;
    let left = t.left - width - gap;
    if (left < 8) left = t.left + t.width + gap;
    let top = t.top - 4;
    if (top + height > window.innerHeight - 8) top = Math.max(8, window.innerHeight - height - 8);
    setExportPos((prev) =>
      prev && prev.top === top && prev.left === left ? prev : { top, left }
    );
  }, []);

  // Opening keeps any position already measured: clearing it would blank the
  // flyout for a frame, and an element the pointer is still crossing into has
  // to stay visible to be hovered.
  const openSubmenu = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setExportOpen(true);
  }, []);

  // Leaving the trigger row usually means heading for the flyout, so closing
  // waits a moment first. The bridge inside the flyout spans the gap, so
  // arriving there -- however slowly -- fires mouseenter and cancels this.
  const scheduleSubmenuClose = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null;
      setExportOpen(false);
      setExportPos(null);
    }, 200);
  }, []);

  const closeSubmenu = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setExportOpen(false);
    setExportPos(null);
  }, []);

  // Measured in a layout effect so the flyout is already in the DOM (and has a
  // width to measure) by the time it is positioned. The dependency is the
  // boolean, so this runs once per open rather than once per render.
  useLayoutEffect(() => {
    if (!exportOpen) return undefined;
    placeSubmenu();
    // A scroll or resize invalidates the pinned coordinates; closing is
    // simpler than re-measuring, and the next hover reopens it in the right place.
    function onViewportChange() {
      setExportOpen(false);
      setExportPos(null);
    }
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('scroll', onViewportChange, true);
    return () => {
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('scroll', onViewportChange, true);
    };
  }, [exportOpen, placeSubmenu]);

  function exportCsv(kind) {
    // Both exports cover the same rows: what the filters are showing right
    // now. "All fields" only widens the column set.
    const list = rows;
    const columns =
      kind === 'all'
        ? [
            { key: 'id', label: 'ID' },
            { key: 'project_name', label: 'Project' },
            { key: 'title', label: 'Title' },
            { key: 'description', label: 'Description' },
            { key: 'type', label: 'Issue type' },
            { key: 'status', label: 'Status' },
            { key: 'priority', label: 'Priority' },
            { key: 'assignee', label: 'Assignee', get: (t) => t.employee_name || '' },
            { key: 'reporter', label: 'Reporter', get: (t) => t.created_by_name || '' },
            { key: 'labels', label: 'Labels' },
            { key: 'due_date', label: 'Due date' },
            { key: 'start_date', label: 'Start date' },
            { key: 'parent_id', label: 'Parent ID' },
            { key: 'created_at', label: 'Created' },
            { key: 'updated_at', label: 'Updated' },
          ]
        : [
            { key: 'work', label: 'Work' },
            { key: 'assignee', label: 'Assignee', get: (t) => t.employee_name || 'Unassigned' },
            { key: 'reporter', label: 'Reporter', get: (t) => t.created_by_name || '' },
            {
              key: 'priority',
              label: 'Priority',
              get: (t) => PRIORITY_META[t.priority]?.label || t.priority,
            },
            { key: 'status', label: 'Status', get: (t) => STATUS_META[t.status]?.label || t.status },
            { key: 'category', label: 'Category', get: (t) => t.category || '' },
            { key: 'resolution', label: 'Resolution', get: (t) => t.resolution || '' },
            { key: 'created', label: 'Created', get: (t) => t.created_at || '' },
          ].filter((c) => visibleColumns.some((v) => v.key === c.key));

    const stamp = new Date().toISOString().slice(0, 10);
    const slug = String(scopeName || 'work-items')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    downloadCsv(
      kind === 'all' ? `${slug}-all-fields-${stamp}.csv` : `${slug}-current-fields-${stamp}.csv`,
      buildCsv(columns, list)
    );
    close();
  }

  return (
    <div className="list-menu-wrap list-menu-wrap-right" ref={wrapRef}>
      <button
        type="button"
        className="list-overflow-btn"
        aria-expanded={open}
        aria-haspopup="true"
        aria-label="View options"
        title="View options"
        onClick={() => setOpen((o) => !o)}
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="19" cy="12" r="1.8" />
        </svg>
      </button>

      {open && (
        <div className="menu-popup list-menu list-menu-right list-overflow" role="menu">
          <button
            type="button"
            className="menu-item"
            role="menuitem"
            onClick={() => {
              onOpenChart();
              close();
            }}
          >
            <span className="menu-item-text">View work items as a chart</span>
          </button>

          <button
            type="button"
            className="menu-item"
            role="menuitem"
            onClick={() => {
              onOpenFormatRules();
              close();
            }}
          >
            <span className="menu-item-text">Format rules</span>
          </button>

          <div className="menu-sep" role="separator" />

          {/* Toggles stay open: the table behind the menu is meant to change as
              the switch flips, which is only visible if the menu survives. */}
          <ToggleRow
            label="Hide done work items"
            checked={hideDone}
            onToggle={onToggleHideDone}
            title="Hide work items whose status is Done"
          />
          <ToggleRow
            label="Show hierarchy"
            checked={showHierarchy}
            onToggle={onToggleHierarchy}
            title="Show parent and child work items as a tree"
          />

          <div className="menu-sep" role="separator" />

          <div
            className="list-submenu-wrap"
            onMouseEnter={openSubmenu}
            onMouseLeave={scheduleSubmenuClose}
          >
            <button
              ref={triggerRef}
              type="button"
              className="menu-item list-submenu-trigger"
              role="menuitem"
              aria-haspopup="true"
              aria-expanded={exportOpen}
              onClick={openSubmenu}
            >
              <span className="menu-item-text">Export</span>
              <span className="list-submenu-chevron" aria-hidden="true">
                <ChevronRight />
              </span>
            </button>
          </div>

        {exportOpen &&
          createPortal(
            <div
              ref={submenuRef}
              className="menu-popup list-submenu"
              role="menu"
              style={flyoutStyle(exportPos, triggerRef.current)}
              onMouseEnter={openSubmenu}
              onMouseLeave={closeSubmenu}
            >
              {/* A real child rather than a pseudo-element, so the pointer can
                  rest on it while crossing from the trigger: the gap then
                  counts as being inside the flyout, and leave does not fire. */}
              <span className="list-submenu-bridge" aria-hidden="true" />
              <button
                type="button"
                className="menu-item"
                role="menuitem"
                onClick={() => exportCsv('current')}
              >
                <span className="menu-item-text">Export Excel CSV (current fields)</span>
              </button>
              <button
                type="button"
                className="menu-item"
                role="menuitem"
                onClick={() => exportCsv('all')}
              >
                <span className="menu-item-text">Export CSV (all fields)</span>
              </button>
            </div>,
            document.body
          )}

        <button
          type="button"
          className="menu-item"
          role="menuitem"
          disabled={!isAdmin}
          title={isAdmin ? undefined : 'Only admins can import work items.'}
          onClick={() => {
            onOpenImport();
            close();
          }}
        >
          <span className="menu-item-text">Import work items from CSV</span>
        </button>

        <button
          type="button"
          className="menu-item"
          role="menuitem"
          onClick={() => {
            onOpenBulk();
            close();
          }}
        >
          <span className="menu-item-text">Bulk change work items</span>
          {selectedCount === 0 && <span className="menu-count">0 selected</span>}
        </button>

        <button
          type="button"
          className="menu-item"
          role="menuitem"
          onClick={() => {
            onGoToAll();
            close();
          }}
        >
          <span className="menu-item-text">Go to all work items</span>
        </button>

        <div className="menu-sep" role="separator" />

        <button
          type="button"
          className="menu-item list-feedback-item"
          role="menuitem"
          onClick={() => {
            onOpenFeedback();
            close();
          }}
        >
          <FeedbackIcon />
          <span className="menu-item-text">Give feedback</span>
        </button>

        <div className="menu-sep" role="separator" />

        {columns}

        {resetView && (
          <>
            <div className="menu-sep" role="separator" />
            <button
              type="button"
              className="menu-item"
              role="menuitem"
              onClick={() => {
                resetView();
                close();
              }}
            >
              <span className="menu-item-text">Reset view</span>
            </button>
          </>
        )}
        </div>
      )}
    </div>
  );
}

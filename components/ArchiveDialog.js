'use client';

import { useEffect, useState } from 'react';

/**
 * The confirm step Jira shows when a work item has children.
 *
 * Archiving or restoring the item itself is the default. The checkbox is the
 * extra choice to take the child work items with it, and it starts unchecked
 * so a parent can be put away without emptying the branch.
 */
export default function ArchiveDialog({
  mode,
  itemKey,
  childCount = 0,
  count = 1,
  onCancel,
  onConfirm,
}) {
  const [includeChildren, setIncludeChildren] = useState(false);
  const [busy, setBusy] = useState(false);
  const archiving = mode !== 'restore';
  const verb = archiving ? 'Archive' : 'Restore';
  const childLabel = `${childCount} child work ${childCount === 1 ? 'item' : 'items'}`;

  useEffect(() => {
    function onKey(event) {
      if (event.key === 'Escape') onCancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const title = count > 1 ? `${verb} ${count} work items` : `${verb} ${itemKey || 'work item'}`;

  return (
    <div
      className="modal-overlay archive-dialog"
      onMouseDown={(event) => {
        event.stopPropagation();
        onCancel();
      }}
    >
      <div
        className="modal modal-narrow"
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <h3>{title}</h3>
          <button type="button" className="modal-close" onClick={onCancel} aria-label="Close">
            ×
          </button>
        </header>

        <div className="confirm-body">
          <p>
            {archiving
              ? 'Archived work items leave the board, list, calendar, and reports. You can restore them from the Archived tab.'
              : 'Restored work items show on the board and list again, in the status they had when they were archived.'}
          </p>
          {childCount > 0 && (
            <label className="archive-children">
              <input
                type="checkbox"
                checked={includeChildren}
                onChange={(event) => setIncludeChildren(event.target.checked)}
              />
              <span>
                Also {archiving ? 'archive' : 'restore'} {childLabel}
              </span>
            </label>
          )}
        </div>

        <div className="modal-actions modal-actions-padded">
          <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm(includeChildren);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? `${verb.slice(0, -1)}ing…` : verb}
          </button>
        </div>
      </div>
    </div>
  );
}

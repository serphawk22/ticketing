'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ArchiveIcon,
  ClockIcon,
  CloneIcon,
  CommentIcon,
  CopyIcon,
  LinkIcon,
  MoveIcon,
  PaperclipIcon,
  SlackIcon,
  SubtaskIcon,
  TrashIcon,
  ViewIcon,
  VoteIcon,
  WatchersIcon,
  WatchIcon,
  WebLinkIcon,
} from '../ticket/icons';

// The order here is the contract with the spec, dividers included. Items are
// declared once so the menu, its keyboard order, and the scroll affordances
// cannot disagree about what exists.
const ITEMS = [
  { key: 'view', label: 'View work item', Icon: ViewIcon },
  { key: 'comment', label: 'Comment', Icon: CommentIcon },
  { key: 'log', label: 'Log work', Icon: ClockIcon },
  { key: 'slack', label: 'Connect Slack channel', Icon: SlackIcon },
  { key: 'attach', label: 'Attach files', Icon: PaperclipIcon },
  { key: 'vote', label: 'Add vote', Icon: VoteIcon },
  { key: 'voters', label: 'Voters', Icon: VoteIcon },
  { key: 'watch', label: 'Watch issue', Icon: WatchIcon },
  { key: 'watchers', label: 'Watchers', Icon: WatchersIcon },
  { divider: true, key: 'div1' },
  { key: 'copylink', label: 'Copy link', Icon: LinkIcon },
  { key: 'copykey', label: 'Copy work item key', Icon: CopyIcon },
  { divider: true, key: 'div2' },
  { key: 'subtask', label: 'Convert to sub-task', Icon: SubtaskIcon },
  { key: 'move', label: 'Move', Icon: MoveIcon },
  { key: 'clone', label: 'Clone', Icon: CloneIcon },
  { key: 'delete', label: 'Delete', Icon: TrashIcon },
  { key: 'archive', label: 'Archive', Icon: ArchiveIcon },
  { divider: true, key: 'div3' },
  { key: 'link', label: 'Link work item', Icon: LinkIcon },
  { key: 'weblink', label: 'Add web link', Icon: WebLinkIcon },
];

/** The row's full menu, mounted in a portal so it is never clipped by a table cell. */
export default function TicketRowMenu({ ticket, onOpen, onClose, open, anchor }) {
  const panelRef = useRef(null);
  // The trigger element is held in a ref rather than read straight off the prop
  // so the placement effect does not re-run on every parent render.
  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [scroll, setScroll] = useState({ top: false, bottom: false, up: false, down: false });

  // Anchor to the row button, flipping above it when there is no room below.
  const place = useCallback(() => {
    const a = anchorRef.current;
    const panel = panelRef.current;
    if (!a || !panel) return;
    const r = a.getBoundingClientRect();
    const p = panel.getBoundingClientRect();
    const gap = 4;
    const margin = 8;

    let left = r.right - p.width;
    left = Math.max(margin, Math.min(left, window.innerWidth - p.width - margin));

    let top = r.bottom + gap;
    if (top + p.height > window.innerHeight - margin) {
      top = r.top - p.height - gap;
    }
    top = Math.max(margin, Math.min(top, window.innerHeight - p.height - margin));

    setPos((prev) => (prev.top === top && prev.left === left ? prev : { top, left }));
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

  // The panel is taller than the menu allows, so the chevrons track real
  // scroll state rather than being always-on decoration.
  const syncScroll = useCallback(() => {
    const el = panelRef.current?.querySelector('.row-menu-scroll');
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    setScroll({
      top: el.scrollTop > 1,
      bottom: max - el.scrollTop > 1,
      up: el.scrollTop > 8,
      down: max - el.scrollTop > 8,
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) return undefined;
    syncScroll();
    const el = panelRef.current?.querySelector('.row-menu-scroll');
    el?.addEventListener('scroll', syncScroll, { passive: true });
    return () => el?.removeEventListener('scroll', syncScroll);
  }, [open, syncScroll]);

  useEffect(() => {
    if (!open) return undefined;
    function onDown(e) {
      if (panelRef.current?.contains(e.target)) return;
      if (anchorRef.current?.contains(e.target)) return;
      onClose();
    }
    function onKey(e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose, anchorRef]);

  // Arrow keys walk the menu; the first and last wrap, which is what a roving
  // menu is expected to do once focus is inside it.
  function onKeyDown(e) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const buttons = [...panelRef.current.querySelectorAll('.row-menu-item:not(:disabled)')];
    const at = buttons.indexOf(document.activeElement);
    e.preventDefault();
    const next = e.key === 'ArrowDown' ? at + 1 : at - 1;
    buttons[(next + buttons.length) % buttons.length]?.focus();
  }

  function pick(key) {
    onOpen(key);
    onClose();
  }

  if (!open) return null;

  return (
    <div
      ref={panelRef}
      className="row-menu"
      style={{ top: pos.top, left: pos.left }}
      role="menu"
      aria-label={`Actions for ${ticket.key || ticket.id}`}
      onKeyDown={onKeyDown}
    >
      {scroll.up && <span className="row-menu-chev row-menu-chev-top" aria-hidden="true" />}
      <div className="row-menu-scroll">
        {ITEMS.map((item) => {
          if (item.divider) {
            return <div key={item.key} className="row-menu-divider" role="separator" />;
          }
          const { Icon, label, key } = item;
          return (
            <button
              key={key}
              type="button"
              role="menuitem"
              className={`row-menu-item${key === 'delete' ? ' is-danger' : ''}`}
              disabled={ticket.menuDisabled?.[key] || false}
              title={ticket.menuDisabled?.[key] ? ticket.menuDisabledReasons?.[key] : undefined}
              onClick={() => pick(key)}
            >
              <Icon size={14} />
              <span>{label}</span>
            </button>
          );
        })}
      </div>
      {scroll.down && <span className="row-menu-chev row-menu-chev-bottom" aria-hidden="true" />}
    </div>
  );
}

export { ITEMS as ROW_MENU_ITEMS };

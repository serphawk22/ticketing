'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </svg>
  );
}

const ICONS = {
  created: 'M12 5v14M5 12h14',
  assignment: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
  reassignment: 'M17 2 21 6l-4 4 M3 11V9a4 4 0 0 1 4-4h14 M7 22l-4-4 4-4 M21 13v2a4 4 0 0 1-4 4H3',
  status: 'M12 2v4M12 18v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M2 12h4M18 12h4M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8',
  priority: 'M12 2 2 20h20L12 2Z M12 9v4 M12 17h.01',
  due_date: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z',
  resolution: 'M20 6 9 17l-5-5',
  comment: 'M21 12a8 8 0 0 1-8 8H7l-4 3V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8Z',
  mention: 'M16 12a4 4 0 1 0-4 4c1 0 2-.5 2-.5L13 21a8 8 0 1 1 8-9v1a2 2 0 1 1-4 0v-4',
  archive: 'M21 8v13H3V8M1 3h22v5H1zM10 12h4',
  update: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z',
};

function TypeIcon({ type }) {
  const d = ICONS[type] || ICONS.update;
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {d.split(' M').map((segment, index) => (
        <path key={index} d={(index === 0 ? segment : `M${segment}`).trim()} />
      ))}
    </svg>
  );
}

function relativeTime(value) {
  if (!value) return '';
  const then = new Date(String(value).trim().replace(' ', 'T') + 'Z').getTime();
  if (Number.isNaN(then)) return '';
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(then).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
}

const PAGE_SIZE = 20;
// Poll cadence for the badge and the open panel. The app ships no websocket or
// SSE layer, so this is the real-time mechanism: a short interval keeps the
// bell current without a page refresh.
const POLL_MS = 25000;

/**
 * Global notification bell.
 *
 * Every admin and developer sees every event in the system here, regardless of
 * project, ticket or who acted. The endpoint scopes only by the signed-in user
 * for read state, so the badge is personal even though the feed is shared.
 */
export default function NotificationBell({ currentUser }) {
  const router = useRouter();
  const canView = currentUser?.role === 'admin' || currentUser?.role === 'developer';

  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const wrapRef = useRef(null);
  const requestId = useRef(0);

  const load = useCallback(
    async ({ append = false, before = null } = {}) => {
      if (!canView) return;
      const seq = ++requestId.current;
      if (append) setLoadingMore(true);
      else setLoading(true);
      try {
        const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
        if (before) params.set('before', String(before));
        const res = await fetch(`/api/notifications?${params.toString()}`, {
          cache: 'no-store',
        });
        if (!res.ok) throw new Error(`notifications: ${res.status}`);
        const data = await res.json();
        if (!append && seq !== requestId.current) return;
        const next = data.notifications || [];
        setItems((prev) => (append ? [...prev, ...next] : next));
        setUnreadCount(Number(data.unreadCount) || 0);
        setHasMore(Boolean(data.hasMore));
        setFailed(false);
      } catch {
        if (!append && seq !== requestId.current) return;
        // Keep the last known list; the next poll can recover.
        setFailed(true);
      } finally {
        if (append) setLoadingMore(false);
        else setLoading(false);
      }
    },
    [canView]
  );

  // Fetch on mount, then poll. Refresh whenever the tab regains focus too, so a
  // return to the tab is never showing a stale badge.
  useEffect(() => {
    if (!canView) return undefined;
    load();
    const timer = setInterval(() => load(), POLL_MS);
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [canView, load]);

  // Close on outside click and Escape, matching the account and theme menus.
  useEffect(() => {
    if (!open) return undefined;
    function onDocClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!canView) return null;

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) load();
  }

  async function markRead(item) {
    if (Number(item.read)) return;
    setItems((prev) => prev.map((n) => (n.id === item.id ? { ...n, read: 1 } : n)));
    setUnreadCount((c) => Math.max(0, c - 1));
    try {
      await fetch('/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id }),
      });
    } catch {
      // The next poll reconciles server state if this fails.
    }
  }

  async function markAllRead() {
    const unread = items.filter((n) => !Number(n.read));
    if (!unread.length) return;
    setItems((prev) => prev.map((n) => ({ ...n, read: 1 })));
    setUnreadCount(0);
    try {
      await fetch('/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true }),
      });
    } catch {
      setFailed(true);
    }
  }

  function openNotification(item) {
    markRead(item);
    setOpen(false);
    if (item.link) {
      router.push(item.link);
      return;
    }
    if (item.ticket_id) {
      const key = `${item.project_key || 'TM'}-${item.ticket_id}`;
      router.push(
        item.project_id
          ? `/projects/${item.project_id}/list?selectedIssue=${encodeURIComponent(key)}`
          : `/work-items?selectedIssue=${encodeURIComponent(key)}`
      );
    }
  }

  return (
    <div className="notif-wrap" ref={wrapRef}>
      <button
        type="button"
        className="icon-btn notif-btn"
        onClick={toggle}
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
        aria-haspopup="true"
        aria-expanded={open}
        title="Notifications"
      >
        <BellIcon />
        {unreadCount > 0 && (
          <span className="notif-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
        )}
      </button>

      {open && (
        <div className="menu-popup notif-panel" role="dialog" aria-label="Notifications">
          <div className="notif-panel-head">
            <span className="notif-panel-title">Notifications</span>
            {unreadCount > 0 && (
              <button type="button" className="link-button notif-mark-all" onClick={markAllRead}>
                Mark all as read
              </button>
            )}
          </div>

          <div className="notif-list">
            {items.length === 0 ? (
              <div className="notif-empty">
                {loading ? 'Loading…' : failed ? 'Could not load notifications.' : 'No notifications yet.'}
              </div>
            ) : (
              items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`notif-item${!Number(item.read) ? ' is-unread' : ''}`}
                  onClick={() => openNotification(item)}
                >
                  <span className={`notif-icon notif-icon-${item.type || 'update'}`} aria-hidden="true">
                    <TypeIcon type={item.type} />
                  </span>
                  <span className="notif-body">
                    <span className="notif-title">{item.title}</span>
                    {item.body && <span className="notif-text">{item.body}</span>}
                    <span className="notif-time">{relativeTime(item.created_at)}</span>
                  </span>
                  {!Number(item.read) && <span className="notif-dot" aria-hidden="true" />}
                </button>
              ))
            )}
          </div>

          {hasMore && (
            <div className="notif-panel-foot">
              <button
                type="button"
                className="link-button"
                disabled={loadingMore}
                onClick={() => load({ append: true, before: items[items.length - 1]?.id })}
              >
                {loadingMore ? 'Loading…' : 'Load older notifications'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

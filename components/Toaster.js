'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

let nextId = 1;

/**
 * Transient confirmations, with an optional action.
 *
 * The archive flow needs an Undo that only stays available for a few seconds,
 * which the plain notice banner in the list cannot express: it is tied to the
 * next render rather than to a countdown, and it has nowhere to put a button.
 * Toasts carry their own timer, pause while hovered so a toast cannot expire
 * under the pointer that is reaching for its action, and are announced politely
 * rather than interrupting a screen reader mid-sentence.
 */
export function useToasts(timeout = 6000) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer.handle);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (toast) => {
      const id = nextId++;
      // An action toast is the one the user is most likely to be reaching for,
      // so it is given longer than a plain confirmation.
      const life = toast.action ? timeout : Math.min(timeout, 4000);
      setToasts((list) => [...list.slice(-2), { ...toast, id }]);
      timers.current.set(id, {
        handle: setTimeout(() => {
          timers.current.delete(id);
          setToasts((list) => list.filter((t) => t.id !== id));
        }, life),
        remaining: life,
      });
      return id;
    },
    [timeout]
  );

  const pause = useCallback((id) => {
    const timer = timers.current.get(id);
    if (!timer) return;
    clearTimeout(timer.handle);
  }, []);

  const resume = useCallback((id) => {
    const timer = timers.current.get(id);
    if (!timer) return;
    timer.handle = setTimeout(() => {
      timers.current.delete(id);
      setToasts((list) => list.filter((t) => t.id !== id));
    }, timer.remaining);
  }, []);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach((t) => clearTimeout(t.handle));
      pending.clear();
    };
  }, []);

  return { toasts, push, dismiss, pause, resume };
}

export function Toaster({ toasts, onDismiss, onPause, onResume }) {
  if (!toasts.length) return null;
  return (
    <div className="toaster" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`toast${toast.tone ? ` is-${toast.tone}` : ''}`}
          onMouseEnter={() => onPause(toast.id)}
          onMouseLeave={() => onResume(toast.id)}
        >
          {toast.message && <span className="toast-text">{toast.message}</span>}
          {toast.action && (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                onDismiss(toast.id);
                toast.action.onClick();
              }}
            >
              {toast.action.label}
            </button>
          )}
          <button
            type="button"
            className="toast-close"
            onClick={() => onDismiss(toast.id)}
            aria-label="Dismiss notification"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

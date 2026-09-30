'use client';

import { useEffect, useState } from 'react';

/**
 * Feedback is stored in local storage rather than posted anywhere: the app has
 * no feedback endpoint, and inventing one that silently accepts writes is worse
 * than keeping the notes on the machine that wrote them.
 */
const KEY = (scopeId) => `ticketing:feedback:${scopeId}`;

export function readFeedback(scopeId) {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(KEY(scopeId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export default function FeedbackModal({ scopeId, scopeName, onClose }) {
  const [message, setMessage] = useState('');
  const [sent, setSent] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    setSent(readFeedback(scopeId).reverse());
  }, [scopeId]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function submit(e) {
    e.preventDefault();
    const text = message.trim();
    if (!text) {
      setError('Write something first.');
      return;
    }
    const entry = {
      id: `fb-${Date.now().toString(36)}`,
      text,
      at: new Date().toISOString(),
    };
    const next = [...readFeedback(scopeId), entry];
    try {
      window.localStorage.setItem(KEY(scopeId), JSON.stringify(next));
    } catch {
      setError('Could not save that. Your browser storage may be full or blocked.');
      return;
    }
    setMessage('');
    setError('');
    setSent([entry, ...sent]);
  }

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Give feedback"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header>
          <h3>Give feedback</h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <p className="modal-note">
          Notes are kept in this browser only — there is no feedback service wired up yet.
          {scopeName ? ` They are filed under ${scopeName}.` : ''}
        </p>

        <form onSubmit={submit} className="feedback-form">
          <div className="form-group">
            <label htmlFor="feedback-message">What is on your mind?</label>
            <textarea
              id="feedback-message"
              rows={4}
              value={message}
              onChange={(e) => {
                setMessage(e.target.value);
                if (error) setError('');
              }}
              placeholder="Tell us what is confusing or missing"
            />
            {error && <p className="form-error">{error}</p>}
          </div>

          <div className="modal-actions modal-actions-padded">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Close
            </button>
            <button type="submit" className="btn-primary">
              Send feedback
            </button>
          </div>
        </form>

        {sent.length > 0 && (
          <div className="feedback-sent">
            <h4>Sent from this browser</h4>
            <ul>
              {sent.slice(0, 5).map((entry) => (
                <li key={entry.id}>
                  <p>{entry.text}</p>
                  <span>{new Date(entry.at).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

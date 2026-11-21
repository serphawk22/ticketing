'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import TicketText, { TicketRefLink } from './TicketText';
import { buildValidPrefixSet } from '@/lib/ticketRefs';

const NOTE_CATEGORIES = [
  { code: 'general', label: 'General Update' },
  { code: 'meeting', label: 'Internal Meeting' },
  { code: 'client_discussion', label: 'Client Discussion' },
  { code: 'documentation', label: 'Documentation' },
  { code: 'research', label: 'Research & R&D' },
  { code: 'training', label: 'Training & Learning' },
  { code: 'helping_teammate', label: 'Helping a Teammate' },
  { code: 'other', label: 'Other Activity' },
];

function getTodayKolkataIso() {
  return new Date(Date.now() + 330 * 60 * 1000).toISOString().slice(0, 10);
}

function shiftIso(iso, deltaDays) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

function formatTimeIst(isoOrSql) {
  if (!isoOrSql) return '';
  try {
    const raw = String(isoOrSql).trim();
    const norm = raw.endsWith('Z') || /[+-]\d{2}(:?\d{2})?$/.test(raw)
      ? raw
      : raw.replace(' ', 'T') + 'Z';
    const d = new Date(norm);
    if (Number.isNaN(d.getTime())) return raw;
    return d.toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return String(isoOrSql);
  }
}

export default function DailyNotesCard({ projects = [] }) {
  const todayIso = useMemo(() => getTodayKolkataIso(), []);
  const weekAgoIso = useMemo(() => shiftIso(todayIso, -6), [todayIso]);

  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [category, setCategory] = useState('general');
  const [workDate, setWorkDate] = useState(todayIso);
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [editingId, setEditingId] = useState(null);
  const [editBody, setEditBody] = useState('');
  const [editCategory, setEditCategory] = useState('general');
  const [savingEdit, setSavingEdit] = useState(false);

  const validPrefixes = useMemo(() => buildValidPrefixSet(projects), [projects]);

  const loadNotes = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(
        `/api/daily-notes?from=${encodeURIComponent(weekAgoIso)}&to=${encodeURIComponent(todayIso)}`,
        { cache: 'no-store' }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to load daily updates.');
      setNotes(Array.isArray(data.notes) ? data.notes : []);
    } catch (err) {
      setError(err.message || 'Could not load daily updates.');
    } finally {
      setLoading(false);
    }
  }, [weekAgoIso, todayIso]);

  useEffect(() => {
    loadNotes();
  }, [loadNotes]);

  async function handleSubmit(e) {
    e.preventDefault();
    const trimmed = body.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/daily-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category,
          workDate,
          body: trimmed,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to save update.');
      setBody('');
      if (data.note) {
        setNotes((prev) => [data.note, ...prev]);
      } else {
        await loadNotes();
      }
    } catch (err) {
      setError(err.message || 'Failed to save update.');
    } finally {
      setSubmitting(false);
    }
  }

  function startEdit(note) {
    setEditingId(note.id);
    setEditBody(note.body || '');
    setEditCategory(note.category || 'general');
  }

  async function handleSaveEdit(noteId) {
    const trimmed = editBody.trim();
    if (!trimmed || savingEdit) return;
    setSavingEdit(true);
    setError('');
    try {
      const res = await fetch(`/api/daily-notes/${noteId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: trimmed, category: editCategory }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to update note.');
      setEditingId(null);
      if (data.note) {
        setNotes((prev) => prev.map((n) => (n.id === noteId ? data.note : n)));
      } else {
        await loadNotes();
      }
    } catch (err) {
      setError(err.message || 'Failed to update note.');
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleDelete(noteId) {
    setError('');
    try {
      const res = await fetch(`/api/daily-notes/${noteId}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to delete update.');
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
    } catch (err) {
      setError(err.message || 'Failed to delete update.');
    }
  }

  return (
    <section className="m360-panel hms-daily-notes-panel" aria-labelledby="hms-daily-notes-title">
      <div className="m360-panel-head">
        <div>
          <h2 id="hms-daily-notes-title" className="m360-panel-title">
            Daily General &amp; Non-Ticket Updates
          </h2>
          <p className="m360-panel-sub">
            Share today&apos;s non-ticket work (meetings, client discussions, research, mentoring) so your manager sees your full day even without tickets due.
          </p>
        </div>
      </div>

      <div className="m360-panel-body">
        {error && (
          <div className="error-banner" role="alert" style={{ marginBottom: 12 }}>
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="hms-note-form">
          <div className="hms-note-form-row">
            <select
              className="m360-filter-select"
              aria-label="Update category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {NOTE_CATEGORIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </select>
            <input
              type="date"
              className="m360-date-input"
              aria-label="Work date"
              value={workDate}
              onChange={(e) => setWorkDate(e.target.value)}
              max={todayIso}
            />
          </div>

          <textarea
            className="hms-note-textarea"
            rows={2}
            maxLength={2000}
            placeholder="Write a quick general update (e.g., Coordinated client onboarding call, reviewed PRs, documented API workflow)…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            aria-label="Daily update text"
          />

          <div className="hms-note-form-actions">
            <span className="hms-timestamp">{body.length}/2000</span>
            <button
              type="submit"
              className="btn btn-primary"
              style={{ fontSize: 12.5, padding: '6px 14px' }}
              disabled={submitting || !body.trim()}
            >
              {submitting ? 'Posting…' : 'Post Daily Update'}
            </button>
          </div>
        </form>

        <div className="hms-notes-list">
          {loading ? (
            <div className="hms-muted-line">Loading your recent updates…</div>
          ) : notes.length === 0 ? (
            <div className="hms-muted-line">No daily updates posted in the past 7 days.</div>
          ) : (
            notes.map((n) => (
              <div key={n.id} className="hms-feed-item">
                <div className="hms-feed-badges">
                  <span className={`hms-kind-badge ${n.ticketId ? 'is-ticket' : 'is-general'}`}>
                    {n.ticketId ? 'Ticket-related' : 'General / Non-ticket'}
                  </span>
                  <span className="hms-source-tag">{n.categoryLabel || n.category}</span>
                  {n.ticketKey && (
                    <TicketRefLink ticketKey={n.ticketKey} className="ai-ticket-link" />
                  )}
                  <span className="hms-feed-time">
                    {n.workDate} · {formatTimeIst(n.createdAt)}
                  </span>
                  {editingId !== n.id && (
                    <span className="hms-note-item-actions">
                      <button type="button" className="hms-link-btn" onClick={() => startEdit(n)}>
                        Edit
                      </button>
                      <button
                        type="button"
                        className="hms-link-btn is-danger"
                        onClick={() => handleDelete(n.id)}
                      >
                        Delete
                      </button>
                    </span>
                  )}
                </div>

                {editingId === n.id ? (
                  <div className="hms-note-edit-box">
                    <select
                      className="m360-filter-select"
                      value={editCategory}
                      onChange={(e) => setEditCategory(e.target.value)}
                    >
                      {NOTE_CATEGORIES.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                    <textarea
                      className="hms-note-textarea"
                      rows={2}
                      maxLength={2000}
                      value={editBody}
                      onChange={(e) => setEditBody(e.target.value)}
                    />
                    <div className="hms-note-form-actions">
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ fontSize: 12, padding: '4px 10px' }}
                        onClick={() => setEditingId(null)}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary"
                        style={{ fontSize: 12, padding: '4px 10px' }}
                        disabled={savingEdit || !editBody.trim()}
                        onClick={() => handleSaveEdit(n.id)}
                      >
                        {savingEdit ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="hms-feed-body">
                    <TicketText text={n.body} validPrefixes={validPrefixes} />
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}

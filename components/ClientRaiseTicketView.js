'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import ClientShell from '@/components/ClientShell';
import { PRIORITY_META } from '@/components/meta';

/**
 * Raising a request, on its own route.
 *
 * A request arrives for triage: no project and no owner until the team routes
 * it. Once sent, the client is taken back to their list, where the new row --
 * and its status and assignee -- shows up.
 */
export default function ClientRaiseTicketView({ currentUser }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState({ title: '', description: '', priority: 'medium', category: 'Incident' });

  function getCalculatedDueDatePreview(category) {
    const days = category === 'Incident' ? 1 : category === 'Access Issue' ? 2 : category === 'Feature Request' ? 7 : null;
    if (!days) return null;
    const d = new Date();
    const utcYear = d.getUTCFullYear();
    const utcMonth = d.getUTCMonth();
    const utcDay = d.getUTCDate();
    const target = new Date(Date.UTC(utcYear, utcMonth, utcDay + days));
    return target.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });
  }

  const dueDatePreview = getCalculatedDueDatePreview(draft.category);

  async function handleRaise(e) {
    e.preventDefault();
    setError('');

    if (!draft.category) {
      setError('Please select a request type.');
      return;
    }

    setSubmitting(true);

    try {
      const res = await fetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: draft.title.trim(),
          description: draft.description.trim(),
          priority: draft.priority,
          category: draft.category,
          project_id: null,
          employee_id: null,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not raise the request.');

      router.push('/client');
      router.refresh();
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  return (
    <ClientShell currentUser={currentUser} single>
      <section className="client-raise">
        <h1>Raise a request</h1>
        <p className="client-sub">
          Tell us what you need. The team picks it up, and you will see the
          status and who is working on it change on{' '}
          <Link href="/client">your requests</Link>.
        </p>

        <form onSubmit={handleRaise} className="client-form">
          <div className="form-group">
            <label htmlFor="client-title">Title</label>
            <input
              id="client-title"
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              placeholder="What do you need?"
              required
              spellCheck="true"
            />
          </div>

          <div className="form-group">
            <label htmlFor="client-description">Details</label>
            <textarea
              id="client-description"
              rows={5}
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              placeholder="Add anything that helps us understand the request."
              required
              spellCheck="true"
            />
          </div>

          <div className="client-form-row">
            <div className="form-group form-group-narrow">
              <label htmlFor="client-category">Request Type</label>
              <select
                id="client-category"
                value={draft.category}
                onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                required
              >
                <option value="Incident">Incident (SLA: 1 day)</option>
                <option value="Access Issue">Access Issue (SLA: 2 days)</option>
                <option value="Feature Request">Feature Request (SLA: 7 days)</option>
              </select>
            </div>

            <div className="form-group form-group-narrow">
              <label htmlFor="client-priority">Priority</label>
              <select
                id="client-priority"
                value={draft.priority}
                onChange={(e) => setDraft({ ...draft, priority: e.target.value })}
              >
                {['low', 'medium', 'high', 'urgent'].map((key) => (
                  <option key={key} value={key}>
                    {PRIORITY_META[key].label}
                  </option>
                ))}
              </select>
            </div>

            {dueDatePreview && (
              <div className="form-group form-group-narrow" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <span style={{ fontSize: '12px', color: 'var(--muted, #666)' }}>Target Due Date</span>
                <span style={{ fontWeight: 600, color: 'var(--primary, #0c66e4)', fontSize: '13px' }}>
                  {dueDatePreview}
                </span>
              </div>
            )}

            <button type="submit" className="btn-primary" disabled={submitting} style={{ alignSelf: 'flex-end', marginBottom: '16px' }}>
              {submitting ? 'Sending…' : 'Send request'}
            </button>
          </div>

          {error && <div className="error-text">{error}</div>}
        </form>
      </section>
    </ClientShell>
  );
}

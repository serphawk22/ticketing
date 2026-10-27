'use client';

import { useState, useEffect } from 'react';

const DEFAULT_SUPPORT = {
  team_name: 'SerpHawk Support & Help Desk',
  email: 'crm@serphawk.in',
  phone: '+91 63602 70684',
  website: 'https://serphawk.com',
  hours: 'Monday – Saturday, 9:30 AM – 6:30 PM IST',
  location: 'BTM Layout 1st Stage, Bengaluru, Karnataka 560029',
  notes: 'Typical response within 2–4 hours during business hours. For software issues, submit via Report a Bug.',
  isAdmin: false,
};

export default function ContactSupportModal({ open, onClose, onToast }) {
  const [data, setData] = useState(DEFAULT_SUPPORT);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [copiedEmail, setCopiedEmail] = useState(false);
  const [copiedPhone, setCopiedPhone] = useState(false);

  // Edit fields
  const [teamName, setTeamName] = useState(DEFAULT_SUPPORT.team_name);
  const [email, setEmail] = useState(DEFAULT_SUPPORT.email);
  const [phone, setPhone] = useState(DEFAULT_SUPPORT.phone);
  const [website, setWebsite] = useState(DEFAULT_SUPPORT.website);
  const [hours, setHours] = useState(DEFAULT_SUPPORT.hours);
  const [location, setLocation] = useState(DEFAULT_SUPPORT.location);
  const [notes, setNotes] = useState(DEFAULT_SUPPORT.notes);

  useEffect(() => {
    if (!open) return;
    setEditing(false);
    setError('');

    // Fetch live settings in background without blocking initial render
    let cancelled = false;
    fetch('/api/support/settings')
      .then(async (res) => {
        if (!res.ok) return null;
        return res.json();
      })
      .then((resData) => {
        if (cancelled || !resData) return;
        setData((prev) => ({ ...prev, ...resData }));
        setTeamName(resData.team_name || DEFAULT_SUPPORT.team_name);
        setEmail(resData.email || DEFAULT_SUPPORT.email);
        setPhone(resData.phone || DEFAULT_SUPPORT.phone);
        setWebsite(resData.website || DEFAULT_SUPPORT.website);
        setHours(resData.hours || DEFAULT_SUPPORT.hours);
        setLocation(resData.location || DEFAULT_SUPPORT.location);
        setNotes(resData.notes || DEFAULT_SUPPORT.notes);
      })
      .catch(() => {
        // Fallback already pre-rendered gracefully
      });

    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => {
      cancelled = true;
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!open) return null;

  async function handleCopyEmail() {
    if (!data?.email) return;
    try {
      await navigator.clipboard.writeText(data.email);
      setCopiedEmail(true);
      setTimeout(() => setCopiedEmail(false), 2000);
      onToast?.({ message: 'Support email copied to clipboard.' });
    } catch {
      // Clipboard fallback
    }
  }

  async function handleCopyPhone() {
    if (!data?.phone) return;
    try {
      await navigator.clipboard.writeText(data.phone);
      setCopiedPhone(true);
      setTimeout(() => setCopiedPhone(false), 2000);
      onToast?.({ message: 'Phone number copied to clipboard.' });
    } catch {
      // Clipboard fallback
    }
  }

  async function handleSaveSettings(e) {
    e.preventDefault();
    setError('');
    setSaving(true);

    try {
      const res = await fetch('/api/support/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          team_name: teamName,
          email,
          phone,
          website,
          hours,
          location,
          notes,
        }),
      });

      const resData = await res.json();
      if (!res.ok) {
        throw new Error(resData.error || 'Failed to update support settings.');
      }

      setData((prev) => ({
        ...prev,
        ...resData.settings,
      }));
      setEditing(false);
      onToast?.({ message: 'Support contact details updated.' });
    } catch (err) {
      setError(err.message || 'Failed to update settings.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="support-modal-title">
      <div className="modal-panel support-modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-head-title-wrap">
            <h2 id="support-modal-title" className="modal-title">Contact Support</h2>
            <p className="modal-subtitle">Direct contact and help channels for SerpHawk internal operations</p>
          </div>
          <button type="button" className="icon-btn modal-close" onClick={onClose} aria-label="Close dialog">
            ×
          </button>
        </div>

        <div className="support-modal-body">
          {error && (
            <div className="auth-split-alert" role="alert">
              <span>{error}</span>
            </div>
          )}

          {editing ? (
            <form onSubmit={handleSaveSettings} className="support-edit-form">
              <div className="form-field">
                <label htmlFor="edit-team-name">Support Team Name</label>
                <input
                  id="edit-team-name"
                  type="text"
                  value={teamName}
                  onChange={(e) => setTeamName(e.target.value)}
                  placeholder="e.g. SerpHawk Support Desk"
                  required
                />
              </div>

              <div className="support-form-grid">
                <div className="form-field">
                  <label htmlFor="edit-email">Support Email Address</label>
                  <input
                    id="edit-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="crm@serphawk.in"
                    required
                  />
                </div>

                <div className="form-field">
                  <label htmlFor="edit-phone">Phone / Helpline</label>
                  <input
                    id="edit-phone"
                    type="text"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+91 63602 70684"
                  />
                </div>
              </div>

              <div className="support-form-grid">
                <div className="form-field">
                  <label htmlFor="edit-website">Company Website</label>
                  <input
                    id="edit-website"
                    type="url"
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                    placeholder="https://serphawk.com"
                  />
                </div>

                <div className="form-field">
                  <label htmlFor="edit-hours">Operating Hours</label>
                  <input
                    id="edit-hours"
                    type="text"
                    value={hours}
                    onChange={(e) => setHours(e.target.value)}
                    placeholder="Mon – Sat, 9:30 AM – 6:30 PM IST"
                  />
                </div>
              </div>

              <div className="form-field">
                <label htmlFor="edit-location">Office Location</label>
                <input
                  id="edit-location"
                  type="text"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="BTM Layout 1st Stage, Bengaluru, Karnataka 560029"
                />
              </div>

              <div className="form-field">
                <label htmlFor="edit-notes">SLA Guidelines & Notes</label>
                <textarea
                  id="edit-notes"
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. Average response within 2–4 hours during working hours."
                />
              </div>

              <div className="modal-foot">
                <button type="button" className="btn-secondary" onClick={() => setEditing(false)} disabled={saving}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={saving}>
                  {saving ? 'Saving…' : 'Save Details'}
                </button>
              </div>
            </form>
          ) : (
            <div className="support-info-cards">
              {/* Primary Header Card */}
              <div className="support-card support-card-primary">
                <div className="support-card-header">
                  <div className="support-icon-circle">
                    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                    </svg>
                  </div>
                  <div className="support-card-headline">
                    <div className="support-badge-row">
                      <h3 className="support-team-name">{data.team_name}</h3>
                      <span className="support-status-badge">● Active</span>
                    </div>
                    <p className="support-hours-text">
                      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline', verticalAlign: '-1px', marginRight: '4px' }}>
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="12 6 12 12 16 14" />
                      </svg>
                      {data.hours}
                    </p>
                  </div>
                </div>

                {/* Email Row */}
                <div className="support-contact-row">
                  <div className="support-contact-meta">
                    <span className="support-contact-label">Email Support</span>
                    <span className="support-email-display">{data.email}</span>
                  </div>
                  <div className="support-btn-group">
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={handleCopyEmail}
                      title="Copy email to clipboard"
                    >
                      {copiedEmail ? '✓ Copied' : 'Copy'}
                    </button>
                    <a
                      href={`mailto:${data.email}?subject=SerpHawk Internal Support Request`}
                      className="btn-primary btn-sm"
                    >
                      Send Email
                    </a>
                  </div>
                </div>

                {/* Phone / Helpline Row */}
                {data.phone && (
                  <div className="support-contact-row">
                    <div className="support-contact-meta">
                      <span className="support-contact-label">Phone / Helpline</span>
                      <span className="support-email-display">{data.phone}</span>
                    </div>
                    <div className="support-btn-group">
                      <button
                        type="button"
                        className="btn-secondary btn-sm"
                        onClick={handleCopyPhone}
                        title="Copy phone number to clipboard"
                      >
                        {copiedPhone ? '✓ Copied' : 'Copy'}
                      </button>
                      <a
                        href={`tel:${data.phone.replace(/\s+/g, '')}`}
                        className="btn-secondary btn-sm"
                      >
                        Call
                      </a>
                    </div>
                  </div>
                )}
              </div>

              {/* Website, Location & SLA Grid */}
              <div className="support-details-grid">
                {data.website && (
                  <div className="support-mini-card">
                    <span className="support-mini-label">Official Website</span>
                    <a
                      href={data.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="support-website-link"
                    >
                      {data.website.replace(/^https?:\/\//, '')}
                      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: '4px' }}>
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                        <polyline points="15 3 21 3 21 9" />
                        <line x1="10" y1="14" x2="21" y2="3" />
                      </svg>
                    </a>
                  </div>
                )}

                {data.location && (
                  <div className="support-mini-card">
                    <span className="support-mini-label">Office Location</span>
                    <span className="support-location-text">
                      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline', verticalAlign: '-2px', marginRight: '4px' }}>
                        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                        <circle cx="12" cy="10" r="3" />
                      </svg>
                      {data.location}
                    </span>
                  </div>
                )}
              </div>

              {/* Response SLA / Notes Card */}
              {data.notes && (
                <div className="support-notes-box">
                  <div className="support-notes-header">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '6px' }}>
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="16" x2="12" y2="12" />
                      <line x1="12" y1="8" x2="12.01" y2="8" />
                    </svg>
                    <span>Response Guidelines</span>
                  </div>
                  <p>{data.notes}</p>
                </div>
              )}

              {/* Admin Action */}
              {data.isAdmin && (
                <div className="support-admin-action">
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={() => setEditing(true)}
                  >
                    ⚙️ Edit Contact Details (Admin)
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {!editing && (
          <div className="modal-foot">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

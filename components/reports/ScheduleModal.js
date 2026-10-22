'use client';

import { useState } from 'react';
import { REPORT_SECTIONS, getAllReports } from '@/lib/reportMasterCatalog';

export default function ScheduleModal({ isOpen, onClose, onScheduleCreated, defaultReportSlug = '' }) {
  const allReports = getAllReports();
  const [reportSlug, setReportSlug] = useState(defaultReportSlug || allReports[0]?.slug || '');
  const [name, setName] = useState('');
  const [frequency, setFrequency] = useState('weekly');
  const [recipients, setRecipients] = useState('');
  const [format, setFormat] = useState('summary');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (!name.trim()) {
      setError('Please provide a name for this schedule');
      return;
    }
    if (!recipients.trim()) {
      setError('Please provide at least one recipient email address');
      return;
    }

    const selectedReport = allReports.find((r) => r.slug === reportSlug);

    setSaving(true);
    try {
      const res = await fetch('/api/reports/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          reportSlug,
          sectionSlug: selectedReport?.sectionSlug || 'general',
          frequency,
          recipients: recipients.trim(),
          format,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create schedule');

      onScheduleCreated?.(data.schedule);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rpt-modal-overlay" role="dialog" aria-modal="true">
      <div className="rpt-modal-box">
        <div className="rpt-modal-head">
          <h3 className="rpt-modal-title">Schedule Report Email</h3>
          <button type="button" className="rpt-modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="rpt-modal-body">
          {error && <div className="rpt-modal-error">{error}</div>}

          <div className="rpt-form-field">
            <label className="rpt-form-label">Schedule Name</label>
            <input
              type="text"
              className="rpt-input"
              placeholder="e.g. Weekly Management Ticket Summary"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <div className="rpt-form-field">
            <label className="rpt-form-label">Select Report</label>
            <select
              className="rpt-select"
              value={reportSlug}
              onChange={(e) => setReportSlug(e.target.value)}
            >
              {allReports.map((r) => (
                <option key={r.slug} value={r.slug}>
                  #{r.id} - {r.title} ({r.frequency})
                </option>
              ))}
            </select>
          </div>

          <div className="rpt-form-row">
            <div className="rpt-form-field">
              <label className="rpt-form-label">Frequency</label>
              <select
                className="rpt-select"
                value={frequency}
                onChange={(e) => setFrequency(e.target.value)}
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>

            <div className="rpt-form-field">
              <label className="rpt-form-label">Email Format</label>
              <select
                className="rpt-select"
                value={format}
                onChange={(e) => setFormat(e.target.value)}
              >
                <option value="summary">HTML KPI Summary</option>
                <option value="csv">CSV Attachment</option>
              </select>
            </div>
          </div>

          <div className="rpt-form-field">
            <label className="rpt-form-label">Recipients (comma or space separated)</label>
            <input
              type="text"
              className="rpt-input"
              placeholder="admin@example.com, manager@example.com"
              value={recipients}
              onChange={(e) => setRecipients(e.target.value)}
              required
            />
          </div>

          <div className="rpt-modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Saving...' : 'Save Schedule'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}


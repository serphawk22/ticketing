'use client';

import { useEffect, useState } from 'react';

export default function AdminLegacyMappingPanel({ employees = [] }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedEmp, setSelectedEmp] = useState({});
  const [reasons, setReasons] = useState({});
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');

  async function loadUnmapped() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/task-sheets/unmapped');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load unmapped legacy sheets.');
      setRows(data.submissions || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadUnmapped();
  }, []);

  async function mapSubmission(subId) {
    const empId = selectedEmp[subId];
    const reason = (reasons[subId] || '').trim();
    if (!empId || reason.length < 5) {
      setError('Select a target employee and enter a mapping reason (min 5 characters).');
      return;
    }
    setBusyId(subId);
    setError('');
    try {
      const res = await fetch('/api/admin/task-sheets/legacy-map', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          submission_id: subId,
          employee_id: Number(empId),
          reason,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Mapping failed.');
      await loadUnmapped();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="list-frame" style={{ padding: 16 }}>
      <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>
        Unmapped Legacy Anonymous Task Sheets ({rows.length})
      </h2>
      <p style={{ fontSize: 12, color: '#5e6c84', marginBottom: 12 }}>
        Historical shared-link submissions with <code>submitted_by IS NULL</code> remain untouched as raw records. Retrospective Owner/Admin mapping posts verified entries into <code>employee_work_logs</code> with full audit attribution.
      </p>

      {error && (
        <div className="ts-banner" role="alert" style={{ marginBottom: 12 }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {loading ? (
        <p style={{ fontSize: 13, color: '#5e6c84' }}>Loading unmapped submissions…</p>
      ) : rows.length === 0 ? (
        <p style={{ fontSize: 13, color: '#006644' }}>All historical anonymous submissions have been mapped cleanly.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="list-table" style={{ width: '100%', fontSize: 12 }}>
            <thead>
              <tr>
                <th align="left">Date / Picked Name</th>
                <th align="left">Project / Hours</th>
                <th align="left">Task</th>
                <th align="left">Assign Verified Employee</th>
                <th align="left">Reason</th>
                <th align="right">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <div><strong>{r.name}</strong></div>
                    <div style={{ color: '#5e6c84' }}>{String(r.created_at).slice(0, 16)}</div>
                  </td>
                  <td>
                    <div>{r.project}</div>
                    <div><strong>{r.hours_worked}h</strong></div>
                  </td>
                  <td>
                    <div><strong>{r.task_title}</strong></div>
                    <div style={{ color: '#5e6c84', maxWidth: 240 }}>{r.task_description}</div>
                  </td>
                  <td>
                    <select
                      className="ts-task-select"
                      value={selectedEmp[r.id] || ''}
                      onChange={(e) => setSelectedEmp((prev) => ({ ...prev, [r.id]: e.target.value }))}
                    >
                      <option value="">Pick employee…</option>
                      {employees
                        .filter((e) => e.role !== 'client')
                        .map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.name}
                          </option>
                        ))}
                    </select>
                  </td>
                  <td>
                    <input
                      className="tm-input"
                      placeholder="Verification reason (min 5 chars)"
                      value={reasons[r.id] || ''}
                      onChange={(e) => setReasons((prev) => ({ ...prev, [r.id]: e.target.value }))}
                    />
                  </td>
                  <td align="right">
                    <button
                      type="button"
                      className="btn btn-primary"
                      style={{ fontSize: 11, padding: '5px 10px' }}
                      disabled={busyId === r.id}
                      onClick={() => mapSubmission(r.id)}
                    >
                      {busyId === r.id ? 'Mapping…' : 'Map'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

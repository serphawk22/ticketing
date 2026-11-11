'use client';

import { useEffect, useState } from 'react';

export default function AdminTaskSheetTokensPanel({ employees = [] }) {
  const [tokens, setTokens] = useState([]);
  const [loading, setLoading] = useState(true);
  const [employeeId, setEmployeeId] = useState('');
  const [expiresInDays, setExpiresInDays] = useState(30);
  const [revokeExisting, setRevokeExisting] = useState(true);
  const [generatedLink, setGeneratedLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function loadTokens() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/task-sheet-tokens');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load tokens.');
      setTokens(data.tokens || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadTokens();
  }, []);

  async function issueLink(e) {
    e.preventDefault();
    if (!employeeId) return;
    setBusy(true);
    setError('');
    setGeneratedLink('');
    try {
      const res = await fetch('/api/admin/task-sheet-tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employee_id: Number(employeeId),
          expires_in_days: Number(expiresInDays) || 30,
          revoke_existing: revokeExisting,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to issue link.');
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      setGeneratedLink(`${origin}${data.sharePath}`);
      await loadTokens();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function revokeToken(id) {
    setError('');
    try {
      const res = await fetch(`/api/admin/task-sheet-tokens/${id}/revoke`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to revoke token.');
      await loadTokens();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <section className="list-frame" style={{ padding: 16 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>
          Generate Employee-Specific Task Sheet Link
        </h2>
        <p style={{ fontSize: 12, color: '#5e6c84', marginBottom: 12 }}>
          Tokens are cryptographically hashed in the database. Share the generated URL directly with the employee — it exchanges for an HttpOnly session cookie and strips the token from the browser URL.
        </p>

        {error && (
          <div className="ts-banner" role="alert" style={{ marginBottom: 12 }}>
            <strong>Error:</strong> {error}
          </div>
        )}

        <form onSubmit={issueLink} style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
          <label style={{ fontSize: 12, minWidth: 220 }}>
            Employee
            <select
              className="ts-task-select"
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              required
            >
              <option value="">Select employee…</option>
              {employees
                .filter((e) => e.active && e.role !== 'client')
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} ({e.email})
                  </option>
                ))}
            </select>
          </label>
          <label style={{ fontSize: 12, width: 130 }}>
            Valid For (Days)
            <input
              type="number"
              min={1}
              max={365}
              className="tm-input"
              value={expiresInDays}
              onChange={(e) => setExpiresInDays(Number(e.target.value))}
            />
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, paddingBottom: 8 }}>
            <input
              type="checkbox"
              checked={revokeExisting}
              onChange={(e) => setRevokeExisting(e.target.checked)}
            />
            Revoke prior links
          </label>
          <button type="submit" className="btn btn-primary" disabled={busy || !employeeId}>
            {busy ? 'Generating…' : 'Generate Secure Link'}
          </button>
        </form>

        {generatedLink && (
          <div style={{ marginTop: 12, padding: 12, background: '#e3fcef', border: '1px solid #abf5d1', borderRadius: 6, fontSize: 12 }}>
            <div style={{ fontWeight: 700, color: '#006644', marginBottom: 4 }}>
              Copy this link now (plaintext tokens are never stored and cannot be viewed again):
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                readOnly
                className="tm-input"
                style={{ flex: 1, fontFamily: 'monospace', fontSize: 12 }}
                value={generatedLink}
                onFocus={(e) => e.target.select()}
              />
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => navigator.clipboard?.writeText(generatedLink)}
              >
                Copy
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="list-frame" style={{ padding: 16 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>
          Issued Task Sheet Tokens ({tokens.length})
        </h2>
        {loading ? (
          <p style={{ fontSize: 13, color: '#5e6c84' }}>Loading tokens…</p>
        ) : tokens.length === 0 ? (
          <p style={{ fontSize: 13, color: '#5e6c84' }}>No shared Task Sheet tokens generated yet.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="list-table" style={{ width: '100%', fontSize: 13 }}>
              <thead>
                <tr>
                  <th align="left">Employee</th>
                  <th align="left">Hint</th>
                  <th align="left">Expires</th>
                  <th align="left">Last Used</th>
                  <th align="left">Status</th>
                  <th align="right">Action</th>
                </tr>
              </thead>
              <tbody>
                {tokens.map((t) => {
                  const isRevoked = Boolean(t.revoked_at);
                  const isExpired = new Date(t.expires_at).getTime() <= Date.now();
                  return (
                    <tr key={t.id}>
                      <td>
                        <strong>{t.employee_name}</strong>
                        <div style={{ fontSize: 11, color: '#5e6c84' }}>{t.employee_email}</div>
                      </td>
                      <td><code>…{t.token_hint}</code></td>
                      <td>{String(t.expires_at).slice(0, 10)}</td>
                      <td>{t.last_used_at || 'Never'}</td>
                      <td>
                        <span
                          style={{
                            padding: '2px 8px',
                            borderRadius: 999,
                            fontSize: 11,
                            fontWeight: 600,
                            background: isRevoked ? '#ffebe6' : isExpired ? '#fffae6' : '#e3fcef',
                            color: isRevoked ? '#bf2600' : isExpired ? '#974f0c' : '#006644',
                          }}
                        >
                          {isRevoked ? 'Revoked' : isExpired ? 'Expired' : 'Active'}
                        </span>
                      </td>
                      <td align="right">
                        {!isRevoked && (
                          <button
                            type="button"
                            className="btn btn-secondary"
                            style={{ fontSize: 11, padding: '4px 8px' }}
                            onClick={() => revokeToken(t.id)}
                          >
                            Revoke
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

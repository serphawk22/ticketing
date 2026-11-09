'use client';

import { useState, useEffect } from 'react';
import Avatar from './Avatar';

const CATEGORIES = [
  'All',
  'Laptop',
  'Desktop',
  'Monitor',
  'Mobile / Tablet',
  'Peripheral',
  'Access Card',
  'Software License',
  'Other',
];

const CONDITIONS = [
  { value: 'new', label: 'New' },
  { value: 'good', label: 'Good' },
  { value: 'fair', label: 'Fair' },
  { value: 'damaged', label: 'Damaged' },
];

function formatDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

export default function AssetsView({ currentUser, employees = [] }) {
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filters
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('all');

  // Asset Form Modal (Create / Edit)
  const [showAssetModal, setShowAssetModal] = useState(false);
  const [editingAsset, setEditingAsset] = useState(null);
  const [assetTag, setAssetTag] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState('Laptop');
  const [serialNumber, setSerialNumber] = useState('');
  const [condition, setCondition] = useState('good');
  const [purchaseDate, setPurchaseDate] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  // Allocate Modal
  const [allocatingAsset, setAllocatingAsset] = useState(null);
  const [allocateEmpId, setAllocateEmpId] = useState('');
  const [allocateCondition, setAllocateCondition] = useState('good');
  const [allocateNotes, setAllocateNotes] = useState('');
  const [allocating, setAllocating] = useState(false);

  // Return Modal
  const [returningAsset, setReturningAsset] = useState(null);
  const [returnCondition, setReturnCondition] = useState('good');
  const [returnNotes, setReturnNotes] = useState('');
  const [returning, setReturning] = useState(false);

  // History & Details Modal
  const [historyAsset, setHistoryAsset] = useState(null);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const isAdmin = currentUser?.role === 'admin';

  async function fetchAssets() {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (categoryFilter !== 'All') params.set('category', categoryFilter);
      if (search.trim()) params.set('search', search.trim());

      const res = await fetch(`/api/assets?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load assets');
      setAssets(data.assets || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchAssets();
  }, [categoryFilter, statusFilter, search]);

  function openCreateModal() {
    setEditingAsset(null);
    setAssetTag('');
    setName('');
    setCategory('Laptop');
    setSerialNumber('');
    setCondition('good');
    setPurchaseDate('');
    setNotes('');
    setFormError('');
    setShowAssetModal(true);
  }

  function openEditModal(asset) {
    setEditingAsset(asset);
    setAssetTag(asset.asset_tag || '');
    setName(asset.name || '');
    setCategory(asset.category || 'Laptop');
    setSerialNumber(asset.serial_number || '');
    setCondition(asset.condition || 'good');
    setPurchaseDate(asset.purchase_date || '');
    setNotes(asset.notes || '');
    setFormError('');
    setShowAssetModal(true);
  }

  async function handleSaveAsset(e) {
    e.preventDefault();
    if (!assetTag.trim() || !name.trim()) {
      setFormError('Asset tag and name are required.');
      return;
    }

    setSaving(true);
    setFormError('');

    try {
      const payload = {
        asset_tag: assetTag.trim(),
        name: name.trim(),
        category,
        serial_number: serialNumber.trim(),
        condition,
        purchase_date: purchaseDate || null,
        notes: notes.trim(),
      };

      const url = editingAsset ? `/api/assets/${editingAsset.id}` : '/api/assets';
      const method = editingAsset ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save asset');

      setShowAssetModal(false);
      await fetchAssets();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleAllocate(e) {
    e.preventDefault();
    if (!allocatingAsset || !allocateEmpId) return;

    setAllocating(true);
    try {
      const res = await fetch(`/api/assets/${allocatingAsset.id}/allocate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employee_id: allocateEmpId,
          condition: allocateCondition,
          notes: allocateNotes.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to allocate asset');

      setAllocatingAsset(null);
      setAllocateEmpId('');
      setAllocateNotes('');
      await fetchAssets();
    } catch (err) {
      alert(err.message);
    } finally {
      setAllocating(false);
    }
  }

  async function handleReturn(e) {
    e.preventDefault();
    if (!returningAsset) return;

    setReturning(true);
    try {
      const res = await fetch(`/api/assets/${returningAsset.id}/return`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          condition: returnCondition,
          notes: returnNotes.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to return asset');

      setReturningAsset(null);
      setReturnNotes('');
      await fetchAssets();
    } catch (err) {
      alert(err.message);
    } finally {
      setReturning(false);
    }
  }

  async function openHistory(assetId) {
    setLoadingHistory(true);
    try {
      const res = await fetch(`/api/assets/${assetId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load asset details');
      setHistoryAsset(data.asset);
    } catch (err) {
      alert(err.message);
    } finally {
      setLoadingHistory(false);
    }
  }

  async function handleDeleteAsset(assetId) {
    if (!confirm('Are you sure you want to permanently delete this asset?')) return;
    try {
      const res = await fetch(`/api/assets/${assetId}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete asset');
      await fetchAssets();
    } catch (err) {
      alert(err.message);
    }
  }

  // Aggregate metrics
  const totalCount = assets.length;
  const availableCount = assets.filter((a) => a.status === 'available').length;
  const allocatedCount = assets.filter((a) => a.status === 'allocated').length;
  const maintenanceCount = assets.filter((a) => a.status === 'maintenance').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Company Asset Inventory</h2>
          <p style={{ fontSize: 13, color: 'var(--text-subtle)', margin: '4px 0 0 0' }}>
            Track hardware, devices, software licenses, custody, and allocation history
          </p>
        </div>
        {isAdmin && (
          <button type="button" className="btn-primary" onClick={openCreateModal}>
            + Add New Asset
          </button>
        )}
      </div>

      {/* Metric Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <div style={{ padding: '12px 16px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
          <div style={{ fontSize: 12, color: 'var(--text-subtle)', fontWeight: 500 }}>Total Assets</div>
          <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>{totalCount}</div>
        </div>
        <div style={{ padding: '12px 16px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
          <div style={{ fontSize: 12, color: 'var(--text-subtle)', fontWeight: 500 }}>Available (In Stock)</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#16a34a', marginTop: 4 }}>{availableCount}</div>
        </div>
        <div style={{ padding: '12px 16px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
          <div style={{ fontSize: 12, color: 'var(--text-subtle)', fontWeight: 500 }}>Allocated (In Use)</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#2563eb', marginTop: 4 }}>{allocatedCount}</div>
        </div>
        <div style={{ padding: '12px 16px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
          <div style={{ fontSize: 12, color: 'var(--text-subtle)', fontWeight: 500 }}>Maintenance / Repair</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#d97706', marginTop: 4 }}>{maintenanceCount}</div>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', background: 'var(--bg-surface)', padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border)' }}>
        <div className="search-field" style={{ flex: 1, minWidth: 200, margin: 0 }}>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by tag, name, or serial number…"
            style={{ width: '100%', height: 34, fontSize: 13 }}
          />
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <span style={{ color: 'var(--text-subtle)' }}>Category:</span>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            style={{ height: 34, fontSize: 13 }}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <span style={{ color: 'var(--text-subtle)' }}>Status:</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{ height: 34, fontSize: 13 }}
          >
            <option value="all">All Statuses</option>
            <option value="available">Available</option>
            <option value="allocated">Allocated</option>
            <option value="maintenance">Maintenance</option>
            <option value="retired">Retired</option>
            <option value="lost">Lost</option>
          </select>
        </label>
      </div>

      {/* Asset Table */}
      {loading ? (
        <div style={{ padding: 36, textAlign: 'center', color: 'var(--text-subtle)' }}>Loading assets…</div>
      ) : error ? (
        <div style={{ padding: 14, background: 'rgba(239, 68, 68, 0.1)', color: 'var(--danger)', borderRadius: 6 }}>{error}</div>
      ) : assets.length === 0 ? (
        <div style={{ padding: 48, textAlign: 'center', border: '1px dashed var(--border)', borderRadius: 8, color: 'var(--text-subtle)' }}>
          No assets found matching the criteria. Click "+ Add New Asset" to register hardware or devices.
        </div>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Asset Tag</th>
                <th>Name & Category</th>
                <th>Serial Number</th>
                <th>Condition</th>
                <th>Status</th>
                <th>Assigned To</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {assets.map((asset) => {
                const isAvailable = asset.status === 'available';
                const isAllocated = asset.status === 'allocated';
                const isMaintenance = asset.status === 'maintenance';

                const statusBg = isAvailable
                  ? 'rgba(34, 197, 94, 0.12)'
                  : isAllocated
                  ? 'rgba(59, 130, 246, 0.12)'
                  : isMaintenance
                  ? 'rgba(234, 179, 8, 0.12)'
                  : 'rgba(107, 114, 128, 0.12)';
                const statusColor = isAvailable
                  ? '#15803d'
                  : isAllocated
                  ? '#1d4ed8'
                  : isMaintenance
                  ? '#b45309'
                  : '#4b5563';

                return (
                  <tr key={asset.id}>
                    <td>
                      <span style={{ fontWeight: 600, fontFamily: 'monospace', fontSize: 13 }}>
                        {asset.asset_tag}
                      </span>
                    </td>
                    <td>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{asset.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{asset.category}</div>
                      </div>
                    </td>
                    <td>
                      <span style={{ fontSize: 12, color: asset.serial_number ? 'inherit' : 'var(--text-subtle)' }}>
                        {asset.serial_number || '—'}
                      </span>
                    </td>
                    <td>
                      <span style={{ textTransform: 'capitalize', fontSize: 12 }}>{asset.condition}</span>
                    </td>
                    <td>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          padding: '2px 8px',
                          borderRadius: 999,
                          background: statusBg,
                          color: statusColor,
                          textTransform: 'uppercase',
                          letterSpacing: '0.04em',
                        }}
                      >
                        {asset.status}
                      </span>
                    </td>
                    <td>
                      {asset.assigned_employee_name ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <Avatar name={asset.assigned_employee_name} size={24} assigned />
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 500 }}>{asset.assigned_employee_name}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>
                              Since {formatDate(asset.active_allocated_at)}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <span style={{ fontSize: 12, color: 'var(--text-subtle)', fontStyle: 'italic' }}>
                          In Storage
                        </span>
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {isAdmin && isAvailable && (
                          <button
                            type="button"
                            className="btn-primary"
                            onClick={() => {
                              setAllocatingAsset(asset);
                              setAllocateCondition(asset.condition || 'good');
                              setAllocateEmpId('');
                              setAllocateNotes('');
                            }}
                            style={{ fontSize: 11, padding: '3px 8px' }}
                          >
                            Allocate
                          </button>
                        )}
                        {isAdmin && isAllocated && (
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={() => {
                              setReturningAsset(asset);
                              setReturnCondition(asset.condition || 'good');
                              setReturnNotes('');
                            }}
                            style={{ fontSize: 11, padding: '3px 8px' }}
                          >
                            Return
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn-ghost"
                          onClick={() => openHistory(asset.id)}
                          style={{ fontSize: 11, padding: '3px 8px' }}
                          title="View history and details"
                        >
                          History
                        </button>
                        {isAdmin && (
                          <button
                            type="button"
                            className="btn-ghost"
                            onClick={() => openEditModal(asset)}
                            style={{ fontSize: 11, padding: '3px 8px' }}
                          >
                            Edit
                          </button>
                        )}
                        {isAdmin && !isAllocated && (
                          <button
                            type="button"
                            onClick={() => handleDeleteAsset(asset.id)}
                            style={{ background: 'transparent', border: 'none', color: 'var(--text-subtle)', cursor: 'pointer', fontSize: 14 }}
                            title="Delete asset"
                          >
                            ×
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Asset Create / Edit Modal */}
      {showAssetModal && (
        <div className="modal-overlay" onMouseDown={() => setShowAssetModal(false)}>
          <div
            className="modal"
            style={{ maxWidth: 520 }}
            role="dialog"
            aria-modal="true"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <header>
              <h3>{editingAsset ? 'Edit Asset Details' : 'Register New Asset'}</h3>
              <button type="button" className="modal-close" onClick={() => setShowAssetModal(false)}>×</button>
            </header>

            <form onSubmit={handleSaveAsset} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {formError && (
                <div style={{ padding: 10, background: 'rgba(239, 68, 68, 0.1)', color: 'var(--danger)', borderRadius: 6, fontSize: 13 }}>
                  {formError}
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label>Asset Tag *</label>
                  <input
                    type="text"
                    value={assetTag}
                    onChange={(e) => setAssetTag(e.target.value.toUpperCase())}
                    placeholder="e.g. LAP-2024-001"
                    required
                  />
                </div>

                <div className="form-group">
                  <label>Category *</label>
                  <select value={category} onChange={(e) => setCategory(e.target.value)}>
                    {CATEGORIES.filter((c) => c !== 'All').map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label>Asset Name / Model *</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={'e.g. MacBook Pro 16" M3 Max'}
                  required
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label>Serial Number</label>
                  <input
                    type="text"
                    value={serialNumber}
                    onChange={(e) => setSerialNumber(e.target.value)}
                    placeholder="e.g. C02G45ABC"
                  />
                </div>

                <div className="form-group">
                  <label>Condition</label>
                  <select value={condition} onChange={(e) => setCondition(e.target.value)}>
                    {CONDITIONS.map((c) => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label>Purchase / Procurement Date</label>
                <input
                  type="date"
                  value={purchaseDate}
                  onChange={(e) => setPurchaseDate(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label>Notes / Specification Details</label>
                <textarea
                  rows="2"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Hardware specifications, accessories included, etc."
                />
              </div>

              <div className="modal-actions" style={{ marginTop: 14 }}>
                <button type="button" className="btn-secondary" onClick={() => setShowAssetModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={saving}>
                  {saving ? 'Saving…' : editingAsset ? 'Save Changes' : 'Register Asset'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Allocate Modal */}
      {allocatingAsset && (
        <div className="modal-overlay" onMouseDown={() => setAllocatingAsset(null)}>
          <div
            className="modal"
            style={{ maxWidth: 480 }}
            role="dialog"
            aria-modal="true"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <header>
              <h3>Allocate Asset: {allocatingAsset.asset_tag}</h3>
              <button type="button" className="modal-close" onClick={() => setAllocatingAsset(null)}>×</button>
            </header>

            <form onSubmit={handleAllocate} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ fontSize: 13, color: 'var(--text-subtle)' }}>
                Item: <strong>{allocatingAsset.name}</strong> ({allocatingAsset.category})
              </div>

              <div className="form-group">
                <label>Select Employee *</label>
                <select
                  value={allocateEmpId}
                  onChange={(e) => setAllocateEmpId(e.target.value)}
                  required
                >
                  <option value="">-- Choose Employee --</option>
                  {employees
                    .filter((e) => e.active)
                    .map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.name} ({emp.department || 'General'})
                      </option>
                    ))}
                </select>
              </div>

              <div className="form-group">
                <label>Issued Condition</label>
                <select
                  value={allocateCondition}
                  onChange={(e) => setAllocateCondition(e.target.value)}
                >
                  {CONDITIONS.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Allocation Notes (Optional)</label>
                <textarea
                  rows="2"
                  value={allocateNotes}
                  onChange={(e) => setAllocateNotes(e.target.value)}
                  placeholder="e.g. Issued with power adapter, mouse, and carrying sleeve"
                />
              </div>

              <div className="modal-actions" style={{ marginTop: 14 }}>
                <button type="button" className="btn-secondary" onClick={() => setAllocatingAsset(null)}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={allocating}>
                  {allocating ? 'Allocating…' : 'Confirm Allocation'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Return Modal */}
      {returningAsset && (
        <div className="modal-overlay" onMouseDown={() => setReturningAsset(null)}>
          <div
            className="modal"
            style={{ maxWidth: 480 }}
            role="dialog"
            aria-modal="true"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <header>
              <h3>Return Asset: {returningAsset.asset_tag}</h3>
              <button type="button" className="modal-close" onClick={() => setReturningAsset(null)}>×</button>
            </header>

            <form onSubmit={handleReturn} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ fontSize: 13, color: 'var(--text-subtle)' }}>
                Returning from: <strong>{returningAsset.assigned_employee_name}</strong>
              </div>

              <div className="form-group">
                <label>Returned Condition *</label>
                <select
                  value={returnCondition}
                  onChange={(e) => setReturnCondition(e.target.value)}
                >
                  {CONDITIONS.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Return Notes / Inspection Remarks</label>
                <textarea
                  rows="2"
                  value={returnNotes}
                  onChange={(e) => setReturnNotes(e.target.value)}
                  placeholder="e.g. Power cord received, checked operational status, factory reset"
                />
              </div>

              <div className="modal-actions" style={{ marginTop: 14 }}>
                <button type="button" className="btn-secondary" onClick={() => setReturningAsset(null)}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={returning}>
                  {returning ? 'Processing…' : 'Confirm Return'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* History & Details Modal */}
      {historyAsset && (
        <div className="modal-overlay" onMouseDown={() => setHistoryAsset(null)}>
          <div
            className="modal"
            style={{ maxWidth: 640, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}
            role="dialog"
            aria-modal="true"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <header>
              <div>
                <h3 style={{ margin: 0 }}>Asset History: {historyAsset.asset_tag}</h3>
                <span style={{ fontSize: 12, color: 'var(--text-subtle)' }}>
                  {historyAsset.name} · Serial: {historyAsset.serial_number || 'N/A'}
                </span>
              </div>
              <button type="button" className="modal-close" onClick={() => setHistoryAsset(null)}>×</button>
            </header>

            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, padding: 12, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 6 }}>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>Status</div>
                  <div style={{ fontWeight: 600, textTransform: 'capitalize', fontSize: 13 }}>{historyAsset.status}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>Current Condition</div>
                  <div style={{ fontWeight: 600, textTransform: 'capitalize', fontSize: 13 }}>{historyAsset.condition}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>Procured Date</div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{formatDate(historyAsset.purchase_date)}</div>
                </div>
              </div>

              <h4 style={{ margin: '8px 0 0 0', fontSize: 13 }}>Custody & Allocation Timeline</h4>

              {historyAsset.history?.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-subtle)', fontSize: 13 }}>
                  No allocation history for this asset yet.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {historyAsset.history?.map((entry) => (
                    <div
                      key={entry.id}
                      style={{
                        padding: '10px 14px',
                        background: 'var(--bg-surface)',
                        border: '1px solid var(--border)',
                        borderRadius: 6,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontWeight: 600, fontSize: 13 }}>{entry.employee_name}</span>
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            padding: '2px 8px',
                            borderRadius: 999,
                            background: entry.returned_at ? 'var(--bg-hover)' : 'rgba(59, 130, 246, 0.15)',
                            color: entry.returned_at ? 'var(--text-subtle)' : '#1d4ed8',
                          }}
                        >
                          {entry.returned_at ? 'Returned' : 'Current Custodian'}
                        </span>
                      </div>

                      <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>
                        Allocated: <strong>{formatDate(entry.allocated_at)}</strong> (Condition: {entry.issued_condition || 'N/A'})
                        {entry.returned_at && (
                          <span> · Returned: <strong>{formatDate(entry.returned_at)}</strong> (Condition: {entry.returned_condition || 'N/A'})</span>
                        )}
                      </div>

                      {entry.notes && (
                        <div style={{ fontSize: 12, color: 'var(--text-subtle)', background: 'var(--bg-hover)', padding: '6px 8px', borderRadius: 4, whiteSpace: 'pre-line' }}>
                          {entry.notes}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="modal-actions" style={{ marginTop: 14 }}>
              <button type="button" className="btn-secondary" onClick={() => setHistoryAsset(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


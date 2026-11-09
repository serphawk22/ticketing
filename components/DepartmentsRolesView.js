'use client';

import { useState, useEffect } from 'react';
import Avatar from './Avatar';

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

export default function DepartmentsRolesView({ currentUser }) {
  const [activeSubTab, setActiveSubTab] = useState('departments');
  const [departments, setDepartments] = useState([]);
  const [designations, setDesignations] = useState([]);
  const [reportingTree, setReportingTree] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Department Modal State
  const [showDeptModal, setShowDeptModal] = useState(false);
  const [editingDept, setEditingDept] = useState(null);
  const [deptName, setDeptName] = useState('');
  const [deptCode, setDeptCode] = useState('');
  const [deptDesc, setDeptDesc] = useState('');
  const [savingDept, setSavingDept] = useState(false);
  const [deptError, setDeptError] = useState('');

  // Designation Modal State
  const [showDesigModal, setShowDesigModal] = useState(false);
  const [editingDesig, setEditingDesig] = useState(null);
  const [desigTitle, setDesigTitle] = useState('');
  const [desigCode, setDesigCode] = useState('');
  const [desigDeptId, setDesigDeptId] = useState('');
  const [desigLevel, setDesigLevel] = useState(1);
  const [desigDesc, setDesigDesc] = useState('');
  const [savingDesig, setSavingDesig] = useState(false);
  const [desigError, setDesigError] = useState('');

  const isAdmin = currentUser?.role === 'admin';

  async function loadData() {
    setLoading(true);
    setError('');
    try {
      const [deptRes, desigRes, treeRes] = await Promise.all([
        fetch('/api/departments'),
        fetch('/api/designations'),
        fetch('/api/employees/reporting-tree'),
      ]);

      const deptData = await deptRes.json();
      const desigData = await desigRes.json();
      const treeData = await treeRes.json();

      if (deptData?.departments) setDepartments(deptData.departments);
      if (desigData?.designations) setDesignations(desigData.designations);
      if (treeData?.tree) setReportingTree(treeData.tree);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  // Department handlers
  function openCreateDept() {
    setEditingDept(null);
    setDeptName('');
    setDeptCode('');
    setDeptDesc('');
    setDeptError('');
    setShowDeptModal(true);
  }

  function openEditDept(dept) {
    setEditingDept(dept);
    setDeptName(dept.name || '');
    setDeptCode(dept.code || '');
    setDeptDesc(dept.description || '');
    setDeptError('');
    setShowDeptModal(true);
  }

  async function handleSaveDept(e) {
    e.preventDefault();
    if (!deptName.trim() || !deptCode.trim()) {
      setDeptError('Name and Code are required.');
      return;
    }

    setSavingDept(true);
    setDeptError('');

    try {
      const url = editingDept ? `/api/departments/${editingDept.id}` : '/api/departments';
      const method = editingDept ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: deptName.trim(),
          code: deptCode.trim().toUpperCase(),
          description: deptDesc.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save department');

      setShowDeptModal(false);
      await loadData();
    } catch (err) {
      setDeptError(err.message);
    } finally {
      setSavingDept(false);
    }
  }

  async function handleDeleteDept(deptId) {
    if (!confirm('Are you sure you want to delete this department?')) return;
    try {
      const res = await fetch(`/api/departments/${deptId}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete department');
      await loadData();
    } catch (err) {
      alert(err.message);
    }
  }

  // Designation handlers
  function openCreateDesig() {
    setEditingDesig(null);
    setDesigTitle('');
    setDesigCode('');
    setDesigDeptId(departments[0]?.id ? String(departments[0].id) : '');
    setDesigLevel(1);
    setDesigDesc('');
    setDesigError('');
    setShowDesigModal(true);
  }

  function openEditDesig(desig) {
    setEditingDesig(desig);
    setDesigTitle(desig.title || '');
    setDesigCode(desig.code || '');
    setDesigDeptId(desig.department_id ? String(desig.department_id) : '');
    setDesigLevel(desig.level || 1);
    setDesigDesc(desig.description || '');
    setDesigError('');
    setShowDesigModal(true);
  }

  async function handleSaveDesig(e) {
    e.preventDefault();
    if (!desigTitle.trim() || !desigCode.trim()) {
      setDesigError('Title and Code are required.');
      return;
    }

    setSavingDesig(true);
    setDesigError('');

    try {
      const url = editingDesig ? `/api/designations/${editingDesig.id}` : '/api/designations';
      const method = editingDesig ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: desigTitle.trim(),
          code: desigCode.trim().toUpperCase(),
          department_id: desigDeptId ? Number(desigDeptId) : null,
          level: Number(desigLevel || 1),
          description: desigDesc.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save designation');

      setShowDesigModal(false);
      await loadData();
    } catch (err) {
      setDesigError(err.message);
    } finally {
      setSavingDesig(false);
    }
  }

  async function handleDeleteDesig(desigId) {
    if (!confirm('Are you sure you want to delete this designation?')) return;
    try {
      const res = await fetch(`/api/designations/${desigId}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete designation');
      await loadData();
    } catch (err) {
      alert(err.message);
    }
  }

  // Recursive Tree Node Renderer
  function renderTreeNode(node, depth = 0) {
    return (
      <div
        key={node.id}
        style={{
          marginLeft: depth * 24,
          marginTop: 8,
          borderLeft: depth > 0 ? '2px dashed var(--border)' : 'none',
          paddingLeft: depth > 0 ? 12 : 0,
        }}
      >
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 14px',
            background: depth === 0 ? 'rgba(59, 130, 246, 0.08)' : 'var(--bg-surface)',
            border: depth === 0 ? '1px solid #3b82f6' : '1px solid var(--border)',
            borderRadius: 6,
          }}
        >
          <Avatar name={node.name} size={28} assigned />
          <div>
            <div style={{ fontWeight: 600, fontSize: 13 }}>
              {node.name}
              {depth === 0 && <span style={{ marginLeft: 6, fontSize: 10, background: '#3b82f6', color: '#fff', padding: '1px 5px', borderRadius: 3 }}>LEADER</span>}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>
              {node.designation_title || 'Developer'} {node.department_name ? `· ${node.department_name}` : ''}
              {node.reportees?.length > 0 && ` (${node.reportees.length} direct reports)`}
            </div>
          </div>
        </div>

        {node.reportees?.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {node.reportees.map((child) => renderTreeNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Organization Structure & Roles</h2>
          <p style={{ fontSize: 13, color: 'var(--text-subtle)', margin: '4px 0 0 0' }}>
            Manage company departments, job designations, and organizational reporting hierarchy
          </p>
        </div>
        {isAdmin && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn-secondary" onClick={openCreateDesig}>
              + Add Designation
            </button>
            <button type="button" className="btn-primary" onClick={openCreateDept}>
              + Add Department
            </button>
          </div>
        )}
      </div>

      {/* Sub Tabs */}
      <div style={{ display: 'flex', gap: 8, borderBottom: '1px solid var(--border)', paddingBottom: 6 }}>
        <button
          type="button"
          className={`tab-button${activeSubTab === 'departments' ? ' active' : ''}`}
          onClick={() => setActiveSubTab('departments')}
          style={{
            padding: '6px 14px',
            fontSize: 13,
            fontWeight: 500,
            background: activeSubTab === 'departments' ? 'var(--bg-hover)' : 'transparent',
            border: 'none',
            borderRadius: 'var(--radius)',
            cursor: 'pointer',
            color: activeSubTab === 'departments' ? 'var(--primary)' : 'var(--text-subtle)',
          }}
        >
          Departments ({departments.length})
        </button>
        <button
          type="button"
          className={`tab-button${activeSubTab === 'designations' ? ' active' : ''}`}
          onClick={() => setActiveSubTab('designations')}
          style={{
            padding: '6px 14px',
            fontSize: 13,
            fontWeight: 500,
            background: activeSubTab === 'designations' ? 'var(--bg-hover)' : 'transparent',
            border: 'none',
            borderRadius: 'var(--radius)',
            cursor: 'pointer',
            color: activeSubTab === 'designations' ? 'var(--primary)' : 'var(--text-subtle)',
          }}
        >
          Designations ({designations.length})
        </button>
        <button
          type="button"
          className={`tab-button${activeSubTab === 'hierarchy' ? ' active' : ''}`}
          onClick={() => setActiveSubTab('hierarchy')}
          style={{
            padding: '6px 14px',
            fontSize: 13,
            fontWeight: 500,
            background: activeSubTab === 'hierarchy' ? 'var(--bg-hover)' : 'transparent',
            border: 'none',
            borderRadius: 'var(--radius)',
            cursor: 'pointer',
            color: activeSubTab === 'hierarchy' ? 'var(--primary)' : 'var(--text-subtle)',
          }}
        >
          Reporting Hierarchy
        </button>
      </div>

      {/* SUBTAB 1: DEPARTMENTS TABLE */}
      {activeSubTab === 'departments' && (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Department Name</th>
                <th>Description</th>
                <th>Headcount</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {departments.length === 0 ? (
                <tr>
                  <td colSpan="5" style={{ textAlign: 'center', padding: 32, color: 'var(--text-subtle)' }}>
                    No departments created yet. Click "+ Add Department" to create one.
                  </td>
                </tr>
              ) : (
                departments.map((dept) => (
                  <tr key={dept.id}>
                    <td>
                      <span style={{ fontWeight: 600, fontFamily: 'monospace', fontSize: 13 }}>
                        {dept.code}
                      </span>
                    </td>
                    <td>
                      <strong>{dept.name}</strong>
                    </td>
                    <td>
                      <span style={{ color: dept.description ? 'inherit' : 'var(--text-subtle)', fontSize: 13 }}>
                        {dept.description || '—'}
                      </span>
                    </td>
                    <td>
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          padding: '2px 8px',
                          borderRadius: 999,
                          background: 'rgba(59, 130, 246, 0.1)',
                          color: '#2563eb',
                        }}
                      >
                        {dept.employee_count || 0} Employees
                      </span>
                    </td>
                    <td>
                      {isAdmin && (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            type="button"
                            className="btn-ghost"
                            onClick={() => openEditDept(dept)}
                            style={{ fontSize: 11, padding: '3px 8px' }}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteDept(dept.id)}
                            style={{ background: 'transparent', border: 'none', color: 'var(--text-subtle)', cursor: 'pointer', fontSize: 14 }}
                            title="Delete department"
                          >
                            ×
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* SUBTAB 2: DESIGNATIONS TABLE */}
      {activeSubTab === 'designations' && (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Job Title / Role</th>
                <th>Department</th>
                <th>Hierarchy Level</th>
                <th>Headcount</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {designations.length === 0 ? (
                <tr>
                  <td colSpan="6" style={{ textAlign: 'center', padding: 32, color: 'var(--text-subtle)' }}>
                    No designations created yet. Click "+ Add Designation" to create one.
                  </td>
                </tr>
              ) : (
                designations.map((desig) => (
                  <tr key={desig.id}>
                    <td>
                      <span style={{ fontWeight: 600, fontFamily: 'monospace', fontSize: 13 }}>
                        {desig.code}
                      </span>
                    </td>
                    <td>
                      <strong>{desig.title}</strong>
                    </td>
                    <td>
                      <span style={{ fontSize: 13 }}>{desig.department_name || 'General'}</span>
                    </td>
                    <td>
                      <span style={{ fontSize: 12, color: 'var(--text-subtle)' }}>Level {desig.level || 1}</span>
                    </td>
                    <td>
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          padding: '2px 8px',
                          borderRadius: 999,
                          background: 'rgba(59, 130, 246, 0.1)',
                          color: '#2563eb',
                        }}
                      >
                        {desig.employee_count || 0} Employees
                      </span>
                    </td>
                    <td>
                      {isAdmin && (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            type="button"
                            className="btn-ghost"
                            onClick={() => openEditDesig(desig)}
                            style={{ fontSize: 11, padding: '3px 8px' }}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteDesig(desig.id)}
                            style={{ background: 'transparent', border: 'none', color: 'var(--text-subtle)', cursor: 'pointer', fontSize: 14 }}
                            title="Delete designation"
                          >
                            ×
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* SUBTAB 3: REPORTING TREE */}
      {activeSubTab === 'hierarchy' && (
        <div style={{ padding: 18, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
          <div style={{ marginBottom: 16 }}>
            <h3 style={{ margin: 0, fontSize: 14 }}>Global Organizational Reporting Hierarchy</h3>
            <span style={{ fontSize: 12, color: 'var(--text-subtle)' }}>
              Hierarchical view of company employees and management reportee chains
            </span>
          </div>

          {!reportingTree || reportingTree.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-subtle)', fontSize: 13 }}>
              No reporting hierarchy relationships configured. Assign reporting managers to employees in the Directory to populate this view.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {reportingTree.map((rootNode) => renderTreeNode(rootNode))}
            </div>
          )}
        </div>
      )}

      {/* Department Modal */}
      {showDeptModal && (
        <div className="modal-overlay" onMouseDown={() => setShowDeptModal(false)}>
          <div
            className="modal"
            style={{ maxWidth: 460 }}
            role="dialog"
            aria-modal="true"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <header>
              <h3>{editingDept ? 'Edit Department' : 'Create Department'}</h3>
              <button type="button" className="modal-close" onClick={() => setShowDeptModal(false)}>×</button>
            </header>

            <form onSubmit={handleSaveDept} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {deptError && (
                <div style={{ padding: 10, background: 'rgba(239, 68, 68, 0.1)', color: 'var(--danger)', borderRadius: 6, fontSize: 13 }}>
                  {deptError}
                </div>
              )}

              <div className="form-group">
                <label>Department Name *</label>
                <input
                  type="text"
                  value={deptName}
                  onChange={(e) => setDeptName(e.target.value)}
                  placeholder="e.g. Engineering, Sales, Marketing"
                  required
                />
              </div>

              <div className="form-group">
                <label>Department Code *</label>
                <input
                  type="text"
                  value={deptCode}
                  onChange={(e) => setDeptCode(e.target.value.toUpperCase())}
                  placeholder="e.g. ENG, SLS, MKT"
                  required
                />
              </div>

              <div className="form-group">
                <label>Description</label>
                <textarea
                  rows="2"
                  value={deptDesc}
                  onChange={(e) => setDeptDesc(e.target.value)}
                  placeholder="Responsibilities and scope of this department"
                />
              </div>

              <div className="modal-actions" style={{ marginTop: 14 }}>
                <button type="button" className="btn-secondary" onClick={() => setShowDeptModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={savingDept}>
                  {savingDept ? 'Saving…' : editingDept ? 'Save Changes' : 'Create Department'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Designation Modal */}
      {showDesigModal && (
        <div className="modal-overlay" onMouseDown={() => setShowDesigModal(false)}>
          <div
            className="modal"
            style={{ maxWidth: 460 }}
            role="dialog"
            aria-modal="true"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <header>
              <h3>{editingDesig ? 'Edit Designation' : 'Create Designation'}</h3>
              <button type="button" className="modal-close" onClick={() => setShowDesigModal(false)}>×</button>
            </header>

            <form onSubmit={handleSaveDesig} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {desigError && (
                <div style={{ padding: 10, background: 'rgba(239, 68, 68, 0.1)', color: 'var(--danger)', borderRadius: 6, fontSize: 13 }}>
                  {desigError}
                </div>
              )}

              <div className="form-group">
                <label>Designation / Job Title *</label>
                <input
                  type="text"
                  value={desigTitle}
                  onChange={(e) => setDesigTitle(e.target.value)}
                  placeholder="e.g. Senior Full Stack Engineer"
                  required
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label>Code *</label>
                  <input
                    type="text"
                    value={desigCode}
                    onChange={(e) => setDesigCode(e.target.value.toUpperCase())}
                    placeholder="e.g. SR_ENG"
                    required
                  />
                </div>

                <div className="form-group">
                  <label>Level (1-10)</label>
                  <input
                    type="number"
                    min="1"
                    max="10"
                    value={desigLevel}
                    onChange={(e) => setDesigLevel(e.target.value)}
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Department</label>
                <select value={desigDeptId} onChange={(e) => setDesigDeptId(e.target.value)}>
                  <option value="">-- General / No Department --</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>{d.name} ({d.code})</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Description</label>
                <textarea
                  rows="2"
                  value={desigDesc}
                  onChange={(e) => setDesigDesc(e.target.value)}
                  placeholder="Key responsibilities and qualifications"
                />
              </div>

              <div className="modal-actions" style={{ marginTop: 14 }}>
                <button type="button" className="btn-secondary" onClick={() => setShowDesigModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={savingDesig}>
                  {savingDesig ? 'Saving…' : editingDesig ? 'Save Changes' : 'Create Designation'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}


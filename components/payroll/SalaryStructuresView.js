'use client';

import { useState, useEffect } from 'react';

export default function SalaryStructuresView({ workspaceId = 1 }) {
  const [components, setComponents] = useState([]);
  const [structures, setStructures] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showComponentModal, setShowComponentModal] = useState(false);
  const [showStructureModal, setShowStructureModal] = useState(false);

  // New component form state
  const [compName, setCompName] = useState('');
  const [compCode, setCompCode] = useState('');
  const [compType, setCompType] = useState('earning');
  const [calcType, setCalcType] = useState('fixed');
  const [isTaxable, setIsTaxable] = useState(true);
  const [isStatutory, setIsStatutory] = useState(false);
  const [submittingComp, setSubmittingComp] = useState(false);

  // New structure form state
  const [structName, setStructName] = useState('');
  const [structDesc, setStructDesc] = useState('');
  const [selectedComponents, setSelectedComponents] = useState([]);
  const [submittingStruct, setSubmittingStruct] = useState(false);

  useEffect(() => {
    loadData();
  }, [workspaceId]);

  async function loadData() {
    setLoading(true);
    try {
      const [compRes, structRes] = await Promise.all([
        fetch(`/api/payroll/components?workspaceId=${workspaceId}`),
        fetch(`/api/payroll/structures?workspaceId=${workspaceId}`),
      ]);
      const compData = await compRes.json();
      const structData = await structRes.json();
      setComponents(compData.components || []);
      setStructures(structData.structures || []);
    } catch (err) {
      console.error('Error loading structure data:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateComponent(e) {
    e.preventDefault();
    setSubmittingComp(true);
    try {
      const res = await fetch('/api/payroll/components', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspaceId,
          name: compName,
          code: compCode,
          type: compType,
          calculation_type: calcType,
          is_taxable: isTaxable,
          is_statutory: isStatutory,
        }),
      });
      if (res.ok) {
        setShowComponentModal(false);
        setCompName('');
        setCompCode('');
        await loadData();
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to create component');
      }
    } catch (err) {
      alert(err.message);
    } finally {
      setSubmittingComp(false);
    }
  }

  async function handleCreateStructure(e) {
    e.preventDefault();
    setSubmittingStruct(true);
    try {
      const res = await fetch('/api/payroll/structures', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspaceId,
          name: structName,
          description: structDesc,
          components: selectedComponents,
        }),
      });
      if (res.ok) {
        setShowStructureModal(false);
        setStructName('');
        setStructDesc('');
        setSelectedComponents([]);
        await loadData();
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to create structure');
      }
    } catch (err) {
      alert(err.message);
    } finally {
      setSubmittingStruct(false);
    }
  }

  function toggleComponentSelection(comp) {
    const exists = selectedComponents.find((c) => c.component_id === comp.id);
    if (exists) {
      setSelectedComponents(selectedComponents.filter((c) => c.component_id !== comp.id));
    } else {
      setSelectedComponents([
        ...selectedComponents,
        {
          component_id: comp.id,
          name: comp.name,
          type: comp.type,
          calculation_type: comp.calculation_type,
          percentage_rate: comp.calculation_type === 'percentage_of_basic' ? 20.0 : 0,
          amount_cents: comp.calculation_type === 'fixed' ? 200000 : 0,
        },
      ]);
    }
  }

  function updateComponentVal(compIndex, field, val) {
    const updated = [...selectedComponents];
    updated[compIndex][field] = val;
    setSelectedComponents(updated);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* 1. Components Catalog Card */}
      <div
        style={{
          background: '#ffffff',
          border: '1px solid #dfe1e6',
          borderRadius: '8px',
          boxShadow: '0 1px 3px rgba(9, 30, 66, 0.08)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid #ebecf0',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: '#fafbfc',
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#172b4d' }}>
              Salary Components Catalog
            </h3>
            <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#626f86' }}>
              Taxable allowances, earnings, statutory deductions (PF, ESI, TDS) and fixed benefits.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowComponentModal(true)}
            style={{
              padding: '6px 14px',
              background: '#0c66e4',
              color: '#ffffff',
              border: 'none',
              borderRadius: '4px',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            + Add Component
          </button>
        </div>

        {loading ? (
          <div style={{ padding: '36px', textAlign: 'center', color: '#626f86', fontSize: '13px' }}>
            Loading salary components...
          </div>
        ) : components.length === 0 ? (
          <div style={{ padding: '40px 20px', textAlign: 'center', color: '#626f86', fontSize: '13px' }}>
            No components added yet. Click "+ Add Component" to add allowances like HRA, Medical, or deductions like PF.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
              <thead>
                <tr style={{ background: '#f4f5f7', color: '#626f86', borderBottom: '1px solid #dfe1e6' }}>
                  <th style={{ padding: '10px 18px', fontWeight: 600, textTransform: 'uppercase', fontSize: '11px' }}>Code</th>
                  <th style={{ padding: '10px 18px', fontWeight: 600, textTransform: 'uppercase', fontSize: '11px' }}>Component Name</th>
                  <th style={{ padding: '10px 18px', fontWeight: 600, textTransform: 'uppercase', fontSize: '11px' }}>Category</th>
                  <th style={{ padding: '10px 18px', fontWeight: 600, textTransform: 'uppercase', fontSize: '11px' }}>Calculation Model</th>
                  <th style={{ padding: '10px 18px', fontWeight: 600, textTransform: 'uppercase', fontSize: '11px' }}>Tax / Statutory Flags</th>
                  <th style={{ padding: '10px 18px', fontWeight: 600, textTransform: 'uppercase', fontSize: '11px' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {components.map((comp) => (
                  <tr key={comp.id} style={{ borderBottom: '1px solid #ebecf0' }}>
                    <td style={{ padding: '12px 18px', fontFamily: 'monospace', fontWeight: 700, color: '#0c66e4' }}>
                      {comp.code}
                    </td>
                    <td style={{ padding: '12px 18px', fontWeight: 600, color: '#172b4d' }}>{comp.name}</td>
                    <td style={{ padding: '12px 18px' }}>
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '2px 8px',
                          borderRadius: '10px',
                          fontSize: '11px',
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          background: comp.type === 'earning' ? '#e3fcef' : '#ffebe6',
                          color: comp.type === 'earning' ? '#006644' : '#bf2600',
                        }}
                      >
                        {comp.type}
                      </span>
                    </td>
                    <td style={{ padding: '12px 18px', color: '#42526e' }}>
                      {comp.calculation_type === 'percentage_of_basic' ? 'Percentage of Basic Pay' : 'Fixed Monthly Amount'}
                    </td>
                    <td style={{ padding: '12px 18px' }}>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        {comp.is_taxable ? (
                          <span style={{ fontSize: '11px', background: '#f4f5f7', color: '#42526e', padding: '1px 6px', borderRadius: '4px', border: '1px solid #dfe1e6' }}>
                            Taxable
                          </span>
                        ) : null}
                        {comp.is_statutory ? (
                          <span style={{ fontSize: '11px', background: '#fff0b3', color: '#172b4d', padding: '1px 6px', borderRadius: '4px', fontWeight: 600 }}>
                            Statutory
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td style={{ padding: '12px 18px', color: '#36b37e', fontWeight: 600, fontSize: '12px' }}>
                      Active
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 2. Structures Templates Card */}
      <div
        style={{
          background: '#ffffff',
          border: '1px solid #dfe1e6',
          borderRadius: '8px',
          boxShadow: '0 1px 3px rgba(9, 30, 66, 0.08)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid #ebecf0',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: '#fafbfc',
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#172b4d' }}>
              Salary Structure Templates
            </h3>
            <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#626f86' }}>
              Define compensation packages assigned across departments and roles.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowStructureModal(true)}
            style={{
              padding: '6px 14px',
              background: '#0c66e4',
              color: '#ffffff',
              border: 'none',
              borderRadius: '4px',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            + Create Template
          </button>
        </div>

        <div style={{ padding: '20px' }}>
          {structures.length === 0 ? (
            <div style={{ padding: '32px', textAlign: 'center', color: '#626f86', fontSize: '13px' }}>
              No templates created yet. Click "+ Create Template" to define role packages.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px' }}>
              {structures.map((s) => (
                <div
                  key={s.id}
                  style={{
                    border: '1px solid #dfe1e6',
                    borderRadius: '8px',
                    padding: '16px 20px',
                    background: '#fafbfc',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                    <div>
                      <h4 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#172b4d' }}>{s.name}</h4>
                      <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#626f86' }}>
                        {s.description || 'Standard compensation package'}
                      </p>
                    </div>
                    <span
                      style={{
                        fontSize: '11px',
                        fontWeight: 700,
                        padding: '2px 8px',
                        borderRadius: '10px',
                        background: '#deebff',
                        color: '#0747a6',
                      }}
                    >
                      {s.components?.length || 0} Components
                    </span>
                  </div>

                  <div style={{ borderTop: '1px solid #ebecf0', paddingTop: '10px', marginTop: '12px' }}>
                    <div style={{ fontSize: '11px', fontWeight: 700, color: '#626f86', textTransform: 'uppercase', marginBottom: '6px' }}>
                      Assigned Component Rules:
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      {(s.components || []).map((c) => (
                        <div
                          key={c.id}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            fontSize: '12px',
                            padding: '4px 0',
                            borderBottom: '1px dashed #ebecf0',
                          }}
                        >
                          <span style={{ fontWeight: 500, color: '#172b4d' }}>
                            {c.name} <span style={{ color: '#626f86', fontSize: '11px' }}>({c.type})</span>
                          </span>
                          <span style={{ fontFamily: 'monospace', fontWeight: 600, color: '#0c66e4' }}>
                            {c.calculation_type === 'percentage_of_basic'
                              ? `${c.percentage_rate}% of basic`
                              : `₹${(c.amount_cents / 100).toLocaleString()}`}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Modal: Add Component */}
      {showComponentModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(9, 30, 66, 0.54)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
          }}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: '8px',
              maxWidth: '480px',
              width: '100%',
              boxShadow: '0 8px 30px rgba(9, 30, 66, 0.25)',
              overflow: 'hidden',
            }}
          >
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #ebecf0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#172b4d' }}>Add Salary Component</h3>
              <button
                type="button"
                onClick={() => setShowComponentModal(false)}
                style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: '#626f86' }}
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleCreateComponent} style={{ padding: '20px' }}>
              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#42526e', marginBottom: '4px' }}>
                  Component Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. House Rent Allowance"
                  value={compName}
                  onChange={(e) => setCompName(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid #dfe1e6', borderRadius: '4px', fontSize: '13px', boxSizing: 'border-box' }}
                />
              </div>

              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#42526e', marginBottom: '4px' }}>
                  Component Code * (Short uppercase identifier)
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. HRA"
                  value={compCode}
                  onChange={(e) => setCompCode(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid #dfe1e6', borderRadius: '4px', fontSize: '13px', fontFamily: 'monospace', textTransform: 'uppercase', boxSizing: 'border-box' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '14px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#42526e', marginBottom: '4px' }}>Type</label>
                  <select
                    value={compType}
                    onChange={(e) => setCompType(e.target.value)}
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid #dfe1e6', borderRadius: '4px', fontSize: '13px', boxSizing: 'border-box' }}
                  >
                    <option value="earning">Earning</option>
                    <option value="deduction">Deduction</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#42526e', marginBottom: '4px' }}>Calculation Model</label>
                  <select
                    value={calcType}
                    onChange={(e) => setCalcType(e.target.value)}
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid #dfe1e6', borderRadius: '4px', fontSize: '13px', boxSizing: 'border-box' }}
                  >
                    <option value="percentage_of_basic">Percentage of Basic Pay</option>
                    <option value="fixed">Fixed Monthly Amount</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '16px', marginBottom: '20px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#42526e', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={isTaxable}
                    onChange={(e) => setIsTaxable(e.target.checked)}
                  />
                  Subject to Income Tax
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#42526e', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={isStatutory}
                    onChange={(e) => setIsStatutory(e.target.checked)}
                  />
                  Statutory Requirement
                </label>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button
                  type="button"
                  onClick={() => setShowComponentModal(false)}
                  style={{ padding: '8px 16px', background: '#f4f5f7', border: '1px solid #dfe1e6', borderRadius: '4px', fontSize: '13px', fontWeight: 600, color: '#42526e', cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingComp}
                  style={{ padding: '8px 18px', background: '#0c66e4', color: '#ffffff', border: 'none', borderRadius: '4px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', opacity: submittingComp ? 0.6 : 1 }}
                >
                  {submittingComp ? 'Saving...' : 'Save Component'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Create Structure Template */}
      {showStructureModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(9, 30, 66, 0.54)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
          }}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: '8px',
              maxWidth: '560px',
              width: '100%',
              boxShadow: '0 8px 30px rgba(9, 30, 66, 0.25)',
              maxHeight: '90vh',
              overflowY: 'auto',
            }}
          >
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #ebecf0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#172b4d' }}>Create Salary Structure Template</h3>
              <button
                type="button"
                onClick={() => setShowStructureModal(false)}
                style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: '#626f86' }}
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleCreateStructure} style={{ padding: '20px' }}>
              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#42526e', marginBottom: '4px' }}>Template Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Standard Engineering Package"
                  value={structName}
                  onChange={(e) => setStructName(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid #dfe1e6', borderRadius: '4px', fontSize: '13px', boxSizing: 'border-box' }}
                />
              </div>

              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#42526e', marginBottom: '4px' }}>Description</label>
                <input
                  type="text"
                  placeholder="Brief notes on eligibility"
                  value={structDesc}
                  onChange={(e) => setStructDesc(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid #dfe1e6', borderRadius: '4px', fontSize: '13px', boxSizing: 'border-box' }}
                />
              </div>

              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#172b4d', marginBottom: '8px' }}>
                  Select Components to Include:
                </label>
                <div style={{ border: '1px solid #dfe1e6', borderRadius: '6px', maxHeight: '180px', overflowY: 'auto', padding: '6px' }}>
                  {components.map((comp) => {
                    const isSelected = selectedComponents.some((c) => c.component_id === comp.id);
                    return (
                      <label
                        key={comp.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '6px 10px',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          background: isSelected ? '#deebff' : 'transparent',
                          marginBottom: '2px',
                        }}
                      >
                        <span style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleComponentSelection(comp)}
                          />
                          <span style={{ fontWeight: 600, color: '#172b4d' }}>{comp.name}</span>
                          <span style={{ fontFamily: 'monospace', color: '#626f86' }}>({comp.code})</span>
                        </span>
                        <span style={{ fontSize: '11px', textTransform: 'uppercase', color: comp.type === 'earning' ? '#006644' : '#bf2600', fontWeight: 600 }}>
                          {comp.type}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {selectedComponents.length > 0 && (
                <div style={{ marginBottom: '20px' }}>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#172b4d', marginBottom: '8px' }}>
                    Configure Component Rates:
                  </label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {selectedComponents.map((c, idx) => (
                      <div
                        key={c.component_id}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '6px 10px',
                          background: '#f4f5f7',
                          borderRadius: '4px',
                          fontSize: '12px',
                        }}
                      >
                        <span style={{ fontWeight: 600, color: '#172b4d' }}>{c.name}</span>
                        {c.calculation_type === 'percentage_of_basic' ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <input
                              type="number"
                              min="0"
                              max="100"
                              step="0.5"
                              value={c.percentage_rate}
                              onChange={(e) => updateComponentVal(idx, 'percentage_rate', parseFloat(e.target.value))}
                              style={{ width: '64px', padding: '4px 6px', border: '1px solid #dfe1e6', borderRadius: '4px', textAlign: 'right', fontSize: '12px' }}
                            />
                            <span style={{ color: '#42526e' }}>% of basic</span>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ color: '#42526e' }}>₹</span>
                            <input
                              type="number"
                              min="0"
                              value={c.amount_cents / 100}
                              onChange={(e) => updateComponentVal(idx, 'amount_cents', Math.round(parseFloat(e.target.value || 0) * 100))}
                              style={{ width: '80px', padding: '4px 6px', border: '1px solid #dfe1e6', borderRadius: '4px', textAlign: 'right', fontSize: '12px' }}
                            />
                            <span style={{ color: '#42526e' }}>fixed</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button
                  type="button"
                  onClick={() => setShowStructureModal(false)}
                  style={{ padding: '8px 16px', background: '#f4f5f7', border: '1px solid #dfe1e6', borderRadius: '4px', fontSize: '13px', fontWeight: 600, color: '#42526e', cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingStruct}
                  style={{ padding: '8px 18px', background: '#0c66e4', color: '#ffffff', border: 'none', borderRadius: '4px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', opacity: submittingStruct ? 0.6 : 1 }}
                >
                  {submittingStruct ? 'Saving...' : 'Save Structure Template'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

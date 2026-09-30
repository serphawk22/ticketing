'use client';

import { useEffect, useState } from 'react';

import { RULE_FIELDS, RULE_EFFECTS, describeRule, newRule, ruleValueOptions } from './viewPrefs';

/**
 * Format rules edit the conditional styling applied to list rows. Rules are
 * kept as plain data and applied by the list on every render, so a change here
 * is visible on the table as soon as it is saved.
 */
export default function FormatRulesModal({ rules, onSave, onClose }) {
  const [draft, setDraft] = useState(rules);
  const [error, setError] = useState('');

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function update(id, patch) {
    setDraft((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function add() {
    setDraft((prev) => [...prev, newRule()]);
  }

  function remove(id) {
    setDraft((prev) => prev.filter((r) => r.id !== id));
  }

  function move(id, delta) {
    setDraft((prev) => {
      const i = prev.findIndex((r) => r.id === id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  function save() {
    const cleaned = draft
      .map((r) => ({ ...r, value: String(r.value ?? '').trim() }))
      .filter((r) => r.value !== '' || r.field === 'overdue');
    if (cleaned.length !== draft.length) {
      setError('Every rule needs a value to match.');
      return;
    }
    onSave(cleaned);
  }

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Format rules"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header>
          <h3>Format rules</h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <p className="modal-note">
          Rules are checked from the top down, so a later rule wins when two of them match the same
          work item.
        </p>

        {error && <p className="form-error">{error}</p>}

        <div className="rules-list">
          {draft.length === 0 && (
            <p className="rules-empty">No rules yet. Rows render with their normal styling.</p>
          )}

          {draft.map((rule, index) => {
            const options = ruleValueOptions(rule.field);
            return (
              <div key={rule.id} className="rule-row">
                <span className="rule-summary">{describeRule(rule)}</span>

                <div className="rule-controls">
                  <label className="sr-only" htmlFor={`rule-field-${rule.id}`}>
                    Field for rule {index + 1}
                  </label>
                  <select
                    id={`rule-field-${rule.id}`}
                    value={rule.field}
                    onChange={(e) => {
                      const field = e.target.value;
                      // Switching field can leave a value that is not a legal
                      // choice for the new field, so reset to its first option.
                      const nextOptions = ruleValueOptions(field);
                      update(rule.id, {
                        field,
                        value: nextOptions.length ? nextOptions[0].value : '',
                      });
                    }}
                  >
                    {Object.entries(RULE_FIELDS).map(([key, meta]) => (
                      <option key={key} value={key}>
                        {meta.label}
                      </option>
                    ))}
                  </select>

                  {options.length > 0 ? (
                    <>
                      <span className="rule-equals">is</span>
                      <label className="sr-only" htmlFor={`rule-value-${rule.id}`}>
                        Value for rule {index + 1}
                      </label>
                      <select
                        id={`rule-value-${rule.id}`}
                        value={rule.value}
                        onChange={(e) => update(rule.id, { value: e.target.value })}
                      >
                        {options.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </>
                  ) : (
                    <>
                      <span className="rule-equals">
                        {rule.field === 'label' ? 'is' : 'is id'}
                      </span>
                      <label className="sr-only" htmlFor={`rule-value-${rule.id}`}>
                        Value for rule {index + 1}
                      </label>
                      <input
                        id={`rule-value-${rule.id}`}
                        value={rule.value}
                        onChange={(e) => update(rule.id, { value: e.target.value })}
                        placeholder={
                          rule.field === 'label' ? 'e.g. backend' : 'employee id, or unassigned'
                        }
                      />
                    </>
                  )}

                  <span className="rule-equals">then</span>
                  <label className="sr-only" htmlFor={`rule-effect-${rule.id}`}>
                    Effect for rule {index + 1}
                  </label>
                  <select
                    id={`rule-effect-${rule.id}`}
                    value={rule.effect}
                    onChange={(e) => update(rule.id, { effect: e.target.value })}
                  >
                    {Object.entries(RULE_EFFECTS).map(([key, meta]) => (
                      <option key={key} value={key}>
                        {meta.label}
                      </option>
                    ))}
                  </select>

                  <div className="rule-actions">
                    <button
                      type="button"
                      className="rule-move"
                      onClick={() => move(rule.id, -1)}
                      disabled={index === 0}
                      aria-label={`Move rule ${index + 1} up`}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="rule-move"
                      onClick={() => move(rule.id, 1)}
                      disabled={index === draft.length - 1}
                      aria-label={`Move rule ${index + 1} down`}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="rule-remove"
                      onClick={() => remove(rule.id)}
                      aria-label={`Delete rule ${index + 1}`}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="modal-actions modal-actions-padded">
          <button type="button" className="btn-ghost" onClick={add}>
            Add rule
          </button>
          <div className="modal-actions-right">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn-primary" onClick={save}>
              Save rules
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

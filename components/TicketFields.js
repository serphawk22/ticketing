'use client';

import Avatar from './Avatar';
import InlineDropdownField from './InlineDropdownField';
import { CATEGORY_ORDER, LOZENGE_TINTS, PRIORITY_META, PRIORITY_ORDER, PriorityIcon, STATUS_META, STATUS_ORDER } from './meta';

/**
 * The editable fields of a work item, each one a thin wrapper that says what
 * its options look like. All of them are InlineDropdownField underneath, so the
 * list table and the detail sidebar get identical behaviour from the same code:
 * click to edit, type to filter, Enter or click to commit, Escape to cancel.
 *
 * A field that resolves is not here on purpose. Resolution is computed from the
 * status rather than stored, so offering a dropdown for it would let the two
 * disagree; it stays plain text and follows the status.
 */

const NONE = { value: '', label: 'None' };

export function PriorityField({ value, onSelect, readOnly = false, className = '' }) {
  const meta = PRIORITY_META[value] || PRIORITY_META.medium;

  return (
    <InlineDropdownField
      value={value}
      onSelect={onSelect}
      readOnly={readOnly}
      label="Priority"
      searchable={false}
      className={className}
      options={PRIORITY_ORDER.map((key) => {
        const m = PRIORITY_META[key];
        return {
          value: key,
          label: m.label,
          leading: <PriorityIcon color={m.color} arrow={m.arrow} />,
        };
      })}
      renderValue={() => (
        <span className="list-priority">
          <PriorityIcon color={meta.color} arrow={meta.arrow} />
          <span>{meta.label}</span>
        </span>
      )}
    />
  );
}

export function StatusField({
  value,
  onSelect,
  readOnly = false,
  className = '',
  variant = 'cell',
  showLabel = false,
}) {
  const meta = STATUS_META[value] || STATUS_META.open;
  const lozenge = LOZENGE_TINTS[value] || LOZENGE_TINTS.open;

  return (
    <InlineDropdownField
      value={value}
      onSelect={onSelect}
      readOnly={readOnly}
      label="Status"
      searchable={false}
      variant={variant}
      className={className}
      options={STATUS_ORDER.map((key) => {
        const m = STATUS_META[key];
        const tint = LOZENGE_TINTS[key] || LOZENGE_TINTS.open;
        return {
          value: key,
          label: m.label,
          // Each row carries its own lozenge, so the dropdown reads as a column
          // of the same pills the closed cell shows.
          leading: (
            <span
              className="list-lozenge"
              style={{ background: tint.bg, color: tint.text }}
            >
              {m.label}
            </span>
          ),
        };
      })}
      renderValue={() =>
        variant === 'button' ? (
          <>
            <span
              className="list-lozenge"
              style={{ background: lozenge.bg, color: lozenge.text }}
            >
              {meta.label}
            </span>
            {showLabel ? <span>{meta.label}</span> : null}
          </>
        ) : (
          <span
            className="list-lozenge"
            style={{ background: lozenge.bg, color: lozenge.text }}
          >
            {meta.label}
          </span>
        )
      }
    />
  );
}

export function CategoryField({ value, onSelect, readOnly = false, className = '' }) {
  const current = value || '';

  return (
    <InlineDropdownField
      value={current}
      onSelect={onSelect}
      readOnly={readOnly}
      label="Category"
      className={className}
      options={[NONE, ...CATEGORY_ORDER.map((c) => ({ value: c, label: c }))]}
      renderValue={() => (
        <span className={current ? 'idf-label' : 'idf-label is-empty'}>{current || 'None'}</span>
      )}
    />
  );
}

/**
 * Reporter, which is a person field like the assignee but keyed on the user id
 * rather than the employee id, so it is not UserPicker: that one resolves
 * against the employee directory and this resolves against people who can
 * raise work.
 */
export function ReporterField({
  value,
  people = [],
  onSelect,
  readOnly = false,
  className = '',
}) {
  const avatar = (name) => (
    <Avatar name={name} assigned={Boolean(name)} size={24} unassignedIcon showTitle={false} />
  );

  return (
    <InlineDropdownField
      value={value == null ? null : Number(value)}
      onSelect={onSelect}
      readOnly={readOnly}
      label="Reporter"
      className={className}
      options={people.map((p) => ({
        value: p.id,
        label: p.name,
        keywords: [p.email, p.role].filter(Boolean),
        leading: avatar(p.name),
      }))}
      renderValue={(option) => (
        <>
          {option ? option.leading : avatar(null)}
          <span className={`user-picker-name${option ? '' : ' is-empty'}`}>
            {option ? option.label : 'Unassigned'}
          </span>
        </>
      )}
    />
  );
}
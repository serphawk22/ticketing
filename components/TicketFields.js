'use client';

import Avatar from './Avatar';
import InlineDropdownField from './InlineDropdownField';
import { CATEGORY_ORDER, LOZENGE_TINTS, PRIORITY_META, PRIORITY_ORDER, PriorityIcon, RESOLUTION_ORDER, STATUS_META, STATUS_ORDER, TYPE_META, TYPE_ORDER, TypeIcon, INCLUSION_META, INCLUSION_ORDER } from './meta';

/**
 * The editable fields of a work item, each one a thin wrapper that says what
 * its options look like. All of them are InlineDropdownField underneath, so the
 * list table and the detail sidebar get identical behaviour from the same code:
 * click to edit, type to filter, Enter or click to commit, Escape to cancel.
 *
 * Resolution is stored like the category (free text, '' meaning "not resolved")
 * and offers the standard resolutions as options plus any custom value typed in,
 * so the two fields share the same editing rules.
 */

const NONE = { value: '', label: 'None' };

export function PriorityField({
  value,
  onSelect,
  readOnly = false,
  className = '',
  variant = 'cell',
  searchable = false,
}) {
  const meta = PRIORITY_META[value] || PRIORITY_META.medium;

  return (
    <InlineDropdownField
      value={value}
      onSelect={onSelect}
      readOnly={readOnly}
      label="Priority"
      searchable={searchable}
      variant={variant}
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

export function IssueTypeField({
  value,
  onSelect,
  readOnly = false,
  className = '',
  variant = 'cell',
  // The four issue types are a fixed list, so the field opens as a menu rather
  // than a search box. Callers that want filtering can opt in.
  searchable = false,
}) {
  const meta = TYPE_META[value] || TYPE_META.task;

  return (
    <InlineDropdownField
      value={value}
      onSelect={onSelect}
      readOnly={readOnly}
      label="Issue type"
      searchable={searchable}
      variant={variant}
      className={className}
      options={TYPE_ORDER.map((key) => ({
        value: key,
        label: TYPE_META[key].label,
        leading: <TypeIcon type={key} size={14} />,
      }))}
      renderValue={() => (
        <span className="idf-icon-value">
          <TypeIcon type={value} size={14} />
          <span className="idf-label">{meta.label}</span>
        </span>
      )}
    />
  );
}

/**
 * Assignee, keyed on the employee id. Options carry the person's email as
 * muted trailing text so two people with the same display name are still
 * tellable apart, and so the field can be searched by either.
 */
export function AssigneeField({
  value,
  employees = [],
  onSelect,
  readOnly = false,
  className = '',
  variant = 'cell',
}) {
  const avatar = (name) => (
    <Avatar name={name} assigned={Boolean(name)} size={24} unassignedIcon showTitle={false} />
  );

  const assignableEmployees = Array.isArray(employees)
    ? employees.filter((e) => e && e.active !== false && e.active !== 0)
    : [];

  // "Unassigned" leads the list so a ticket can be handed back to the triage
  // pool, the same option the quick-add select used to offer.
  const options = [
    { value: null, label: 'Unassigned', leading: avatar(null) },
    ...assignableEmployees.map((e) => ({
      value: String(e.id),
      label: e.name,
      keywords: [e.email, e.title, e.role].filter(Boolean),
      secondary: e.email,
      leading: avatar(e.name),
    })),
  ];

  return (
    <InlineDropdownField
      value={value == null || value === '' ? null : String(value)}
      onSelect={onSelect}
      readOnly={readOnly}
      label="Assignee"
      variant={variant}
      className={`user-picker-trigger${className ? ` ${className}` : ''}`}
      options={options}
      renderValue={(option) => (
        <span className="idf-user-value">
          {option ? option.leading : avatar(null)}
          <span className={`user-picker-name${option ? '' : ' is-empty'}`}>
            {option ? option.label : 'Unassigned'}
          </span>
        </span>
      )}
    />
  );
}

/**
 * Team, a person field stored as the chosen name in the free-text `team`
 * column. The options come from the live employee directory, and allowCustom
 * keeps a value that is not one of those people (an imported team name, say)
 * intact and lets it be retyped.
 */
export function TeamField({
  value,
  employees = [],
  onSelect,
  readOnly = false,
  className = '',
  variant = 'cell',
}) {
  const options = employees.map((e) => ({
    value: e.name,
    label: e.name,
    keywords: [e.email, e.title, e.role].filter(Boolean),
    secondary: e.email,
  }));

  const current = String(value ?? '').trim();

  return (
    <InlineDropdownField
      value={current}
      onSelect={onSelect}
      readOnly={readOnly}
      label="Team"
      allowCustom
      variant={variant}
      className={className}
      options={options}
      emptyText="Add team"
      renderValue={() => (
        <span className={`idf-label${current ? '' : ' is-empty'}`}>
          {current || 'Add team'}
        </span>
      )}
    />
  );
}

/**
 * Project, keyed on the project id. The key is shown as muted trailing text so
 * the dropdown reads like the project switcher in the top nav.
 */
export function ProjectField({
  value,
  projects = [],
  onSelect,
  readOnly = false,
  className = '',
  variant = 'cell',
}) {
  // "No project" leads the list so a ticket can be filed outside any project,
  // matching the option the quick-add select used to offer.
  const options = [
    { value: '', label: 'No project' },
    ...projects.map((p) => ({
      value: String(p.id),
      label: p.name,
      keywords: [p.key].filter(Boolean),
      secondary: p.key,
    })),
  ];

  return (
    <InlineDropdownField
      value={value == null ? '' : String(value)}
      onSelect={onSelect}
      readOnly={readOnly}
      label="Project"
      variant={variant}
      className={className}
      options={options}
      renderValue={(option) => (
        <span className={`idf-label${!option || option.value === '' ? ' is-empty' : ''}`}>
          {option ? option.label : 'No project'}
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

export function CategoryField({
  value,
  onSelect,
  readOnly = false,
  className = '',
  variant = 'cell',
}) {
  const current = value || '';

  return (
    <InlineDropdownField
      value={current}
      onSelect={onSelect}
      readOnly={readOnly}
      label="Category"
      allowCustom
      variant={variant}
      className={className}
      options={[NONE, ...CATEGORY_ORDER.map((c) => ({ value: c, label: c }))]}
      renderValue={() => (
        <span className={current ? 'idf-label' : 'idf-label is-empty'}>{current || 'None'}</span>
      )}
    />
  );
}

export function ResolutionField({
  value,
  onSelect,
  readOnly = false,
  className = '',
  variant = 'cell',
}) {
  const current = value || '';

  return (
    <InlineDropdownField
      value={current}
      onSelect={onSelect}
      readOnly={readOnly}
      label="Resolution"
      allowCustom
      variant={variant}
      className={className}
      options={[NONE, ...RESOLUTION_ORDER.map((c) => ({ value: c, label: c }))]}
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

/**
 * Product inclusion field: tracks whether work was included in the main product.
 */
export function ProductInclusionField({
  value,
  onSelect,
  readOnly = false,
  className = '',
  variant = 'cell',
  showLabel = false,
}) {
  const currentKey = value || 'pending_review';
  const meta = INCLUSION_META[currentKey] || INCLUSION_META.pending_review;

  return (
    <InlineDropdownField
      value={currentKey}
      onSelect={onSelect}
      readOnly={readOnly}
      label="Product inclusion"
      searchable={false}
      variant={variant}
      className={className}
      options={INCLUSION_ORDER.map((key) => {
        const m = INCLUSION_META[key];
        return {
          value: key,
          label: m.label,
          leading: (
            <span
              className="list-lozenge"
              style={{ background: m.bg, color: m.text }}
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
              style={{ background: meta.bg, color: meta.text }}
            >
              {meta.label}
            </span>
            {showLabel ? <span>{meta.label}</span> : null}
          </>
        ) : (
          <span
            className="list-lozenge"
            style={{ background: meta.bg, color: meta.text }}
          >
            {meta.label}
          </span>
        )
      }
    />
  );
}
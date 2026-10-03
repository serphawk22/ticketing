'use client';

import { useMemo } from 'react';
import Avatar from './Avatar';
import InlineDropdownField from './InlineDropdownField';

const UNASSIGNED = { id: null, name: 'Unassigned' };

/**
 * Inline, click-to-edit person field. The behaviour lives in
 * InlineDropdownField; this only knows what a person option looks like.
 *
 * Every person field in the app renders this one component, so the trigger, the
 * dropdown and the keyboard handling cannot drift apart between the list cells
 * and the detail sidebar.
 *
 *   value            selected user id, or null when unassigned
 *   users            assignable people, already filtered by the caller
 *   onSelect         (id | null) => void — the caller's update mutation
 *   allowUnassigned  false for a field that always has a person on it
 *   readOnly         shows the value without the edit affordance, for a field
 *                    this app has no write path for
 */
export default function UserPicker({
  value = null,
  users = [],
  onSelect,
  allowUnassigned = true,
  readOnly = false,
  label = 'Assignee',
  className = '',
  size = 24,
}) {
  const avatar = (id, name) => (
    <Avatar
      name={id == null ? undefined : name}
      assigned={id != null}
      size={size}
      unassignedIcon
      showTitle={false}
    />
  );

  // "Unassigned" stays at the top while it still matches what was typed, which
  // is what Jira does: an empty box shows it, typing narrows the list away.
  const options = useMemo(() => {
    const list = [];
    if (allowUnassigned) list.push({ value: null, label: UNASSIGNED.name });
    for (const u of users) {
      list.push({
        value: u.id,
        label: u.name,
        keywords: [u.email, u.role].filter(Boolean),
        leading: avatar(u.id, u.name),
      });
    }
    return list;
  }, [allowUnassigned, users]);

  return (
    <InlineDropdownField
      value={value == null ? null : Number(value)}
      options={options}
      onSelect={onSelect}
      readOnly={readOnly}
      label={label}
      emptyText="No matching people"
      className={`user-picker-trigger${className ? ` ${className}` : ''}`}
      renderValue={(option) => (
        <>
          {option ? (
            option.leading
          ) : (
            <Avatar name={undefined} assigned={false} size={size} unassignedIcon showTitle={false} />
          )}
          <span className={`user-picker-name${option ? '' : ' is-empty'}`}>
            {option ? option.label : UNASSIGNED.name}
          </span>
        </>
      )}
    />
  );
}
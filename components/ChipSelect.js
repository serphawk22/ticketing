'use client';

/**
 * A small radio group that reads as a row of pills.
 *
 * Hours worked is a fixed handful of values, and a menu for seven numbers is a
 * menu where a glance would do. The pills are real radios under the hood --
 * role="radiogroup", role="radio", aria-checked -- so keyboard and screen-reader
 * behaviour comes from the platform rather than from a reimplementation, and
 * there is no radio component elsewhere in the app to match.
 */
export default function ChipSelect({ label, value, options, onChange, name }) {
  return (
    <div className="chip-select" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          name={name}
          aria-checked={value === option.value}
          className={`chip${value === option.value ? ' is-selected' : ''}`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

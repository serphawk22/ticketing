import { initials, colorFor } from './meta';

export default function Avatar({
  name,
  assigned,
  size = 26,
  showTitle = true,
  unassignedIcon = false,
}) {
  const styleSize = {
    width: size,
    height: size,
    fontSize: Math.max(10, Math.round(size * 0.42)),
  };

  if (!assigned) {
    return (
      <span
        className={`avatar unassigned${unassignedIcon ? ' is-icon' : ''}`}
        style={styleSize}
        title={showTitle ? 'Unassigned' : undefined}
        aria-hidden="true"
      >
        {unassignedIcon ? (
          <svg
            viewBox="0 0 24 24"
            width={Math.round(size * 0.6)}
            height={Math.round(size * 0.6)}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        ) : (
          '?'
        )}
      </span>
    );
  }

  return (
    <span
      className="avatar"
      style={{ background: colorFor(name), ...styleSize }}
      title={showTitle ? name : undefined}
      aria-label={name}
    >
      {initials(name)}
    </span>
  );
}
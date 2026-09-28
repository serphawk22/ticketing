import { initials, colorFor } from './meta';

export default function Avatar({ name, assigned, size = 26, showTitle = true }) {
  const styleSize = {
    width: size,
    height: size,
    fontSize: Math.max(10, Math.round(size * 0.42)),
  };

  if (!assigned) {
    return (
      <span
        className="avatar unassigned"
        style={styleSize}
        title={showTitle ? 'Unassigned' : undefined}
        aria-hidden="true"
      >
        ?
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
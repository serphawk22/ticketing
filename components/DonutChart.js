export default function DonutChart({
  segments,
  size = 148,
  thickness = 16,
  total,
  totalLabel = 'Total work items',
  centerValue,
  centerLabel,
}) {
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;

  const visible = segments.filter((s) => s.value > 0);
  const totalValue = total ?? segments.reduce((sum, s) => sum + s.value, 0);
  const isFullRing = visible.length === 1 && totalValue === visible[0].value;

  let offset = 0;

  return (
    <div className="donut" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={`${totalValue} work items by status`}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--bg-hover)"
          strokeWidth={thickness}
        />
        {isFullRing ? (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={visible[0].color}
            strokeWidth={thickness}
          />
        ) : (
          visible.map((s) => {
            const fraction = s.value / totalValue;
            const dash = fraction * circumference;
            const el = (
              <circle
                key={s.key}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={s.color}
                strokeWidth={thickness}
                strokeDasharray={`${dash} ${circumference - dash}`}
                strokeDashoffset={-offset}
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
              />
            );
            offset += dash;
            return el;
          })
        )}
      </svg>

      <div className="donut-center">
        <span className="donut-value">{centerValue ?? totalValue}</span>
        <span className="donut-label">{centerLabel ?? totalLabel}</span>
      </div>
    </div>
  );
}

export function BarChart({ rows, emptyLabel = 'No data yet' }) {
  const visible = rows.filter((r) => r.value > 0);
  const max = Math.max(1, ...visible.map((r) => r.value));

  if (visible.length === 0) {
    return <p className="chart-empty">{emptyLabel}</p>;
  }

  return (
    <ul className="bar-chart">
      {rows.map((row) => (
        <li key={row.key} className="bar-row">
          <span className="bar-label">
            {row.icon}
            {row.label}
          </span>
          <span className="bar-track">
            <span
              className="bar-fill"
              style={{
                width: `${(row.value / max) * 100}%`,
                background: row.color,
              }}
            />
          </span>
          <span className="bar-value">{row.value}</span>
        </li>
      ))}
    </ul>
  );
}

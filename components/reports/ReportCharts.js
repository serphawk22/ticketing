'use client';

export function DonutChart({ data = [], size = 180, innerRadius = 55 }) {
  const total = data.reduce((sum, item) => sum + (Number(item.count) || 0), 0);
  if (!total) {
    return (
      <div className="rpt-chart-empty" style={{ height: size }}>
        No data to display in chart
      </div>
    );
  }

  const radius = size / 2;
  const strokeWidth = radius - innerRadius;
  const circumference = 2 * Math.PI * (innerRadius + strokeWidth / 2);

  let accumulated = 0;
  const segments = data.map((item, idx) => {
    const value = Number(item.count) || 0;
    const ratio = value / total;
    const strokeDasharray = `${ratio * circumference} ${circumference}`;
    const strokeDashoffset = -accumulated * circumference;
    accumulated += ratio;

    const defaultColors = ['#0c66e4', '#00875a', '#ff991f', '#de350b', '#6554c0', '#36b37e'];
    const color = item.color || defaultColors[idx % defaultColors.length];

    return (
      <circle
        key={item.label || idx}
        cx={radius}
        cy={radius}
        r={innerRadius + strokeWidth / 2}
        fill="transparent"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeDasharray={strokeDasharray}
        strokeDashoffset={strokeDashoffset}
      >
        <title>{`${item.label}: ${value} (${Math.round(ratio * 100)}%)`}</title>
      </circle>
    );
  });

  return (
    <div className="rpt-donut-wrap">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="rpt-donut-svg">
        <g transform={`rotate(-90 ${radius} ${radius})`}>{segments}</g>
        <text x="50%" y="48%" textAnchor="middle" dy=".3em" fontSize="22" fontWeight="700" fill="currentColor">
          {total}
        </text>
        <text x="50%" y="62%" textAnchor="middle" fontSize="11" fill="#626f86">
          Total
        </text>
      </svg>
      <div className="rpt-chart-legend">
        {data.map((item, idx) => {
          const defaultColors = ['#0c66e4', '#00875a', '#ff991f', '#de350b', '#6554c0', '#36b37e'];
          const color = item.color || defaultColors[idx % defaultColors.length];
          const val = Number(item.count) || 0;
          return (
            <div key={item.label || idx} className="rpt-legend-item">
              <span className="rpt-legend-dot" style={{ backgroundColor: color }} />
              <span className="rpt-legend-text">{item.label}</span>
              <span className="rpt-legend-val">{val}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function BarChart({ data = [], height = 220 }) {
  if (!data || data.length === 0) {
    return <div className="rpt-chart-empty" style={{ height }}>No data available</div>;
  }

  const max = Math.max(1, ...data.map((d) => Number(d.count || d.value) || 0));

  return (
    <div className="rpt-bar-chart" style={{ height }}>
      <div className="rpt-bar-rows">
        {data.map((item, idx) => {
          const val = Number(item.count || item.value) || 0;
          const pct = Math.min(100, Math.round((val / max) * 100));
          const color = item.color || '#0c66e4';
          return (
            <div key={item.label || idx} className="rpt-bar-row">
              <div className="rpt-bar-label" title={item.label}>
                {item.label}
              </div>
              <div className="rpt-bar-track">
                <div
                  className="rpt-bar-fill"
                  style={{ width: `${Math.max(4, pct)}%`, backgroundColor: color }}
                />
              </div>
              <div className="rpt-bar-val">{val}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function TrendChart({ data = [], height = 200 }) {
  if (!data || data.length === 0) {
    return <div className="rpt-chart-empty" style={{ height }}>No trend records</div>;
  }

  const width = 600;
  const pad = { t: 20, r: 20, b: 30, l: 40 };
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;

  const max = Math.max(1, ...data.map((d) => Number(d.count || d.value) || 0));

  const points = data.map((d, i) => {
    const x = pad.l + (data.length <= 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
    const val = Number(d.count || d.value) || 0;
    const y = pad.t + innerH - (val / max) * innerH;
    return { x, y, val, label: d.label || String(i) };
  });

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="rpt-trend-svg" style={{ width: '100%', height }}>
      {/* Grid line */}
      <line x1={pad.l} x2={width - pad.r} y1={pad.t + innerH} y2={pad.t + innerH} stroke="var(--border, #dfe1e6)" />
      {/* Path line */}
      <path d={pathD} fill="none" stroke="#0c66e4" strokeWidth="2.5" />
      {/* Dots */}
      {points.map((p, idx) => (
        <circle key={idx} cx={p.x} cy={p.y} r="4" fill="#0c66e4">
          <title>{`${p.label}: ${p.val}`}</title>
        </circle>
      ))}
    </svg>
  );
}


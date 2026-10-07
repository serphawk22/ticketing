function chartBox(seriesLength) {
  const width = 720;
  const height = 248;
  const pad = { l: 36, r: 12, t: 14, b: 32 };
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const x = (index) =>
    pad.l + (seriesLength <= 1 ? innerW / 2 : (index / (seriesLength - 1)) * innerW);
  return { width, height, pad, innerH, x };
}

function yTicks(max) {
  const top = Math.max(1, max);
  const mid = Math.round(top / 2);
  return [...new Set([0, mid, top])];
}

function Axis({ box, max, series }) {
  const ticks = yTicks(max);
  const y = (value) => box.pad.t + box.innerH - (value / Math.max(1, max)) * box.innerH;
  return (
    <g>
      {ticks.map((tick) => (
        <g key={tick}>
          <line
            x1={box.pad.l}
            x2={box.width - box.pad.r}
            y1={y(tick)}
            y2={y(tick)}
            stroke="#DFE1E6"
            strokeWidth="1"
          />
          <text x={box.pad.l - 6} y={y(tick) + 4} textAnchor="end" fill="#626F86" fontSize="11">
            {tick}
          </text>
        </g>
      ))}
      {series.map((item, index) => {
        const caption = Object.prototype.hasOwnProperty.call(item, 'tick') ? item.tick : item.label;
        if (!caption) return null;
        return (
          <text
            key={item.key}
            x={box.x(index)}
            y={box.height - 8}
            textAnchor="middle"
            fill="#626F86"
            fontSize="11"
          >
            {caption}
          </text>
        );
      })}
    </g>
  );
}

export function TrendChart({ series, label }) {
  const box = chartBox(series.length);
  const max = Math.max(1, ...series.flatMap((item) => [item.created, item.resolved]));
  const y = (value) => box.pad.t + box.innerH - (value / max) * box.innerH;
  const path = (key) =>
    series.map((item, index) => `${index === 0 ? 'M' : 'L'} ${box.x(index)} ${y(item[key])}`).join(' ');

  return (
    <svg className="rpt-chart-svg" viewBox={`0 0 ${box.width} ${box.height}`} role="img" aria-label={label}>
      <Axis box={box} max={max} series={series} />
      <path d={path('created')} fill="none" stroke="#0C66E4" strokeWidth="2" />
      <path d={path('resolved')} fill="none" stroke="#22A06B" strokeWidth="2" />
      {series.map((item, index) => (
        <g key={item.key}>
          <circle cx={box.x(index)} cy={y(item.created)} r="3" fill="#0C66E4">
            <title>{`${item.label}: ${item.created} created`}</title>
          </circle>
          <circle cx={box.x(index)} cy={y(item.resolved)} r="3" fill="#22A06B">
            <title>{`${item.label}: ${item.resolved} resolved`}</title>
          </circle>
        </g>
      ))}
    </svg>
  );
}

export function StackedArea({ series, keys, label }) {
  const box = chartBox(series.length);
  const max = Math.max(
    1,
    ...series.map((item) => keys.reduce((sum, key) => sum + (item.counts[key.key] || 0), 0))
  );
  const y = (value) => box.pad.t + box.innerH - (value / max) * box.innerH;
  const areas = keys.map((key, layer) => {
    const top = [];
    const bottom = [];
    series.forEach((item, index) => {
      let below = 0;
      for (let i = 0; i < layer; i++) below += item.counts[keys[i].key] || 0;
      const value = item.counts[key.key] || 0;
      top.push([box.x(index), y(below + value)]);
      bottom.push([box.x(index), y(below)]);
    });
    const points = [...top, ...bottom.reverse()];
    return {
      key: key.key,
      color: key.color,
      d: points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point[0]} ${point[1]}`).join(' ') + ' Z',
    };
  });

  return (
    <svg className="rpt-chart-svg" viewBox={`0 0 ${box.width} ${box.height}`} role="img" aria-label={label}>
      <Axis box={box} max={max} series={series} />
      {areas.map((area) => (
        <path key={area.key} d={area.d} fill={area.color} opacity="0.9" />
      ))}
    </svg>
  );
}

export function ColumnChart({ series, color = '#0C66E4', label }) {
  const max = Math.max(1, ...series.map((item) => item.value));
  return (
    <div className="rpt-columns" role="img" aria-label={label}>
      {series.map((item) => (
        <div key={item.key} className="rpt-column" title={`${item.label}: ${item.value}`}>
          <span
            className="rpt-column-bar"
            style={{ height: `${(item.value / max) * 100}%`, background: item.value ? color : 'transparent' }}
          />
          <span className="rpt-column-label">{item.tick || ''}</span>
        </div>
      ))}
    </div>
  );
}

export function MeterList({ rows, label }) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  if (!rows.length) return null;
  return (
    <ul className="rpt-meters" aria-label={label}>
      {rows.map((row) => (
        <li key={row.key} className="rpt-meter">
          <span className="rpt-meter-label">{row.label}</span>
          <span className="rpt-meter-track">
            <span style={{ width: `${(row.value / max) * 100}%`, background: row.color }} />
          </span>
          <span className="rpt-meter-value">{row.display ?? row.value}</span>
        </li>
      ))}
    </ul>
  );
}

export function StackedMix({ parts }) {
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  if (!total) return <span className="rpt-stack" />;
  return (
    <span className="rpt-stack" aria-hidden="true">
      {parts.map((part) =>
        part.value > 0 ? (
          <span
            key={part.key}
            style={{ width: `${(part.value / total) * 100}%`, background: part.color }}
            title={`${part.label}: ${part.value}`}
          />
        ) : null
      )}
    </span>
  );
}

export function ChartLegend({ items }) {
  return (
    <div className="rpt-legend">
      {items.map((item) => (
        <span key={item.key}>
          <i style={{ background: item.color }} />
          {item.label}
        </span>
      ))}
    </div>
  );
}

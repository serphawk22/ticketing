'use client';

import React, { useState } from 'react';

const PALETTE = [
  '#0c66e4', // Atlassian Blue
  '#00875a', // Green
  '#ff991f', // Amber
  '#de350b', // Red
  '#6554c0', // Purple
  '#00b8d9', // Cyan
  '#36b37e', // Emerald
  '#ff5630', // Orange-red
  '#8777d9', // Lavender
  '#4a154b', // Deep Plum
];

export function ChartEmptyState({
  title = 'No visual data available',
  message = 'No metrics match the current filter criteria or date range.',
  hint = 'Try adjusting the date range or clearing specific filter selections.',
  height = 200,
}) {
  return (
    <div className="rpt-chart-empty-state" style={{ minHeight: height }}>
      <div className="rpt-chart-empty-icon" aria-hidden="true">
        <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#8993a4" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="20" x2="18" y2="10" />
          <line x1="12" y1="20" x2="12" y2="4" />
          <line x1="6" y1="20" x2="6" y2="14" />
          <line x1="2" y1="20" x2="22" y2="20" />
        </svg>
      </div>
      <div className="rpt-chart-empty-title">{title}</div>
      <div className="rpt-chart-empty-desc">{message}</div>
      {hint && <div className="rpt-chart-empty-hint">{hint}</div>}
    </div>
  );
}

export function DonutChart({
  data = [],
  size = 200,
  innerRadius = 60,
  centerLabel = 'Total',
  centerValue,
  unit = '',
}) {
  const [activeIdx, setActiveIdx] = useState(null);

  const cleanData = (Array.isArray(data) ? data : [])
    .map((d) => ({
      label: String(d.label || 'Other'),
      count: Math.max(0, Number(d.count ?? d.value) || 0),
      color: d.color,
      sublabel: d.sublabel,
    }))
    .filter((d) => d.count > 0 || data.length === 1);

  const total = cleanData.reduce((sum, item) => sum + item.count, 0);

  if (!cleanData.length || total === 0) {
    return <ChartEmptyState height={size} title="No distribution records" message="All categories currently have zero count in this scope." />;
  }

  const radius = size / 2;
  const strokeWidth = radius - innerRadius;
  const circumference = 2 * Math.PI * (innerRadius + strokeWidth / 2);

  let accumulated = 0;
  const segments = cleanData.map((item, idx) => {
    const value = item.count;
    const ratio = total > 0 ? value / total : 0;
    const strokeDasharray = `${ratio * circumference} ${circumference}`;
    const strokeDashoffset = -accumulated * circumference;
    accumulated += ratio;

    const color = item.color || PALETTE[idx % PALETTE.length];
    const isHovered = activeIdx === idx;

    return (
      <circle
        key={item.label || idx}
        cx={radius}
        cy={radius}
        r={innerRadius + strokeWidth / 2}
        fill="transparent"
        stroke={color}
        strokeWidth={isHovered ? strokeWidth + 3 : strokeWidth}
        strokeDasharray={strokeDasharray}
        strokeDashoffset={strokeDashoffset}
        style={{
          transition: 'stroke-width 0.2s ease, opacity 0.2s ease',
          cursor: 'pointer',
          opacity: activeIdx === null || isHovered ? 1 : 0.6,
        }}
        onMouseEnter={() => setActiveIdx(idx)}
        onMouseLeave={() => setActiveIdx(null)}
      >
        <title>{`${item.label}: ${value.toLocaleString()}${unit ? ' ' + unit : ''} (${Math.round(ratio * 100)}%)`}</title>
      </circle>
    );
  });

  const activeItem = activeIdx !== null ? cleanData[activeIdx] : null;
  const displayVal = activeItem
    ? `${activeItem.count.toLocaleString()}${unit ? ' ' + unit : ''}`
    : centerValue !== undefined
    ? centerValue
    : total.toLocaleString();
  const displayLabel = activeItem ? activeItem.label : centerLabel;

  return (
    <div className="rpt-donut-wrap">
      <div className="rpt-donut-graphic">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="rpt-donut-svg">
          <g transform={`rotate(-90 ${radius} ${radius})`}>{segments}</g>
          {/* Subtle inner background disc */}
          <circle cx={radius} cy={radius} r={innerRadius - 2} fill="#fafbfc" />
          <text
            x="50%"
            y="48%"
            textAnchor="middle"
            dy=".3em"
            fontSize={displayVal.length > 6 ? '18' : '22'}
            fontWeight="800"
            fill="#172b4d"
          >
            {displayVal}
          </text>
          <text
            x="50%"
            y="64%"
            textAnchor="middle"
            fontSize="11"
            fontWeight="600"
            fill="#626f86"
            className="rpt-donut-center-sub"
          >
            {displayLabel.length > 14 ? displayLabel.slice(0, 12) + '…' : displayLabel}
          </text>
        </svg>
      </div>

      <div className="rpt-chart-legend">
        {cleanData.map((item, idx) => {
          const color = item.color || PALETTE[idx % PALETTE.length];
          const val = item.count;
          const pct = total > 0 ? Math.round((val / total) * 100) : 0;
          const isHovered = activeIdx === idx;

          return (
            <div
              key={item.label || idx}
              className={`rpt-legend-item${isHovered ? ' rpt-legend-active' : ''}`}
              onMouseEnter={() => setActiveIdx(idx)}
              onMouseLeave={() => setActiveIdx(null)}
            >
              <span className="rpt-legend-dot" style={{ backgroundColor: color }} />
              <span className="rpt-legend-text" title={item.label}>
                {item.label}
              </span>
              <span className="rpt-legend-val">
                {val.toLocaleString()}
                {unit ? ` ${unit}` : ''}
              </span>
              <span className="rpt-legend-pct">{pct}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function BarChart({
  data = [],
  unit = '',
  maxBars = 12,
  showPercentage = true,
}) {
  const cleanData = (Array.isArray(data) ? data : [])
    .map((d, i) => ({
      label: String(d.label || `Item ${i + 1}`),
      value: Number(d.count ?? d.value) || 0,
      color: d.color,
      sublabel: d.sublabel,
    }))
    .filter((d) => d.value >= 0);

  if (!cleanData.length || cleanData.every((d) => d.value === 0)) {
    return <ChartEmptyState title="No bar data available" message="All items have zero records in the current view." />;
  }

  // Display top items sorted or preserved
  const displayItems = cleanData.slice(0, maxBars);
  const maxVal = Math.max(1, ...displayItems.map((d) => d.value));
  const sumVal = displayItems.reduce((acc, d) => acc + d.value, 0);

  return (
    <div className="rpt-bar-chart">
      <div className="rpt-bar-rows">
        {displayItems.map((item, idx) => {
          const val = item.value;
          const pctOfMax = Math.min(100, Math.round((val / maxVal) * 100));
          const pctOfTotal = sumVal > 0 ? Math.round((val / sumVal) * 100) : 0;
          const color = item.color || PALETTE[idx % PALETTE.length];

          return (
            <div key={item.label || idx} className="rpt-bar-row">
              <div className="rpt-bar-rank">#{idx + 1}</div>
              <div className="rpt-bar-label" title={item.label}>
                {item.label}
              </div>
              <div className="rpt-bar-track">
                <div
                  className="rpt-bar-fill"
                  style={{
                    width: `${Math.max(2, pctOfMax)}%`,
                    backgroundColor: color,
                  }}
                />
              </div>
              <div className="rpt-bar-val">
                {val.toLocaleString()}
                {unit ? ` ${unit}` : ''}
              </div>
              {showPercentage && sumVal > 0 && (
                <div className="rpt-bar-pct-badge">{pctOfTotal}%</div>
              )}
            </div>
          );
        })}
      </div>
      {cleanData.length > maxBars && (
        <div className="rpt-chart-more-notice">
          Showing top {maxBars} of {cleanData.length} records. See table below for full list.
        </div>
      )}
    </div>
  );
}

export function ComparisonBarChart({
  data = [],
  label1 = 'Planned',
  label2 = 'Actual',
  color1 = '#0c66e4',
  color2 = '#00875a',
  unit = '',
  maxItems = 8,
}) {
  const items = (Array.isArray(data) ? data : []).slice(0, maxItems);

  if (!items.length) {
    return <ChartEmptyState title="No comparison data" message="No comparative records found for current filters." />;
  }

  const allVals = items.flatMap((it) => [Number(it.val1 ?? it.planned) || 0, Number(it.val2 ?? it.actual) || 0]);
  const maxVal = Math.max(1, ...allVals);

  return (
    <div className="rpt-comparison-wrap">
      <div className="rpt-comparison-legend">
        <div className="rpt-comp-legend-pill">
          <span className="rpt-legend-dot" style={{ backgroundColor: color1 }} />
          <span>{label1}</span>
        </div>
        <div className="rpt-comp-legend-pill">
          <span className="rpt-legend-dot" style={{ backgroundColor: color2 }} />
          <span>{label2}</span>
        </div>
      </div>

      <div className="rpt-comparison-grid">
        {items.map((item, idx) => {
          const v1 = Number(item.val1 ?? item.planned) || 0;
          const v2 = Number(item.val2 ?? item.actual) || 0;
          const pct1 = Math.min(100, Math.round((v1 / maxVal) * 100));
          const pct2 = Math.min(100, Math.round((v2 / maxVal) * 100));
          const delta = v2 - v1;

          return (
            <div key={item.label || idx} className="rpt-comp-row">
              <div className="rpt-comp-label" title={item.label}>
                {item.label}
              </div>
              <div className="rpt-comp-bars">
                {/* Bar 1 */}
                <div className="rpt-comp-bar-row">
                  <div className="rpt-comp-track">
                    <div className="rpt-comp-fill" style={{ width: `${Math.max(2, pct1)}%`, backgroundColor: color1 }} />
                  </div>
                  <div className="rpt-comp-val">
                    {v1.toLocaleString()}
                    {unit ? ` ${unit}` : ''}
                  </div>
                </div>
                {/* Bar 2 */}
                <div className="rpt-comp-bar-row">
                  <div className="rpt-comp-track">
                    <div className="rpt-comp-fill" style={{ width: `${Math.max(2, pct2)}%`, backgroundColor: color2 }} />
                  </div>
                  <div className="rpt-comp-val">
                    {v2.toLocaleString()}
                    {unit ? ` ${unit}` : ''}
                  </div>
                </div>
              </div>
              <div className={`rpt-comp-delta ${delta > 0 ? 'delta-pos' : delta < 0 ? 'delta-neg' : 'delta-zero'}`}>
                {delta > 0 ? `+${delta.toFixed(1)}` : delta < 0 ? `${delta.toFixed(1)}` : '0'}
                {unit ? ` ${unit}` : ''}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function TrendChart({
  data = [],
  height = 220,
  unit = '',
  lineColor = '#0c66e4',
  fillGradient = true,
}) {
  const [hoveredIdx, setHoveredIdx] = useState(null);

  const cleanData = (Array.isArray(data) ? data : [])
    .map((d, i) => ({
      label: String(d.label || `${i + 1}`),
      value: Number(d.count ?? d.value) || 0,
    }))
    .filter((d) => !Number.isNaN(d.value));

  if (!cleanData.length) {
    return <ChartEmptyState height={height} title="No trend records" message="No timeline data points available within the selected period." />;
  }

  const width = 640;
  const pad = { t: 25, r: 25, b: 35, l: 45 };
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;

  const max = Math.max(1, ...cleanData.map((d) => d.value));
  const min = 0;

  const points = cleanData.map((d, i) => {
    const x = pad.l + (cleanData.length <= 1 ? innerW / 2 : (i / (cleanData.length - 1)) * innerW);
    const y = pad.t + innerH - (d.value / max) * innerH;
    return { x, y, val: d.value, label: d.label };
  });

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const areaD = fillGradient && points.length > 1
    ? `${pathD} L ${points[points.length - 1].x.toFixed(1)} ${pad.t + innerH} L ${points[0].x.toFixed(1)} ${pad.t + innerH} Z`
    : '';

  // Calculate 3 Y-axis ticks
  const ticks = [
    { y: pad.t, val: Math.round(max) },
    { y: pad.t + innerH / 2, val: Math.round(max / 2) },
    { y: pad.t + innerH, val: 0 },
  ];

  // Pick ~5 x-axis labels to avoid crowding
  const step = Math.max(1, Math.ceil(cleanData.length / 5));
  const xLabels = points.filter((_, idx) => idx % step === 0 || idx === points.length - 1);

  return (
    <div className="rpt-trend-wrap" style={{ position: 'relative' }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="rpt-trend-svg"
        style={{ width: '100%', height, display: 'block', overflow: 'visible' }}
      >
        <defs>
          <linearGradient id="trendGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={lineColor} stopOpacity="0.25" />
            <stop offset="100%" stopColor={lineColor} stopOpacity="0.00" />
          </linearGradient>
        </defs>

        {/* Horizontal gridlines and Y-axis scale */}
        {ticks.map((t, idx) => (
          <g key={idx}>
            <line
              x1={pad.l}
              x2={width - pad.r}
              y1={t.y}
              y2={t.y}
              stroke="#ebecf0"
              strokeDasharray={idx === 2 ? 'none' : '3 3'}
              strokeWidth="1"
            />
            <text x={pad.l - 8} y={t.y + 3} textAnchor="end" fontSize="10" fill="#8993a4">
              {t.val.toLocaleString()}
            </text>
          </g>
        ))}

        {/* Area fill */}
        {areaD && <path d={areaD} fill="url(#trendGradient)" />}

        {/* Trend Path */}
        <path
          d={pathD}
          fill="none"
          stroke={lineColor}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Interactive Dots */}
        {points.map((p, idx) => {
          const isHovered = hoveredIdx === idx;
          return (
            <g
              key={idx}
              onMouseEnter={() => setHoveredIdx(idx)}
              onMouseLeave={() => setHoveredIdx(null)}
              style={{ cursor: 'pointer' }}
            >
              <circle
                cx={p.x}
                cy={p.y}
                r={isHovered ? 6 : 4}
                fill="#ffffff"
                stroke={lineColor}
                strokeWidth={isHovered ? 3 : 2}
                style={{ transition: 'all 0.15s ease' }}
              />
              <title>{`${p.label}: ${p.val.toLocaleString()}${unit ? ' ' + unit : ''}`}</title>
            </g>
          );
        })}

        {/* X-axis labels */}
        {xLabels.map((p, idx) => (
          <text
            key={idx}
            x={p.x}
            y={height - 8}
            textAnchor="middle"
            fontSize="10"
            fill="#626f86"
          >
            {p.label.length > 10 ? p.label.slice(5) : p.label}
          </text>
        ))}
      </svg>

      {/* Hover tooltip overlay */}
      {hoveredIdx !== null && points[hoveredIdx] && (
        <div
          className="rpt-trend-tooltip"
          style={{
            position: 'absolute',
            left: `${(points[hoveredIdx].x / width) * 100}%`,
            top: `${(points[hoveredIdx].y / height) * 100}%`,
            transform: 'translate(-50%, -120%)',
          }}
        >
          <div className="rpt-tt-label">{points[hoveredIdx].label}</div>
          <div className="rpt-tt-val">
            {points[hoveredIdx].val.toLocaleString()}
            {unit ? ` ${unit}` : ''}
          </div>
        </div>
      )}
    </div>
  );
}

export function StackedDistributionBar({
  data = [],
  unit = '',
  height = 24,
}) {
  const cleanData = (Array.isArray(data) ? data : [])
    .map((d, i) => ({
      label: String(d.label || `Segment ${i + 1}`),
      count: Math.max(0, Number(d.count ?? d.value) || 0),
      color: d.color || PALETTE[i % PALETTE.length],
    }))
    .filter((d) => d.count > 0);

  const total = cleanData.reduce((acc, d) => acc + d.count, 0);

  if (!cleanData.length || total === 0) {
    return <ChartEmptyState height={80} title="No segments" message="All categories are empty in this scope." />;
  }

  return (
    <div className="rpt-stacked-wrap">
      <div className="rpt-stacked-track" style={{ height }}>
        {cleanData.map((seg, idx) => {
          const pct = ((seg.count / total) * 100).toFixed(1);
          return (
            <div
              key={seg.label || idx}
              className="rpt-stacked-seg"
              style={{
                width: `${pct}%`,
                backgroundColor: seg.color,
              }}
              title={`${seg.label}: ${seg.count.toLocaleString()}${unit ? ' ' + unit : ''} (${pct}%)`}
            >
              {parseFloat(pct) >= 10 && <span className="rpt-seg-label">{pct}%</span>}
            </div>
          );
        })}
      </div>

      <div className="rpt-stacked-legend">
        {cleanData.map((seg, idx) => {
          const pct = Math.round((seg.count / total) * 100);
          return (
            <div key={seg.label || idx} className="rpt-legend-item">
              <span className="rpt-legend-dot" style={{ backgroundColor: seg.color }} />
              <span className="rpt-legend-text">{seg.label}</span>
              <span className="rpt-legend-val">
                {seg.count.toLocaleString()}
                {unit ? ` ${unit}` : ''}
              </span>
              <span className="rpt-legend-pct">({pct}%)</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

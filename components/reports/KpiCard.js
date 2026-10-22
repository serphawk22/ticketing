'use client';

export default function KpiCard({ title, value, subtitle, tone, icon: Icon }) {
  let toneClass = '';
  if (tone === 'pos' || tone === 'good') toneClass = ' kpi-pos';
  if (tone === 'neg' || tone === 'bad') toneClass = ' kpi-neg';
  if (tone === 'warn') toneClass = ' kpi-warn';

  return (
    <div className={`rpt-kpi-card${toneClass}`}>
      <div className="rpt-kpi-head">
        <span className="rpt-kpi-title">{title}</span>
        {Icon && (
          <span className="rpt-kpi-icon" aria-hidden="true">
            <Icon />
          </span>
        )}
      </div>
      <div className="rpt-kpi-value">{value ?? '—'}</div>
      {subtitle && <div className="rpt-kpi-sub">{subtitle}</div>}
    </div>
  );
}


export function SummaryCard({
  title,
  description,
  action,
  className = '',
  children,
  isLoading = false,
  skeletonRows = 3,
}) {
  return (
    <section className={`summary-card ${className}`.trim()}>
      {(title || action) && (
        <header className="summary-card-head">
          <div className="summary-card-heading">
            {title && <h2>{title}</h2>}
            {description && <p>{description}</p>}
          </div>
          {action}
        </header>
      )}

      <div className="summary-card-body">
        {isLoading ? (
          <div className="skeleton-group" aria-hidden="true">
            {Array.from({ length: skeletonRows }).map((_, i) => (
              <div key={i} className="skeleton" style={{ width: `${100 - i * 12}%` }} />
            ))}
          </div>
        ) : (
          children
        )}
      </div>
    </section>
  );
}

export function MetricCard({ icon, value, label, hint }) {
  return (
    <div className="metric-card">
      <span className="metric-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="metric-value">{value}</span>
      <span className="metric-label">{label}</span>
      {hint && <span className="metric-hint">{hint}</span>}
    </div>
  );
}

export function EmptyState({ illustration, title, description }) {
  return (
    <div className="card-empty">
      <span className="card-empty-art" aria-hidden="true">
        {illustration}
      </span>
      <p className="card-empty-title">{title}</p>
      {description && <p className="card-empty-text">{description}</p>}
    </div>
  );
}

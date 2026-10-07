'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import ReportShell from './ReportShell';
import DonutChart from './DonutChart';
import TicketDetailModal from './ticket/TicketDetailModal';
import useTicketModal from './useTicketModal';
import { PRIORITY_META, PriorityIcon, STATUS_META, TypeIcon } from './meta';
import { REPORTS, REPORT_FILTERS } from '@/lib/reportCatalog';
import { ChartLegend, ColumnChart, MeterList, StackedArea, StackedMix, TrendChart } from './reportCharts';

function Chevron() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function ReportChart({ chart, onPick, picked }) {
  if (!chart) return null;

  if (chart.type === 'trend') {
    return (
      <>
        <TrendChart series={chart.series} label={chart.label} />
        <ChartLegend
          items={[
            { key: 'created', label: 'Created', color: '#0C66E4' },
            { key: 'resolved', label: 'Resolved', color: '#22A06B' },
          ]}
        />
      </>
    );
  }

  if (chart.type === 'area') {
    return (
      <>
        <StackedArea series={chart.series} keys={chart.keys} label={chart.label} />
        <ChartLegend items={chart.keys} />
      </>
    );
  }

  if (chart.type === 'columns') {
    return <ColumnChart series={chart.series} color={chart.color} label={chart.label} />;
  }

  if (chart.type === 'meters') {
    return <MeterList rows={chart.rows} label={chart.label} />;
  }

  if (chart.type === 'pie') {
    return (
      <div className="rpt-pie">
        <DonutChart
          segments={chart.segments}
          total={chart.total}
          size={168}
          thickness={18}
          centerLabel="Work items"
        />
        <ul className="donut-legend">
          {chart.segments.map((segment) => (
            <li key={segment.key}>
              <button
                type="button"
                className={`rpt-legend-btn${picked === segment.key ? ' is-on' : ''}`}
                onClick={() => onPick(segment.key)}
              >
                <span className="legend-swatch" style={{ background: segment.color }} />
                <span className="legend-label">{segment.label}</span>
                <span className="legend-value">{segment.value}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return null;
}

function DataTable({ table, picked, onPick }) {
  if (!table?.rows?.length) return null;
  return (
    <div className="table-scroll rpt-table">
      <table className="data-table">
        <thead>
          <tr>
            {table.columns.map((column) => (
              <th key={column.key} className={column.numeric ? 'num' : undefined}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row) => (
            <tr key={row.id} className={picked && picked === row.bucket ? 'is-on' : undefined}>
              {table.columns.map((column) => (
                <td key={column.key} className={column.numeric ? 'num' : undefined}>
                  {column.meter ? (
                    <span className="rpt-inline-meter">
                      <span style={{ width: `${row.meter || 0}%`, background: row.color || '#0C66E4' }} />
                    </span>
                  ) : column.bar ? (
                    <StackedMix parts={row.bar || []} />
                  ) : column.key === 'label' && row.bucket && onPick ? (
                    <button type="button" className="rpt-text-btn" onClick={() => onPick(row.bucket)}>
                      {row.cells[column.key]}
                    </button>
                  ) : (
                    <span className={row.tones?.[column.key] ? `rpt-diff rpt-diff-${row.tones[column.key]}` : undefined}>
                      {row.cells[column.key]}
                    </span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function IssueTable({ issues, columns, onOpen }) {
  if (!issues.length) {
    return <p className="rpt-empty">No work items in this selection.</p>;
  }
  return (
    <div className="table-scroll rpt-table">
      <table className="data-table">
        <thead>
          <tr>
            <th>Key</th>
            <th>Summary</th>
            <th>Status</th>
            <th>Priority</th>
            <th>Assignee</th>
            <th>Created</th>
            {columns.map((column) => (
              <th key={column} className="num">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {issues.map((issue) => {
            const status = STATUS_META[issue.status] || STATUS_META.open;
            return (
              <tr key={issue.id}>
                <td>
                  <button type="button" className="list-key" onClick={() => onOpen(issue.id)}>
                    {issue.key}
                  </button>
                </td>
                <td>
                  <span className="rpt-issue">
                    <TypeIcon type={issue.type} />
                    <button type="button" className="rpt-issue-title" onClick={() => onOpen(issue.id)}>
                      {issue.title}
                    </button>
                  </span>
                </td>
                <td>
                  <span className="tm-child-status" style={{ background: status.bg, color: status.text }}>
                    {issue.statusLabel}
                  </span>
                </td>
                <td>
                  <span className="rpt-priority">
                    <PriorityIcon
                      color={PRIORITY_META[issue.priority]?.color}
                      arrow={PRIORITY_META[issue.priority]?.arrow}
                    />
                    {issue.priorityLabel}
                  </span>
                </td>
                <td>{issue.assignee}</td>
                <td>{issue.created}</td>
                {issue.more.map((value, index) => (
                  <td key={columns[index] || index} className="num">
                    {value}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function ReportView({
  project,
  projects,
  projectCounts,
  myIssuesCount,
  currentUser,
  employees,
  report,
  options,
  result,
  tickets,
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState(options);
  const [picked, setPicked] = useState('');
  const filters = REPORT_FILTERS[report.slug] || [];
  const modal = useTicketModal({ visible: tickets, lookup: tickets });

  useEffect(() => {
    setDraft(options);
    setPicked('');
  }, [options, report.slug]);

  function setOption(key, value) {
    const next = { ...draft, [key]: key === 'days' ? Number(value) : value };
    setDraft(next);
    const params = new URLSearchParams();
    for (const filter of filters) params.set(filter.key, String(next[filter.key]));
    startTransition(() => {
      router.replace(`/projects/${project.id}/reports/${report.slug}?${params.toString()}`, { scroll: false });
    });
  }

  function pick(bucket) {
    setPicked((current) => (current === bucket ? '' : bucket));
  }

  const issues = (result.issues || []).filter((issue) => !picked || issue.bucket === picked);
  const canPick = Boolean(result.issues?.length);

  return (
    <ReportShell
      project={project}
      projects={projects}
      projectCounts={projectCounts}
      myIssuesCount={myIssuesCount}
      currentUser={currentUser}
      title={report.title}
      subtitle={report.description}
      projectPath={(id) => `/projects/${id}/reports/${report.slug}`}
      breadcrumb={[
        { label: 'Projects', href: '/projects' },
        { label: project.name, href: `/projects/${project.id}/summary` },
        { label: 'Reports', href: `/projects/${project.id}/reports` },
        { label: report.title },
      ]}
    >
      <div className="rpt-filters">
        <label className="rpt-filter">
          Report
          <span className="select-field">
            <select
              value={report.slug}
              aria-label="Report"
              onChange={(event) => router.push(`/projects/${project.id}/reports/${event.target.value}`)}
            >
              {REPORTS.map((item) => (
                <option key={item.slug} value={item.slug}>
                  {item.name}
                </option>
              ))}
            </select>
            <Chevron />
          </span>
        </label>

        {filters.map((filter) => (
          <label key={filter.key} className="rpt-filter">
            {filter.label}
            <span className="select-field">
              <select
                value={String(draft[filter.key])}
                aria-label={filter.label}
                onChange={(event) => setOption(filter.key, event.target.value)}
              >
                {filter.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <Chevron />
            </span>
          </label>
        ))}
      </div>

      <div className={pending ? 'rpt-busy' : undefined} aria-busy={pending}>
        {result.stats?.length > 0 && (
          <div className="rpt-stats">
            {result.stats.map((item) => (
              <div key={item.label} className="rpt-stat">
                <span className="rpt-stat-value">{item.value}</span>
                <span className="rpt-stat-label">{item.label}</span>
              </div>
            ))}
          </div>
        )}

        {(result.chart || result.empty) && (
          <section className="rpt-panel">
            <h2>Chart</h2>
            {result.empty ? (
              <p className="rpt-empty">{result.empty}</p>
            ) : (
              <ReportChart chart={result.chart} picked={picked} onPick={pick} />
            )}
            {result.note ? <p className="rpt-note">{result.note}</p> : null}
          </section>
        )}

        {result.table?.rows?.length ? (
          <section className="rpt-panel">
            <h2>Data</h2>
            <DataTable table={result.table} picked={picked} onPick={canPick ? pick : null} />
          </section>
        ) : null}

        {result.issues && !result.empty ? (
          <section className="rpt-panel">
            <div className="rpt-panel-head">
              <h2>Work items</h2>
              <span className="rpt-count">
                {picked ? `${issues.length} of ${result.issues.length}` : issues.length}
                {picked ? (
                  <button type="button" className="link-button" onClick={() => setPicked('')}>
                    Clear filter
                  </button>
                ) : null}
              </span>
            </div>
            <IssueTable issues={issues} columns={result.issueColumns || []} onOpen={(id) => {
              const ticket = tickets.find((item) => item.id === id);
              if (ticket) modal.select(ticket);
            }} />
          </section>
        ) : null}
      </div>

      <TicketDetailModal
        ticket={modal.selected}
        employees={employees}
        currentUser={currentUser}
        siblingTickets={tickets}
        canStep={modal.canStep}
        onClose={modal.close}
        onNext={modal.next}
        onPrev={modal.prev}
        onTicketChanged={() => router.refresh()}
        onOpenTicket={(id) => {
          const ticket = tickets.find((item) => item.id === Number(id));
          if (ticket) modal.select(ticket);
        }}
      />
    </ReportShell>
  );
}

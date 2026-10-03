'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AppShell from './AppShell';
import PageHeader from './PageHeader';
import ProjectTabs from './ProjectTabs';
import Avatar from './Avatar';
import CreateTicketModal from './CreateTicketModal';
import DonutChart, { BarChart } from './DonutChart';
import { SummaryCard, MetricCard, EmptyState } from './SummaryCard';
import {
  STATUS_META,
  STATUS_ORDER,
  PRIORITY_META,
  PRIORITY_ORDER,
  TYPE_META,
  TYPE_ORDER,
  PriorityIcon,
  TypeIcon,
  formatShortDate,
} from './meta';

const BANNER_KEY = 'project-summary-banner-dismissed';

function relativeTime(value) {
  if (!value) return '';
  const then = new Date(String(value).trim().replace(' ', 'T') + 'Z').getTime();
  if (Number.isNaN(then)) return '';

  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;

  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;

  return formatShortDate(value);
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function PersonIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function FunnelIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 5h18l-7 8v6l-4 2v-8L3 5Z" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </svg>
  );
}

function EmptyArt() {
  return (
    <svg viewBox="0 0 64 48" width="64" height="48" aria-hidden="true">
      <rect x="6" y="10" width="52" height="30" rx="4" fill="#F4F5F7" />
      <rect x="12" y="17" width="24" height="4" rx="2" fill="#DFE1E6" />
      <rect x="12" y="25" width="34" height="4" rx="2" fill="#EBECF0" />
      <circle cx="46" cy="34" r="11" fill="#E9F2FF" />
      <path d="M46 28v12M40 34h12" stroke="#0C66E4" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

function BannerArt() {
  return (
    <svg viewBox="0 0 88 56" width="88" height="56" aria-hidden="true">
      <rect x="8" y="8" width="42" height="40" rx="4" fill="#fff" opacity="0.7" />
      <rect x="14" y="16" width="22" height="4" rx="2" fill="#B3D4FF" />
      <rect x="14" y="24" width="30" height="4" rx="2" fill="#DEEBFF" />
      <rect x="14" y="32" width="16" height="4" rx="2" fill="#DEEBFF" />
      <circle cx="62" cy="30" r="14" fill="#fff" opacity="0.85" />
      <path d="M62 22v9l6 4" stroke="#0C66E4" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <rect x="50" y="44" width="30" height="5" rx="2.5" fill="#B3D4FF" />
    </svg>
  );
}

export default function ProjectSummary({
  initialSummary,
  currentUser,
  projects,
  employees = [],
  projectCounts,
  myIssuesCount,
}) {
  const [data, setData] = useState(initialSummary);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [assignee, setAssignee] = useState('all');
  const [filterOpen, setFilterOpen] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const filterRef = useRef(null);
  const requestId = useRef(0);
  const projectId = initialSummary.project.id;
  const router = useRouter();

  useEffect(() => {
    try {
      setBannerDismissed(window.localStorage.getItem(BANNER_KEY) === '1');
    } catch {
    }
  }, []);

  useEffect(() => {
    function onClick(e) {
      if (filterRef.current && !filterRef.current.contains(e.target)) {
        setFilterOpen(false);
      }
    }
    function onKey(e) {
      if (e.key === 'Escape') setFilterOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  useEffect(() => {
    if (assignee === 'all') {
      setData(initialSummary);
      return;
    }

    const seq = ++requestId.current;
    const controller = new AbortController();
    setIsLoading(true);
    setError('');

    fetch(`/api/projects/${projectId}/summary?assignee=${encodeURIComponent(assignee)}`, {
      signal: controller.signal,
    })
      .then((res) => res.json())
      .then((payload) => {
        if (seq !== requestId.current) return;
        if (payload.error) throw new Error(payload.error);
        setData({ ...payload, project: initialSummary.project });
      })
      .catch((e) => {
        if (e.name === 'AbortError' || seq !== requestId.current) return;
        setError(e.message || 'Could not filter the summary.');
      })
      .finally(() => {
        if (seq === requestId.current) setIsLoading(false);
      });

    return () => controller.abort();
  }, [assignee, projectId, initialSummary]);

  function dismissBanner() {
    setBannerDismissed(true);
    try {
      window.localStorage.setItem(BANNER_KEY, '1');
    } catch {
    }
  }

  const statusSegments = useMemo(
    () =>
      STATUS_ORDER.map((key) => ({
        key,
        label: STATUS_META[key].label,
        value: data.byStatus?.[key] || 0,
        color: STATUS_META[key].color,
      })),
    [data.byStatus]
  );

  const priorityRows = useMemo(
    () =>
      PRIORITY_ORDER.map((key) => {
        const meta = PRIORITY_META[key];
        return {
          key,
          label: meta.label,
          value: data.byPriority?.[key] || 0,
          color: meta.color,
          icon: <PriorityIcon color={meta.color} arrow={meta.arrow} />,
        };
      }),
    [data.byPriority]
  );

  const typeRows = useMemo(
    () =>
      TYPE_ORDER.map((key) => ({
        key,
        label: TYPE_META[key].label,
        value: data.byType?.[key] || 0,
        color: TYPE_META[key].color,
        icon: <TypeIcon type={key} />,
      })),
    [data.byType]
  );

  const people = data.people || [];
  const activity = data.activity || [];
  const selected = assignee === 'all' ? null : people.find((p) => String(p.id) === assignee);
  const total = statusSegments.reduce((sum, s) => sum + s.value, 0);
  const windowDays = data.windowDays ?? 7;
  const isFiltered = assignee !== 'all';

  return (
    <AppShell
      currentUser={currentUser}
      projects={projects}
      projectCounts={projectCounts}
      myIssuesCount={myIssuesCount}
      view="summary"
      filter="all"
      onFilterChange={() => {}}
      projectId={String(projectId)}
      onProjectChange={(id) => router.push(`/projects/${id}/summary`)}
      onCreate={currentUser.role === 'admin' ? () => setShowCreate(true) : undefined}
    >
      <div className="board">
        {error && (
          <div className="error-banner">
            <strong>Error:</strong> {error}
            <button type="button" onClick={() => setError('')}>Dismiss</button>
          </div>
        )}

        <PageHeader
          className="summary-toolbar"
          breadcrumb={[{ label: 'Projects', href: '/projects' }, { label: data.project.name }]}
          title={data.project.name}
          project={data.project}
          subtitle={data.project.description}
          actions={
            <>
            <button className="icon-btn" type="button" title="Share project" aria-label="Share project">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="18" cy="5" r="3" />
                <circle cx="6" cy="12" r="3" />
                <circle cx="18" cy="19" r="3" />
                <path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4" />
              </svg>
            </button>
            <button className="icon-btn" type="button" title="Automation" aria-label="Automation">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />
              </svg>
            </button>
            <button className="icon-btn" type="button" title="Comments" aria-label="Comments">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 12a8 8 0 0 1-8 8H7l-4 3V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8Z" />
              </svg>
            </button>
            <button className="icon-btn" type="button" title="Full screen" aria-label="Full screen">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3" />
              </svg>
            </button>
            <button className="icon-btn" type="button" title="More actions" aria-label="More actions">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
                <circle cx="5" cy="12" r="1.8" />
                <circle cx="12" cy="12" r="1.8" />
                <circle cx="19" cy="12" r="1.8" />
              </svg>
            </button>
            </>
          }
        />

        <ProjectTabs projectId={projectId} active="summary" />

        {!bannerDismissed && (
          <div className="summary-banner">
            <span className="summary-banner-icon" aria-hidden="true">
              <InfoIcon />
            </span>
            <div className="summary-banner-text">
              <p className="summary-banner-title">
                {selected
                  ? `Showing work assigned to ${selected.name}`
                  : 'Get a quick read on how this project is tracking'}
              </p>
              <p className="summary-banner-body">
                {selected
                  ? 'Every count below is filtered to this person. Clear the filter to see the whole project.'
                  : `Done recently, created and updated cover the last ${windowDays} days. Use the filter to narrow everything to one person.`}
              </p>
            </div>
            <Link className="summary-banner-link" href={`/?project=${projectId}`}>
              Open the board
            </Link>
            <span className="summary-banner-art" aria-hidden="true">
              <BannerArt />
            </span>
            <button type="button" className="summary-banner-dismiss" onClick={dismissBanner}>
              Dismiss
            </button>
          </div>
        )}

        <div className="summary-filters">
          <div className="summary-avatars" aria-label="People with work in this project">
            {people.slice(0, 6).map((p) => (
              <span key={p.id} className="summary-avatar" title={`${p.name} — ${p.project_count}`}>
                <Avatar name={p.name} size={28} />
              </span>
            ))}
            {people.length === 0 && (
              <span className="summary-avatars-empty">Nobody assigned yet</span>
            )}
          </div>

          <div className="summary-filter-wrap" ref={filterRef}>
            <button
              type="button"
              className={`filter-btn${isFiltered ? ' active' : ''}`}
              aria-expanded={filterOpen}
              aria-haspopup="true"
              onClick={() => setFilterOpen((v) => !v)}
            >
              <FunnelIcon />
              {selected ? <span>{selected.name}</span> : <span className="filter-btn-label">Filter</span>}
            </button>

            {filterOpen && (
              <div className="menu-popup summary-filter-menu" role="menu">
                <button
                  type="button"
                  className="menu-item"
                  role="menuitemradio"
                  aria-checked={!isFiltered}
                  onClick={() => {
                    setAssignee('all');
                    setFilterOpen(false);
                  }}
                >
                  <PersonIcon />
                  Everyone
                  {!isFiltered && <span className="menu-check">✓</span>}
                </button>
                {people.length > 0 && <div className="menu-sep" />}
                {people.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="menu-item"
                    role="menuitemradio"
                    aria-checked={assignee === String(p.id)}
                    onClick={() => {
                      setAssignee(String(p.id));
                      setFilterOpen(false);
                    }}
                  >
                    <Avatar name={p.name} size={20} showTitle={false} />
                    <span className="menu-item-text">{p.name}</span>
                    <span className="menu-count">{p.project_count}</span>
                    {assignee === String(p.id) && <span className="menu-check">✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="metric-strip">
          <MetricCard
            icon={<CheckIcon />}
            value={data.metrics?.completed ?? 0}
            label="Done recently"
            hint={`in the last ${windowDays} days`}
          />
          <MetricCard
            icon={<PlusIcon />}
            value={data.metrics?.created ?? 0}
            label="Created"
            hint={`in the last ${windowDays} days`}
          />
          <MetricCard
            icon={<ClockIcon />}
            value={data.metrics?.updated ?? 0}
            label="Updated"
            hint={`in the last ${windowDays} days`}
          />
          <MetricCard
            icon={<PersonIcon />}
            value={data.metrics?.unassigned ?? 0}
            label="Unassigned"
            hint="still needs an owner"
          />
        </div>

        <div className="summary-grid">
          <SummaryCard
            title="Status overview"
            description="How work is distributed across the board right now."
            action={
              <Link className="card-link" href={`/?project=${projectId}`}>
                View all work items
              </Link>
            }
            isLoading={isLoading}
            skeletonRows={3}
          >
            {total === 0 ? (
              <EmptyState
                illustration={<EmptyArt />}
                title="No activity yet"
                description={
                  isFiltered
                    ? 'No work items are assigned to this person yet.'
                    : 'Create your first ticket to see how work is distributed.'
                }
              />
            ) : (
              <div className="status-overview">
                <DonutChart segments={statusSegments} total={total} size={150} thickness={16} />
                <ul className="donut-legend">
                  {statusSegments.map((s) => (
                    <li key={s.key}>
                      <span className="legend-swatch" style={{ background: s.color }} aria-hidden="true" />
                      <span className="legend-label">{s.label}</span>
                      <span className="legend-value">{s.value}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </SummaryCard>

          <SummaryCard
            title="Recent activity"
            description="The latest changes to work items in this project."
            isLoading={isLoading}
            skeletonRows={4}
          >
            {activity.length === 0 ? (
              <EmptyState
                illustration={<EmptyArt />}
                title="No activity yet"
                description="Create work items or invite teammates to get started."
              />
            ) : (
              <ul className="activity-list">
                {activity.map((item) => (
                  <li key={item.id} className="activity-item">
                    <Avatar name={item.employee_name} assigned={Boolean(item.employee_name)} size={24} />
                    <div className="activity-text">
                      <p>
                        <strong>{item.employee_name || item.created_by_name}</strong>{' '}
                        updated <span className="activity-key">{`${data.project?.key || 'TM'}-${item.id}`}</span> {item.title}
                      </p>
                      <span className="activity-time">
                        {relativeTime(item.updated_at)} · {STATUS_META[item.status]?.label}
                      </span>
                    </div>
                    <span
                      className="status-field-dot"
                      style={{ background: STATUS_META[item.status]?.color }}
                      aria-hidden="true"
                    />
                  </li>
                ))}
              </ul>
            )}
          </SummaryCard>

          <SummaryCard
            title="Priority breakdown"
            description="What is urgent versus what can wait."
            action={
              <span className="card-link is-static" title="How priority works in this app">
                How priorities work
              </span>
            }
            isLoading={isLoading}
            skeletonRows={4}
          >
            <BarChart rows={priorityRows} emptyLabel="No priorities to show yet" />
          </SummaryCard>

          <SummaryCard
            title="Types of work"
            description="The mix of bugs, stories and tasks being worked on."
            action={
              <span className="card-link is-static" title="How issue types are used here">
                About issue types
              </span>
            }
            isLoading={isLoading}
            skeletonRows={4}
          >
            <BarChart rows={typeRows} emptyLabel="No issues to show yet" />
          </SummaryCard>
        </div>
      </div>

      {showCreate && (
        <CreateTicketModal
          employees={employees}
          projects={projects}
          defaultProjectId={projectId}
          onClose={() => setShowCreate(false)}
          onCreate={() => setShowCreate(false)}
        />
      )}
    </AppShell>
  );
}

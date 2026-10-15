'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppShell from '@/components/AppShell';
import PageHeader from '@/components/PageHeader';
import EmptyState from '@/components/EmptyState';
import { useToasts, Toaster } from '@/components/Toaster';
import { ClockIcon } from '@/components/ticket/icons';
import { ClipboardIcon, SmileIcon } from '@/components/AppShellIcons';
import HappySheetHistoryView from '@/components/HappySheetHistoryView';
import downloadTaskSheetPng from '@/components/taskSheetPng';

const STATE_META = {
  completed: { label: 'Completed', className: 'is-done' },
  not_completed: { label: 'Not Completed', className: 'is-open' },
};

/**
 * The admin's view of both daily sheets.
 *
 * Two tabs over one page rather than two pages: the task sheet and the happy
 * sheet are one habit, written in one place, so they are read in one place.
 * The happy tab is a lighter panel (day filter, no hours) and the task tab
 * keeps the hours, projects and work-item links; the download on each tab
 * mirrors whatever its filters are showing at the time.
 */
export default function TaskSheetHistoryView({
  currentUser,
  projects,
  projectCounts,
  myIssuesCount,
  initial,
  facets,
  happyInitial,
  happyFacets,
}) {
  const router = useRouter();
  const { toasts, push, dismiss, pause, resume } = useToasts();
  const [tab, setTab] = useState('task');
  const [rows, setRows] = useState(initial);
  const [name, setName] = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const pending = useRef(null);

  useEffect(() => {
    clearTimeout(pending.current);
    pending.current = setTimeout(async () => {
      const params = new URLSearchParams();
      if (name) params.set('name', name);
      if (projectFilter) params.set('project', projectFilter);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      try {
        const res = await fetch(`/api/task-sheet?${params.toString()}`);
        const data = await res.json();
        if (res.ok) setRows(data.submissions || []);
        else push({ message: data.error || 'Could not load the task sheet.', tone: 'error' });
      } catch {
        push({ message: 'Could not load the task sheet.', tone: 'error' });
      }
    }, 250);
    return () => clearTimeout(pending.current);
  }, [name, projectFilter, from, to, push]);

  function formatCell(created_at) {
    const text = String(created_at ?? '');
    const iso = !text.includes('T') && text.includes(' ')
      ? `${text.replace(' ', 'T')}Z`
      : text;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return { date: text, time: '' };
    // Locale and time zone are pinned: left to the environment the Node server
    // and the browser disagree on both, which React reports as a hydration
    // mismatch and recovers from by re-rendering the whole page on the client.
    return {
      date: d.toLocaleDateString('en-US', { timeZone: 'UTC' }),
      time: d.toLocaleTimeString('en-US', {
        timeZone: 'UTC',
        hour: '2-digit',
        minute: '2-digit',
      }),
    };
  }

function parseTicketsDetail(row) {
  if (row.tickets_detail) {
    try {
      const parsed =
        typeof row.tickets_detail === 'string'
          ? JSON.parse(row.tickets_detail)
          : row.tickets_detail;
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {
      // ignore
    }
  }
  if (row.linked_ticket_id) {
    const key = `${(row.linked_key || 'TM').toUpperCase()}-${row.linked_ticket_id}`;
    return [
      {
        id: row.linked_ticket_id,
        key,
        title: row.task_title,
        status: row.task_state === 'completed' ? 'Completed' : 'In Progress',
        workState: row.task_state,
        taskStatus: row.task_state === 'completed' ? 'Completed' : 'In Progress',
        blocker: row.blocker || '',
        project_id: row.linked_project_id,
      },
    ];
  }
  return [];
}

  function downloadTaskCsv() {
    const csvCell = (v) => {
      const s = String(v ?? '');
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = [
      'Date',
      'Time',
      'Name',
      'Project',
      'Hours',
      'Task title',
      'Task description',
      'Task state',
      'Work items',
      'Ticket statuses',
      'Blockers',
    ];
    const lines = [
      header.map(csvCell).join(','),
      ...rows.map((r) => {
        const { date, time } = formatCell(r.created_at);
        const tickets = parseTicketsDetail(r);
        const keys =
          tickets.map((t) => `#${t.key}`).join('; ') ||
          (r.linked_ticket_id
            ? `#${(r.linked_key || 'TM').toUpperCase()}-${r.linked_ticket_id}`
            : '');
        const ticketStatuses = tickets
          .map(
            (t) =>
              `${t.key}: ${
                t.workState === 'completed'
                  ? (t.taskStatus || 'Completed')
                  : t.taskStatus || 'Not Completed'
              }`
          )
          .join('; ');
        const ticketBlockers =
          tickets
            .filter((t) => t.workState === 'not_completed' && t.blocker)
            .map((t) => `${t.key}: ${t.blocker}`)
            .join('; ') || r.blocker || '';
        return [
          date,
          time,
          r.name,
          r.project,
          r.hours_worked,
          r.task_title,
          r.task_description,
          STATE_META[r.task_state]?.label || r.task_state,
          keys,
          ticketStatuses,
          ticketBlockers,
        ]
          .map(csvCell)
          .join(',');
      }),
    ];
    const blob = new Blob([`\ufeff${lines.join('\n')}`], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `task-sheet-${new Date().toISOString().slice(0, 7)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function downloadTaskImage() {
    try {
      downloadTaskSheetPng(rows, {
        filters: { name, project: projectFilter, from, to },
      });
    } catch {
      push({ message: 'Could not create the image.', tone: 'error' });
    }
  }

  const byName = rows.reduce((acc, r) => {
    acc[r.name] = (acc[r.name] || 0) + 1;
    return acc;
  }, {});
  const byProject = rows.reduce((acc, r) => {
    acc[r.project] = (acc[r.project] || 0) + 1;
    return acc;
  }, {});

  const taskCount = rows.length;
  const happyCount = happyInitial?.length ?? 0;

  const subtitle =
    tab === 'task'
      ? `${taskCount} rows${
          taskCount ? ` · ${Object.keys(byName).length} people · ${Object.keys(byProject).length} projects` : ''
        }`
      : `${happyCount} answer${happyCount === 1 ? '' : 's'} · the team's happy sheet, by day`;

  return (
    <AppShell
      currentUser={currentUser}
      projects={projects}
      projectCounts={projectCounts}
      myIssuesCount={myIssuesCount}
      view="task-sheet-history"
      onProjectChange={(id) => router.push(`/?project=${id}`)}
      onCreate={() => {}}
    >
      <div className="board">
        <PageHeader
          breadcrumb={[
            { label: 'Issues', href: '/' },
            { label: 'Task Sheet', href: '/task-sheet' },
            { label: 'History' },
          ]}
          title={tab === 'task' ? 'Task Sheet History' : 'Happy Sheet History'}
          icon={tab === 'task' ? <ClipboardIcon /> : <SmileIcon />}
          subtitle={subtitle}
        />

        <div className="tab-bar" role="tablist" aria-label="Sheet history">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'task'}
            className={`tab${tab === 'task' ? ' active' : ''}`}
            onClick={() => setTab('task')}
          >
            Task Sheet
            <span className="nav-count">{taskCount}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'happy'}
            className={`tab${tab === 'happy' ? ' active' : ''}`}
            onClick={() => setTab('happy')}
          >
            Happy Sheet
            <span className="nav-count">{happyCount}</span>
          </button>
        </div>

        {tab === 'task' ? (
          <div className="list-frame">
            <div className="ts-filters" role="search" aria-label="Filter task sheet">
              <select
                value={name}
                aria-label="Filter by name"
                onChange={(e) => setName(e.target.value)}
              >
                <option value="">All names</option>
                {(facets?.names || []).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
              <select
                value={projectFilter}
                aria-label="Filter by project"
                onChange={(e) => setProjectFilter(e.target.value)}
              >
                <option value="">All projects</option>
                {(facets?.projects || []).map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <label className="ts-filter-date">
                <span className="visually-hidden">From date</span>
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </label>
              <span className="ts-date-sep" aria-hidden="true">
                to
              </span>
              <label className="ts-filter-date">
                <span className="visually-hidden">To date</span>
                <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </label>
              <span className="ts-filter-spacer" aria-hidden="true" />
              <button
                type="button"
                className="btn btn-secondary"
                onClick={downloadTaskCsv}
                disabled={taskCount === 0}
              >
                Download CSV
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={downloadTaskImage}
                disabled={taskCount === 0}
              >
                Download image
              </button>
              {(name || projectFilter || from || to) && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => {
                    setName('');
                    setProjectFilter('');
                    setFrom('');
                    setTo('');
                  }}
                >
                  Clear
                </button>
              )}
            </div>

            <div
              className="list-scroll"
              role="region"
              aria-label="Task sheet history"
              tabIndex={0}
            >
              {taskCount === 0 ? (
                <EmptyState
                  title={name || projectFilter || from || to ? 'No rows match these filters' : 'No task sheet rows yet'}
                  text="Rows appear here as soon as someone submits the daily task sheet."
                >
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => router.push('/task-sheet')}
                  >
                    Open the task sheet
                  </button>
                </EmptyState>
              ) : (
                <table className="list-table">
                  <thead>
                    <tr>
                      <th className="list-th">Date</th>
                      <th className="list-th">Name</th>
                      <th className="list-th">Project</th>
                      <th className="list-th list-th-num">Hours</th>
                      <th className="list-th">Task</th>
                      <th className="list-th">State</th>
                      <th className="list-th">Work item</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const { date } = formatCell(row.created_at);
                      return (
                        <tr key={row.id}>
                          <td className="list-cell">{date}</td>
                          <td className="list-cell">
                            <strong>{row.name}</strong>
                            {row.submitted_by_name && row.name !== row.submitted_by_name && (
                              <span className="list-cell-note">
                                filed by {row.submitted_by_name}
                              </span>
                            )}
                          </td>
                          <td className="list-cell">{row.project}</td>
                          <td className="list-cell list-cell-num">{row.hours_worked}h</td>
                          <td className="list-cell">
                            {(() => {
                              const tickets = parseTicketsDetail(row);
                              if (tickets.length > 0) {
                                return (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                    {row.task_title && (
                                      <div>
                                        <span className="list-title">{row.task_title}</span>
                                        {row.task_description && (
                                          <span className="list-cell-note">{row.task_description}</span>
                                        )}
                                      </div>
                                    )}
                                    {tickets.map((t) => {
                                      const isDone = t.workState === 'completed';
                                      const statusText = isDone ? (t.taskStatus || 'Completed') : (t.taskStatus || 'Not Completed');
                                      return (
                                        <div
                                          key={t.id || t.key}
                                          style={{
                                            padding: '4px 8px',
                                            borderRadius: '4px',
                                            background: 'var(--subtle-bg, rgba(0,0,0,0.02))',
                                            border: '1px solid var(--border-subtle, rgba(0,0,0,0.06))',
                                            fontSize: '12px',
                                          }}
                                        >
                                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                            <strong style={{ color: 'var(--text-color, #172b4d)' }}>#{t.key}</strong>
                                            {t.title && <span style={{ color: 'var(--text-muted, #626f86)' }}>{t.title}</span>}
                                            <span
                                              style={{
                                                marginLeft: 'auto',
                                                padding: '1px 6px',
                                                borderRadius: '3px',
                                                fontSize: '11px',
                                                fontWeight: 600,
                                                background: isDone ? '#d4f7dc' : '#eef0f4',
                                                color: isDone ? '#1f8a3d' : '#626f86',
                                              }}
                                            >
                                              {statusText}
                                            </span>
                                          </div>
                                          {!isDone && t.blocker && (
                                            <div
                                              style={{
                                                marginTop: '4px',
                                                color: '#ae2e24',
                                                fontSize: '11px',
                                                display: 'flex',
                                                gap: '4px',
                                              }}
                                            >
                                              <span style={{ fontWeight: 600 }}>Blocker:</span>
                                              <span>{t.blocker}</span>
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                );
                              }
                              return (
                                <>
                                  <span className="list-title">{row.task_title}</span>
                                  <span className="list-cell-note">{row.task_description}</span>
                                  {row.blocker && (
                                    <span className="list-cell-note ts-blocker-note" title={row.blocker}>
                                      Blocked by: {row.blocker}
                                    </span>
                                  )}
                                </>
                              );
                            })()}
                          </td>
                          <td className="list-cell">
                            <span
                              className={`ts-state-lozenge ${STATE_META[row.task_state]?.className || ''}`}
                            >
                              <ClockIcon size={12} />
                              {STATE_META[row.task_state]?.label || row.task_state}
                            </span>
                          </td>
                          <td className="list-cell">
                            {(() => {
                              const tickets = parseTicketsDetail(row);
                              if (tickets.length > 0) {
                                return (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                    {tickets.map((t) => {
                                      const projId = t.project_id || row.linked_project_id;
                                      const key = t.key || (t.id ? `TM-${t.id}` : '');
                                      const href = projId
                                        ? `/projects/${projId}/list?selectedIssue=${encodeURIComponent(key)}`
                                        : `/work-items?selectedIssue=${encodeURIComponent(key)}`;
                                      return (
                                        <a
                                          key={t.id || t.key}
                                          className="ts-ticket-link"
                                          href={href}
                                          title={`View #${key} on board`}
                                        >
                                          #{key}
                                        </a>
                                      );
                                    })}
                                  </div>
                                );
                              }
                              if (row.linked_ticket_id) {
                                const key = `${(row.linked_key || 'TM').toUpperCase()}-${row.linked_ticket_id}`;
                                return row.linked_project_id ? (
                                  <a
                                    className="ts-ticket-link"
                                    href={`/projects/${row.linked_project_id}/list?selectedIssue=${encodeURIComponent(key)}`}
                                  >
                                    #{key}
                                  </a>
                                ) : (
                                  <span className="ts-muted">#{key}</span>
                                );
                              }
                              return <span className="ts-muted">—</span>;
                            })()}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        ) : (
          <div className="list-frame">
            <HappySheetHistoryView initial={happyInitial || []} facets={happyFacets || {}} />
          </div>
        )}
      </div>

      <Toaster toasts={toasts} onDismiss={dismiss} onPause={pause} onResume={resume} />
    </AppShell>
  );
}
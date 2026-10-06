'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import EmptyState from '@/components/EmptyState';
import { SmileIcon } from '@/components/AppShellIcons';

/**
 * The admin's view of the team's happy sheet.
 *
 * This is the deliberately simpler cousin of the task sheet history: a month
 * picker instead of a wall of date controls, because reading a mood over a
 * calendar is a "which month" question rather than a "which week" one, plus
 * the same name filter, a date sort, and a download that carries exactly what
 * the current filters just showed. The mood does not need hours or projects
 * next to it, so it does not get them.
 */
export default function HappySheetHistoryView({ initial, facets }) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [name, setName] = useState('');
  const [month, setMonth] = useState('');
  const [sort, setSort] = useState('desc');
  const [error, setError] = useState('');
  const pending = useRef(null);

  const filtered = useMemo(() => {
    const list = [...(rows || [])];
    if (sort === 'asc') list.reverse();
    return list;
  }, [rows, sort]);

  useEffect(() => {
    clearTimeout(pending.current);
    pending.current = setTimeout(async () => {
      const params = new URLSearchParams();
      if (name) params.set('name', name);
      if (month) params.set('month', month);
      try {
        const res = await fetch(`/api/happy-sheet?${params.toString()}`);
        const data = await res.json();
        if (res.ok) {
          setRows(data.submissions || []);
          setError('');
        } else {
          setError(data.error || 'Could not load the happy sheet.');
        }
      } catch {
        setError('Could not load the happy sheet.');
      }
    }, 250);
    return () => clearTimeout(pending.current);
  }, [name, month]);

  function formatCell(created_at) {
    const text = String(created_at ?? '');
    const iso = !text.includes('T') && text.includes(' ')
      ? `${text.replace(' ', 'T')}Z`
      : text;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return { date: text, time: '' };
    return {
      date: d.toLocaleDateString(),
      time: d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
  }

  // A thousand rows is fine to hand to a spreadsheet; the download mirrors the
  // filters on screen, so what the admin just read is what the file carries.
  function downloadCsv() {
    const csvCell = (v) => {
      const s = String(v ?? '');
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = [
      'Date',
      'Time',
      'Name',
      'What made your day happy',
      'Did you make anybody else happy',
    ];
    const lines = [
      header.map(csvCell).join(','),
      ...filtered.map((r) => {
        const { date, time } = formatCell(r.created_at);
        return [date, time, r.name, r.happy_one, r.happy_others]
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
    a.download = `happy-sheet-${month || new Date().toISOString().slice(0, 7)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const hasFilters = Boolean(name || month);
  const empty = (rows || []).length === 0;

  return (
    <>
      {error && (
        <div className="ts-banner" role="alert">
          <strong>Happy sheet not loaded.</strong> {error}
        </div>
      )}
      <div className="ts-filters" role="search" aria-label="Filter happy sheet">
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
        <label className="ts-filter-date">
          <span className="visually-hidden">Month</span>
          <input
            type="month"
            value={month}
            aria-label="Month"
            onChange={(e) => setMonth(e.target.value)}
          />
        </label>
        <select
          value={sort}
          aria-label="Sort by date"
          onChange={(e) => setSort(e.target.value)}
        >
          <option value="desc">Newest first</option>
          <option value="asc">Oldest first</option>
        </select>
        <span className="ts-filter-spacer" aria-hidden="true" />
        <button
          type="button"
          className="btn btn-secondary"
          onClick={downloadCsv}
          disabled={empty}
        >
          Download CSV
        </button>
        {hasFilters && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setName('');
              setMonth('');
            }}
          >
            Clear
          </button>
        )}
      </div>

      <div className="list-scroll" role="region" aria-label="Happy sheet history" tabIndex={0}>
        {empty ? (
          <EmptyState
            icon={<SmileIcon size={32} />}
            title={hasFilters ? 'No rows match these filters' : 'No happy sheet rows yet'}
            text={
              hasFilters
                ? 'Try a different month or name.'
                : 'Answers appear here as soon as someone fills in the happy sheet.'
            }
          >
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => router.push('/task-sheet')}
            >
              Open the happy sheet
            </button>
          </EmptyState>
        ) : (
          <table className="list-table">
            <thead>
              <tr>
                <th className="list-th">Date</th>
                <th className="list-th">Time</th>
                <th className="list-th">Name</th>
                <th className="list-th">What made your day happy</th>
                <th className="list-th">Made anybody else happy</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const { date, time } = formatCell(row.created_at);
                return (
                  <tr key={row.id}>
                    <td className="list-cell">{date}</td>
                    <td className="list-cell">{time}</td>
                    <td className="list-cell">
                      <strong>{row.name}</strong>
                      {row.submitted_by_name && row.name !== row.submitted_by_name && (
                        <span className="list-cell-note">
                          filed by {row.submitted_by_name}
                        </span>
                      )}
                    </td>
                    <td className="list-cell hs-answer">{row.happy_one}</td>
                    <td className="list-cell hs-answer is-muted">
                      {row.happy_others || <span className="ts-muted">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import EmptyState from '@/components/EmptyState';
import { SmileIcon } from '@/components/AppShellIcons';
import downloadHappySheetPng from '@/components/happySheetPng';

/**
 * The admin's view of the team's happy sheet.
 *
 * This is the deliberately simpler cousin of the task sheet history: a single
 * day picker instead of a wall of date controls, plus the same name filter, a
 * date sort, and a download that carries exactly what the current filters just
 * showed. The mood does not need hours or projects next to it, so it does not
 * get them.
 */
export default function HappySheetHistoryView({ initial, facets }) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [name, setName] = useState('');
  const [day, setDay] = useState('');
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
      if (day) params.set('day', day);
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
  }, [name, day]);

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
      'Goals & Self-Satisfaction',
      'Dreams',
    ];
    const lines = [
      header.map(csvCell).join(','),
      ...filtered.map((r) => {
        const { date, time } = formatCell(r.created_at);
        return [
          date,
          time,
          r.name,
          r.happy_one,
          r.happy_others,
          r.happy_goals,
          r.happy_dreams,
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
    a.download = `happy-sheet-${day || new Date().toISOString().slice(0, 7)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const hasFilters = Boolean(name || day);
  const empty = (rows || []).length === 0;

  function downloadImage() {
    try {
      downloadHappySheetPng(filtered, { day });
      setError('');
    } catch {
      setError('Could not create the image.');
    }
  }

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
          <span className="visually-hidden">Day</span>
          <input
            type="date"
            value={day}
            aria-label="Day"
            onChange={(e) => setDay(e.target.value)}
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
        <button
          type="button"
          className="btn btn-secondary"
          onClick={downloadImage}
          disabled={empty}
        >
          Download image
        </button>
        {hasFilters && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setName('');
              setDay('');
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
                ? 'Try a different day or name.'
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
                <th className="list-th">Goals &amp; Self-Satisfaction</th>
                <th className="list-th">Dreams</th>
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
                    <td className="list-cell hs-answer">{row.happy_goals}</td>
                    <td className="list-cell hs-answer">{row.happy_dreams}</td>
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
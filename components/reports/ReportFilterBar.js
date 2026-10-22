'use client';

import { useState } from 'react';
import { DATE_PRESETS } from '@/lib/dateFilters';

export default function ReportFilterBar({
  filters,
  onChange,
  projects = [],
  employees = [],
  departments = [],
  clients = [],
  supportedFilters = ['date_range', 'project', 'employee', 'search'],
}) {
  const [customOpen, setCustomOpen] = useState(filters.preset === 'custom');

  const hasActiveFilters = Boolean(
    (filters.preset && filters.preset !== 'this_month') ||
    filters.startDate ||
    filters.endDate ||
    (filters.projectId && filters.projectId !== 'all') ||
    (filters.employeeId && filters.employeeId !== 'all') ||
    (filters.department && filters.department !== 'all') ||
    (filters.status && filters.status !== 'all') ||
    (filters.priority && filters.priority !== 'all') ||
    (filters.clientId && filters.clientId !== 'all') ||
    (filters.search && filters.search.trim() !== '')
  );

  function handlePresetChange(preset) {
    if (preset === 'custom') {
      setCustomOpen(true);
      onChange({ ...filters, preset: 'custom' });
    } else {
      setCustomOpen(false);
      onChange({ ...filters, preset, startDate: '', endDate: '' });
    }
  }

  function handleCustomDates(e) {
    e.preventDefault();
    onChange({ ...filters, preset: 'custom' });
  }

  function handleReset() {
    setCustomOpen(false);
    onChange({
      preset: 'this_month',
      startDate: '',
      endDate: '',
      projectId: 'all',
      employeeId: 'all',
      department: 'all',
      status: 'all',
      priority: 'all',
      clientId: 'all',
      search: '',
    });
  }

  return (
    <div className="rpt-filter-bar">
      <div className="rpt-filter-row">
        {/* Date presets */}
        {supportedFilters.includes('date_range') && (
          <div className="rpt-filter-group">
            <span className="rpt-filter-label">Period:</span>
            <div className="rpt-btn-group" role="group" aria-label="Date presets">
              {DATE_PRESETS.map((p) => {
                const isActive = (filters.preset || 'this_month') === p.key;
                return (
                  <button
                    key={p.key}
                    type="button"
                    className={`rpt-preset-btn${isActive ? ' active' : ''}`}
                    onClick={() => handlePresetChange(p.key)}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Custom date range inputs */}
        {customOpen && supportedFilters.includes('date_range') && (
          <form className="rpt-custom-date-form" onSubmit={handleCustomDates} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <input
              type="date"
              className="rpt-input"
              value={filters.startDate || ''}
              onChange={(e) => onChange({ ...filters, preset: 'custom', startDate: e.target.value })}
              aria-label="Start Date"
            />
            <span className="rpt-date-sep">to</span>
            <input
              type="date"
              className="rpt-input"
              value={filters.endDate || ''}
              onChange={(e) => onChange({ ...filters, preset: 'custom', endDate: e.target.value })}
              aria-label="End Date"
            />
            <button type="submit" className="rpt-preset-btn active" style={{ padding: '4px 10px', fontSize: '12px' }}>
              Apply
            </button>
          </form>
        )}

        {/* Client Selector */}
        {(supportedFilters.includes('client') || (clients && clients.length > 0)) && (
          <div className="rpt-filter-group">
            <span className="rpt-filter-label">Client:</span>
            <select
              className="rpt-select"
              value={filters.clientId || 'all'}
              onChange={(e) => onChange({ ...filters, clientId: e.target.value })}
              aria-label="Filter by client"
            >
              <option value="all">All Clients</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name || `Client #${c.id}`}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Dynamic Project Selector */}
        {supportedFilters.includes('project') && (
          <div className="rpt-filter-group">
            <span className="rpt-filter-label">Project:</span>
            <select
              className="rpt-select"
              value={filters.projectId || 'all'}
              onChange={(e) => onChange({ ...filters, projectId: e.target.value })}
              aria-label="Filter by project"
            >
              <option value="all">All Projects</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.key})
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Employee Filter */}
        {supportedFilters.includes('employee') && (
          <div className="rpt-filter-group">
            <span className="rpt-filter-label">Employee:</span>
            <select
              className="rpt-select"
              value={filters.employeeId || 'all'}
              onChange={(e) => onChange({ ...filters, employeeId: e.target.value })}
              aria-label="Filter by employee"
            >
              <option value="all">All Employees</option>
              {employees.map((e) => (
                <option key={e.id} value={e.user_id || e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Department Filter */}
        {supportedFilters.includes('department') && (
          <div className="rpt-filter-group">
            <span className="rpt-filter-label">Dept:</span>
            <select
              className="rpt-select"
              value={filters.department || 'all'}
              onChange={(e) => onChange({ ...filters, department: e.target.value })}
              aria-label="Filter by department"
            >
              <option value="all">All Departments</option>
              {departments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Status Filter */}
        {supportedFilters.includes('status') && (
          <div className="rpt-filter-group">
            <span className="rpt-filter-label">Status:</span>
            <select
              className="rpt-select"
              value={filters.status || 'all'}
              onChange={(e) => onChange({ ...filters, status: e.target.value })}
              aria-label="Filter by status"
            >
              <option value="all">All Statuses</option>
              <option value="open">Open</option>
              <option value="in_progress">In Progress</option>
              <option value="resolved">Resolved</option>
              <option value="closed">Closed</option>
            </select>
          </div>
        )}

        {/* Priority Filter */}
        {supportedFilters.includes('priority') && (
          <div className="rpt-filter-group">
            <span className="rpt-filter-label">Priority:</span>
            <select
              className="rpt-select"
              value={filters.priority || 'all'}
              onChange={(e) => onChange({ ...filters, priority: e.target.value })}
              aria-label="Filter by priority"
            >
              <option value="all">All Priorities</option>
              <option value="urgent">Urgent</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>
        )}

        {/* Search Input */}
        {supportedFilters.includes('search') && (
          <div className="rpt-filter-search">
            <input
              type="text"
              className="rpt-input rpt-search-input"
              placeholder="Search in report..."
              value={filters.search || ''}
              onChange={(e) => onChange({ ...filters, search: e.target.value })}
              aria-label="Search report records"
            />
          </div>
        )}

        {/* Reset / Clear Filters Button */}
        {hasActiveFilters && (
          <div className="rpt-filter-group" style={{ marginLeft: 'auto' }}>
            <button
              type="button"
              className="rpt-preset-btn"
              onClick={handleReset}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                color: '#de350b',
                borderColor: '#ffbdad',
                background: '#ffebe6',
                fontWeight: 600,
                cursor: 'pointer',
              }}
              title="Reset all filters to default"
            >
              ✕ Reset Filters
            </button>
          </div>
        )}
      </div>
    </div>
  );
}


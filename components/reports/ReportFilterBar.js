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
  sectionSlug = '',
  reportSlug = '',
  supportedFilters = ['date_range', 'project', 'employee', 'search'],
}) {
  const [isCollapsed, setIsCollapsed] = useState(false);
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

  // Contextual status options based on section and report domain
  let statusOptions = [
    { value: 'open', label: 'Open' },
    { value: 'in_progress', label: 'In Progress' },
    { value: 'resolved', label: 'Resolved' },
    { value: 'closed', label: 'Closed' },
  ];

  if (
    sectionSlug === 'salary-payroll-and-cost' ||
    ['salary-summary', 'payroll-register', 'salary-payment-status', 'total-payroll-cost'].includes(reportSlug)
  ) {
    statusOptions = [
      { value: 'paid', label: 'Paid' },
      { value: 'pending', label: 'Pending' },
      { value: 'processing', label: 'Processing' },
    ];
  } else if (
    reportSlug === 'employee-onboarding-exit' ||
    reportSlug === 'access-and-permission' ||
    reportSlug === 'policy-and-document-expiry'
  ) {
    statusOptions = [
      { value: 'active', label: 'Active' },
      { value: 'inactive', label: 'Inactive / Exited' },
    ];
  } else if (
    sectionSlug === 'finance-and-startup-expense' ||
    ['accounts-payable', 'invoice-and-collection'].includes(reportSlug)
  ) {
    statusOptions = [
      { value: 'paid', label: 'Paid' },
      { value: 'unpaid', label: 'Unpaid' },
      { value: 'overdue', label: 'Overdue' },
    ];
  } else if (reportSlug === 'daily-work') {
    statusOptions = [
      { value: 'completed', label: 'Completed' },
      { value: 'not_completed', label: 'In Progress / Blocked' },
    ];
  } else if (reportSlug === 'data-backup-and-system-health') {
    statusOptions = [
      { value: 'healthy', label: 'Healthy / Green' },
      { value: 'warning', label: 'Warning' },
      { value: 'critical', label: 'Critical' },
    ];
  }

  // Gather active filter summary items to display when collapsed (and in the panel header)
  const activeSummaryItems = [];
  if (supportedFilters.includes('date_range')) {
    if (filters.preset === 'custom') {
      activeSummaryItems.push({
        label: 'Period',
        value: `${filters.startDate || 'Start'} to ${filters.endDate || 'End'}`,
      });
    } else {
      const presetObj = DATE_PRESETS.find((p) => p.key === (filters.preset || 'this_month'));
      activeSummaryItems.push({
        label: 'Period',
        value: presetObj ? presetObj.label : 'This Month',
      });
    }
  }

  if (supportedFilters.includes('client') && filters.clientId && filters.clientId !== 'all') {
    const c = clients.find((item) => String(item.id) === String(filters.clientId));
    activeSummaryItems.push({ label: 'Client', value: c ? c.name : `Client #${filters.clientId}` });
  }

  if (supportedFilters.includes('project') && filters.projectId && filters.projectId !== 'all') {
    const p = projects.find((item) => String(item.id) === String(filters.projectId));
    activeSummaryItems.push({ label: 'Project', value: p ? p.name : `Project #${filters.projectId}` });
  }

  if (supportedFilters.includes('employee') && filters.employeeId && filters.employeeId !== 'all') {
    const emp = employees.find((item) => String(item.id) === String(filters.employeeId));
    activeSummaryItems.push({ label: 'Employee', value: emp ? emp.name : `Employee #${filters.employeeId}` });
  }

  if (supportedFilters.includes('department') && filters.department && filters.department !== 'all') {
    activeSummaryItems.push({ label: 'Dept', value: filters.department });
  }

  if (supportedFilters.includes('status') && filters.status && filters.status !== 'all') {
    const s = statusOptions.find((opt) => opt.value === filters.status);
    activeSummaryItems.push({ label: 'Status', value: s ? s.label : filters.status });
  }

  if (supportedFilters.includes('priority') && filters.priority && filters.priority !== 'all') {
    activeSummaryItems.push({ label: 'Priority', value: filters.priority.toUpperCase() });
  }

  if (supportedFilters.includes('search') && filters.search && filters.search.trim() !== '') {
    activeSummaryItems.push({ label: 'Search', value: `"${filters.search.trim()}"` });
  }

  const nonDefaultCount = activeSummaryItems.filter((item) => {
    if (item.label === 'Period') {
      return (filters.preset && filters.preset !== 'this_month') || filters.startDate || filters.endDate;
    }
    return true;
  }).length;

  return (
    <div className={`rpt-filters-panel${isCollapsed ? ' is-collapsed' : ''}`}>
      {/* Collapsible Panel Header */}
      <div className="rpt-filters-panel-head">
        <div
          className="rpt-filters-head-clickable"
          onClick={() => setIsCollapsed(!isCollapsed)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setIsCollapsed(!isCollapsed);
            }
          }}
          title={isCollapsed ? 'Click to expand filters' : 'Click to collapse filters'}
        >
          <div className="rpt-filters-head-title">
            <svg
              className="rpt-filters-icon"
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
            </svg>
            <span className="rpt-filters-title-text">Filters</span>
            <span className={`rpt-filters-count-pill${nonDefaultCount > 0 ? ' has-active' : ''}`}>
              {nonDefaultCount > 0 ? `${nonDefaultCount} active` : 'Default'}
            </span>
          </div>

          {/* Applied filters summary visible in header / when collapsed */}
          <div className="rpt-filters-summary-pills">
            {activeSummaryItems.map((item, idx) => (
              <span key={idx} className="rpt-filter-pill-tag">
                <strong>{item.label}:</strong> {item.value}
              </span>
            ))}
          </div>
        </div>

        <div className="rpt-filters-head-actions">
          {hasActiveFilters && (
            <button
              type="button"
              className="rpt-filter-reset-link"
              onClick={handleReset}
              title="Reset all filters to default"
            >
              ✕ Reset
            </button>
          )}

          <button
            type="button"
            className="rpt-filters-toggle-btn"
            onClick={() => setIsCollapsed(!isCollapsed)}
            aria-expanded={!isCollapsed}
            title={isCollapsed ? 'Expand filter controls' : 'Collapse filter controls'}
          >
            <span>{isCollapsed ? 'Show Filters' : 'Hide Filters'}</span>
            <svg
              viewBox="0 0 24 24"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{
                transform: isCollapsed ? 'rotate(0deg)' : 'rotate(180deg)',
                transition: 'transform 0.2s ease',
              }}
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
        </div>
      </div>

      {/* Expandable Filter Controls Body */}
      {!isCollapsed && (
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
            {supportedFilters.includes('client') && (
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
                    <option key={e.id} value={e.id}>
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
                  {statusOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
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

            {/* Reset / Clear Filters Button in controls row */}
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
      )}
    </div>
  );
}

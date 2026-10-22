'use client';

import { useState, useRef } from 'react';
import Link from 'next/link';
import AppShell from '../AppShell';
import ReportNav from './ReportNav';
import ReportFilterBar from './ReportFilterBar';
import KpiCard from './KpiCard';
import { DonutChart, BarChart, TrendChart } from './ReportCharts';
import ReportTable from './ReportTable';
import ReportExportMenu from './ReportExportMenu';

export default function ReportDetailClient({
  section,
  reportDef,
  initialData,
  projects = [],
  employees = [],
  currentUser,
}) {
  const [data, setData] = useState(initialData);
  const [filters, setFilters] = useState({
    preset: initialData.dateRange?.preset || 'this_month',
    startDate: initialData.dateRange?.startDate || '',
    endDate: initialData.dateRange?.endDate || '',
    projectId: 'all',
    employeeId: 'all',
    department: 'all',
    status: 'all',
    priority: 'all',
    clientId: 'all',
    search: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const reqSeqRef = useRef(0);

  // Extract departments
  const departments = [...new Set(employees.map((e) => e.department).filter(Boolean))];

  async function handleFilterChange(nextFilters) {
    const seq = ++reqSeqRef.current;
    setFilters(nextFilters);
    setLoading(true);
    setError('');

    try {
      const query = new URLSearchParams({
        preset: nextFilters.preset || 'this_month',
        startDate: nextFilters.startDate || '',
        endDate: nextFilters.endDate || '',
        projectId: nextFilters.projectId || 'all',
        employeeId: nextFilters.employeeId || 'all',
        department: nextFilters.department || 'all',
        status: nextFilters.status || 'all',
        priority: nextFilters.priority || 'all',
        clientId: nextFilters.clientId || 'all',
        search: nextFilters.search || '',
      });

      // Synchronize browser URL query parameters without full reload
      if (typeof window !== 'undefined' && window.history?.replaceState) {
        const url = new URL(window.location.href);
        query.forEach((val, key) => {
          if (val && val !== 'all' && !(key === 'preset' && val === 'this_month')) {
            url.searchParams.set(key, val);
          } else {
            url.searchParams.delete(key);
          }
        });
        window.history.replaceState(null, '', url.pathname + (url.search ? url.search : ''));
      }

      const res = await fetch(`/api/reports/${reportDef.slug}?${query.toString()}`);
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || 'Failed to update report data');
      }
      const updated = await res.json();
      if (seq === reqSeqRef.current) {
        setData(updated);
      }
    } catch (err) {
      if (seq === reqSeqRef.current) {
        setError(err.message);
      }
    } finally {
      if (seq === reqSeqRef.current) {
        setLoading(false);
      }
    }
  }

  const kpis = data.kpis || [];
  const columns = data.columns || [];
  const rows = data.rows || [];
  const series = data.series || [];
  const chartType = data.chartType || reportDef.chartType || 'bar';

  return (
    <AppShell
      currentUser={currentUser}
      projects={projects}
      projectCounts={{}}
      view="report-detail"
    >
      <div className="rpt-detail-page">
        {/* Navigation Breadcrumb */}
        <ReportNav currentSectionSlug={section.slug} currentReportSlug={reportDef.title} />

        {/* Header */}
        <div className="rpt-detail-header">
          <div className="rpt-detail-title-block">
            <div className="rpt-detail-meta">
              <span className="rpt-detail-badge" style={{ backgroundColor: section.color }}>
                Report #{reportDef.id}
              </span>
              <span className="rpt-detail-cadence">Standard Frequency: {reportDef.frequency}</span>
              <span className="rpt-detail-section">{section.title}</span>
            </div>
            <h1 className="rpt-detail-title">{reportDef.title}</h1>
            <p className="rpt-detail-desc">{reportDef.description}</p>
          </div>

          <div className="rpt-detail-actions">
            <ReportExportMenu
              title={reportDef.title}
              dateRangeLabel={data.dateRange?.label}
              filtersApplied={filters}
              columns={columns}
              rows={rows}
            />
          </div>
        </div>

        {/* Important Info Card */}
        <div className="rpt-info-banner">
          <div className="rpt-info-icon">📋</div>
          <div className="rpt-info-content">
            <span className="rpt-info-title">Catalogue Measurement Definition:</span>
            <span className="rpt-info-text">{reportDef.importantInfo}</span>
          </div>
        </div>

        {/* Filter Bar */}
        <ReportFilterBar
          filters={filters}
          onChange={handleFilterChange}
          projects={projects}
          employees={employees}
          departments={departments}
          supportedFilters={reportDef.filters || ['date_range', 'project', 'employee', 'search']}
        />

        {error && <div className="rpt-alert rpt-alert-error">{error}</div>}
        {loading && <div className="rpt-loading-indicator">Computing report analytics...</div>}

        {/* Unavailable notice if data is not yet integrated */}
        {data.unavailableNotice && (
          <div className="rpt-unavailable-box">
            <div className="rpt-unavailable-icon">⚠️</div>
            <div className="rpt-unavailable-text">
              <h4>Source Data Awaiting Integration</h4>
              <p>{data.unavailableNotice}</p>
              <div className="rpt-unavailable-boundary">
                <span>Boundary Specification:</span> Database model does not currently collect this
                external hardware or third-party accounting data. Empty state preserved per
                catalogue requirements.
              </div>
            </div>
          </div>
        )}

        {/* KPI Cards */}
        {kpis.length > 0 && (
          <div className="rpt-kpi-grid">
            {kpis.map((k) => (
              <KpiCard
                key={k.key}
                title={k.label}
                value={k.value}
                subtitle={k.subtitle}
                tone={k.tone}
              />
            ))}
          </div>
        )}

        {/* Visual Charts */}
        {series.length > 0 && !data.unavailableNotice && (
          <div className="rpt-card rpt-chart-card">
            <div className="rpt-card-head">
              <h3 className="rpt-card-title">{reportDef.title} Visualization</h3>
              <span className="rpt-card-meta">{data.dateRange?.label}</span>
            </div>
            <div className="rpt-card-body">
              {chartType === 'donut' && <DonutChart data={series} size={190} />}
              {chartType === 'bar' && <BarChart data={series} height={220} />}
              {chartType === 'trend' && <TrendChart data={series} height={220} />}
            </div>
          </div>
        )}

        {/* Data Table */}
        <div className="rpt-card rpt-table-card">
          <div className="rpt-card-head">
            <h3 className="rpt-card-title">Filtered Records & Source Traceability</h3>
            <span className="rpt-card-meta">
              {rows.length} {rows.length === 1 ? 'record' : 'records'} found
            </span>
          </div>
          <div className="rpt-card-body">
            <ReportTable
              columns={columns}
              rows={rows}
              unavailableNotice={data.unavailableNotice}
              pageSize={20}
            />
          </div>
        </div>
      </div>
    </AppShell>
  );
}


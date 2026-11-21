'use client';

import { useState, useTransition } from 'react';
import AppShell from '@/components/AppShell';

export default function WeeklyAiReportsClient({
  currentUser,
  projects = [],
  initialRuns = [],
  nextSaturdayLabel = '',
}) {
  const [runs, setRuns] = useState(initialRuns);
  const [periodType, setPeriodType] = useState('weekly_sat');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [projectScope, setProjectScope] = useState('all');
  const [selectedProjectIds, setSelectedProjectIds] = useState([]);
  const [includeAi, setIncludeAi] = useState(true);
  const [deliveryMode, setDeliveryMode] = useState('download_only'); // 'download_only' | 'email_mgmt' | 'email_all'

  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState(null);
  const [latestResult, setLatestResult] = useState(null);

  // Email confirmation modal
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [recipientPreview, setRecipientPreview] = useState(null);
  const [isLoadingRecipients, setIsLoadingRecipients] = useState(false);

  // Retry state
  const [retryingRunId, setRetryingRunId] = useState(null);
  const [retryMessage, setRetryMessage] = useState(null);

  const isOwnerOrAdmin = currentUser.role === 'owner' || currentUser.role === 'admin';

  async function fetchHistory() {
    try {
      const res = await fetch('/api/weekly-reports/history?limit=20');
      if (res.ok) {
        const data = await res.json();
        setRuns(data.runs || []);
      }
    } catch (err) {
      console.warn('Failed to refresh history:', err);
    }
  }

  async function handleOpenEmailConfirmation() {
    setIsLoadingRecipients(true);
    setShowConfirmModal(true);
    setRecipientPreview(null);
    try {
      const res = await fetch('/api/weekly-reports/recipients-preview');
      if (res.ok) {
        const data = await res.json();
        setRecipientPreview(data);
      } else {
        setRecipientPreview({ error: 'Failed to load recipient list.' });
      }
    } catch (err) {
      setRecipientPreview({ error: err.message });
    } finally {
      setIsLoadingRecipients(false);
    }
  }

  function handleStartGeneration() {
    setGenerationError(null);
    if (deliveryMode === 'email_all') {
      handleOpenEmailConfirmation();
    } else {
      executeGenerate();
    }
  }

  async function executeGenerate() {
    setShowConfirmModal(false);
    setIsGenerating(true);
    setGenerationError(null);

    const sendManagement = deliveryMode === 'email_mgmt' || deliveryMode === 'email_all';
    const sendEmployees = deliveryMode === 'email_all';

    try {
      const res = await fetch('/api/weekly-reports/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          periodType,
          customStartDate: periodType === 'custom' ? customStartDate : undefined,
          customEndDate: periodType === 'custom' ? customEndDate : undefined,
          projectScope,
          selectedProjectIds: projectScope === 'selected' ? selectedProjectIds : [],
          includeAi,
          sendManagement,
          sendEmployees,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to generate report');
      }

      setLatestResult(data);
      await fetchHistory();
    } catch (err) {
      setGenerationError(err.message);
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleRetry(runId) {
    setRetryingRunId(runId);
    setRetryMessage(null);
    try {
      const res = await fetch(`/api/weekly-reports/retry/${runId}`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Retry failed');
      }
      setRetryMessage(`Run #${runId}: retried ${data.retriedCount} emails (${data.acceptedCount} sent).`);
      await fetchHistory();
    } catch (err) {
      setRetryMessage(`Retry error: ${err.message}`);
    } finally {
      setRetryingRunId(null);
    }
  }

  function toggleProject(id) {
    setSelectedProjectIds((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  }

  const lastRun = runs[0] || null;

  return (
    <AppShell
      currentUser={currentUser}
      projects={projects}
      projectCounts={{}}
      view="weekly-ai-reports"
    >
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 16px' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, color: '#091e42' }}>
              Company-Wide Weekly AI Excel Reporting
            </h1>
            <p style={{ margin: '6px 0 0 0', color: '#5e6c84', fontSize: 14 }}>
              Automated Saturday executive reporting, grounded AI management insights, and private employee workbooks.
            </p>
          </div>
          <span
            style={{
              padding: '6px 12px',
              backgroundColor: '#e3fcef',
              color: '#006644',
              borderRadius: 16,
              fontSize: 12,
              fontWeight: 600,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: '#36b37e' }} />
            Scheduler Active: Every Sat @ 18:00 IST
          </span>
        </div>

        {/* Status Ribbon */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: 16,
            marginBottom: 24,
          }}
        >
          <div style={{ background: '#fff', border: '1px solid #dfe1e6', borderRadius: 8, padding: 16 }}>
            <div style={{ fontSize: 11, textTransform: 'uppercase', color: '#6b778c', fontWeight: 700 }}>
              Next Scheduled Automated Cycle
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, marginTop: 6, color: '#091e42' }}>
              {nextSaturdayLabel || 'Every Saturday 18:00 IST'}
            </div>
            <div style={{ fontSize: 12, color: '#5e6c84', marginTop: 4 }}>
              168-hour cumulative snapshot &amp; email distribution
            </div>
          </div>

          <div style={{ background: '#fff', border: '1px solid #dfe1e6', borderRadius: 8, padding: 16 }}>
            <div style={{ fontSize: 11, textTransform: 'uppercase', color: '#6b778c', fontWeight: 700 }}>
              Last Report Run
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, marginTop: 6, color: '#091e42' }}>
              {lastRun ? `${lastRun.created_at?.slice(0, 16)} UTC` : 'No runs yet'}
            </div>
            <div style={{ fontSize: 12, color: '#5e6c84', marginTop: 4 }}>
              Status: <strong style={{ color: lastRun?.status === 'completed' ? '#00875a' : '#de350b' }}>{lastRun?.status || 'N/A'}</strong>
              {lastRun?.report_type && ` (${lastRun.report_type})`}
            </div>
          </div>

          <div style={{ background: '#fff', border: '1px solid #dfe1e6', borderRadius: 8, padding: 16 }}>
            <div style={{ fontSize: 11, textTransform: 'uppercase', color: '#6b778c', fontWeight: 700 }}>
              Report Formats
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, marginTop: 6, color: '#091e42' }}>
              Excel (.xlsx) + AI Insights
            </div>
            <div style={{ fontSize: 12, color: '#5e6c84', marginTop: 4 }}>
              7 Company Sheets &bull; 6 Employee Sheets &bull; Formula Sanitized
            </div>
          </div>
        </div>

        {/* Generator Controls Card */}
        <div style={{ background: '#fff', border: '1px solid #dfe1e6', borderRadius: 8, padding: 24, marginBottom: 24 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 16px 0', color: '#091e42' }}>
            Generate On-Demand Report
          </h2>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 20 }}>
            {/* Period Selector */}
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#172b4d', marginBottom: 6 }}>
                Reporting Period
              </label>
              <select
                value={periodType}
                onChange={(e) => setPeriodType(e.target.value)}
                style={{
                  width: '100%',
                  height: 40,
                  padding: '8px 36px 8px 12px',
                  borderRadius: 6,
                  border: '1px solid #c1c7d0',
                  backgroundColor: '#ffffff',
                  fontSize: 14,
                  color: '#091e42',
                  lineHeight: '22px',
                  outline: 'none',
                  cursor: 'pointer',
                  appearance: 'none',
                  WebkitAppearance: 'none',
                  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2344546f' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
                  backgroundRepeat: 'no-repeat',
                  backgroundPosition: 'right 12px center',
                  boxShadow: '0 1px 2px rgba(9, 30, 66, 0.08)',
                }}
              >
                <option value="weekly_sat">Saturday 18:00 IST Cycle (Weekly Standard)</option>
                <option value="last_7_days">Rolling Last 7 Days</option>
                <option value="current_month">Current Month to Date</option>
                <option value="custom">Custom Date Range...</option>
              </select>

              {periodType === 'custom' && (
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <input
                    type="date"
                    value={customStartDate}
                    onChange={(e) => setCustomStartDate(e.target.value)}
                    style={{ flex: 1, padding: 6, borderRadius: 4, border: '1px solid #dfe1e6', fontSize: 12 }}
                  />
                  <input
                    type="date"
                    value={customEndDate}
                    onChange={(e) => setCustomEndDate(e.target.value)}
                    style={{ flex: 1, padding: 6, borderRadius: 4, border: '1px solid #dfe1e6', fontSize: 12 }}
                  />
                </div>
              )}
            </div>

            {/* Scope Selector */}
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#172b4d', marginBottom: 6 }}>
                Project Scope
              </label>
              <select
                value={projectScope}
                onChange={(e) => setProjectScope(e.target.value)}
                style={{
                  width: '100%',
                  height: 40,
                  padding: '8px 36px 8px 12px',
                  borderRadius: 6,
                  border: '1px solid #c1c7d0',
                  backgroundColor: '#ffffff',
                  fontSize: 14,
                  color: '#091e42',
                  lineHeight: '22px',
                  outline: 'none',
                  cursor: 'pointer',
                  appearance: 'none',
                  WebkitAppearance: 'none',
                  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2344546f' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
                  backgroundRepeat: 'no-repeat',
                  backgroundPosition: 'right 12px center',
                  boxShadow: '0 1px 2px rgba(9, 30, 66, 0.08)',
                }}
              >
                <option value="all">All Projects (Company-Wide)</option>
                <option value="active">Active Projects Only</option>
                <option value="selected">Specific Projects...</option>
              </select>

              {projectScope === 'selected' && (
                <div
                  style={{
                    maxHeight: 120,
                    overflowY: 'auto',
                    border: '1px solid #dfe1e6',
                    borderRadius: 4,
                    padding: 8,
                    marginTop: 8,
                  }}
                >
                  {projects.map((p) => (
                    <label
                      key={p.id}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, marginBottom: 4, cursor: 'pointer' }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedProjectIds.includes(p.id)}
                        onChange={() => toggleProject(p.id)}
                      />
                      <span>{p.name}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* Delivery Mode */}
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#172b4d', marginBottom: 6 }}>
                Delivery Workflow
              </label>
              <select
                value={deliveryMode}
                onChange={(e) => setDeliveryMode(e.target.value)}
                style={{
                  width: '100%',
                  height: 40,
                  padding: '8px 36px 8px 12px',
                  borderRadius: 6,
                  border: '1px solid #c1c7d0',
                  backgroundColor: '#ffffff',
                  fontSize: 14,
                  color: '#091e42',
                  lineHeight: '22px',
                  outline: 'none',
                  cursor: 'pointer',
                  appearance: 'none',
                  WebkitAppearance: 'none',
                  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2344546f' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
                  backgroundRepeat: 'no-repeat',
                  backgroundPosition: 'right 12px center',
                  boxShadow: '0 1px 2px rgba(9, 30, 66, 0.08)',
                }}
              >
                <option value="download_only">Download Only (Default &bull; Safe)</option>
                <option value="email_mgmt">Email Management Only (Owner &amp; Admin)</option>
                {isOwnerOrAdmin && (
                  <option value="email_all">Email Management + All Active Employees</option>
                )}
              </select>

              <div style={{ marginTop: 10 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={includeAi}
                    onChange={(e) => setIncludeAi(e.target.checked)}
                  />
                  <span>Run Grounded AI Management Analysis</span>
                </label>
              </div>
            </div>
          </div>

          {generationError && (
            <div style={{ marginTop: 16, padding: 12, backgroundColor: '#ffebe6', color: '#bf2600', borderRadius: 4, fontSize: 13 }}>
              <strong>Error:</strong> {generationError}
            </div>
          )}

          <div style={{ marginTop: 20, display: 'flex', gap: 12, alignItems: 'center' }}>
            <button
              onClick={handleStartGeneration}
              disabled={isGenerating}
              style={{
                backgroundColor: isGenerating ? '#a5b2c6' : '#0c66e4',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                padding: '10px 20px',
                fontSize: 14,
                fontWeight: 600,
                cursor: isGenerating ? 'not-allowed' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              {isGenerating ? 'Generating Workbooks & Running AI...' : 'Generate Report'}
            </button>

            {latestResult?.file && (
              <a
                href={latestResult.file.downloadUrl}
                download={latestResult.file.filename}
                style={{
                  backgroundColor: '#00875a',
                  color: '#fff',
                  textDecoration: 'none',
                  borderRadius: 4,
                  padding: '10px 18px',
                  fontSize: 14,
                  fontWeight: 600,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                Download Excel ({latestResult.file.filename})
              </a>
            )}
          </div>
        </div>

        {/* Live Preview Card */}
        {latestResult && (
          <div style={{ background: '#fff', border: '1px solid #dfe1e6', borderRadius: 8, padding: 24, marginBottom: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #ebecf0', paddingBottom: 12, marginBottom: 16 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: '#091e42' }}>
                Report Generated — Run #{latestResult.runId}
              </h2>
              <span style={{ fontSize: 12, color: '#5e6c84' }}>
                Period: {latestResult.period?.startIstLabel} &ndash; {latestResult.period?.endIstLabel}
              </span>
            </div>

            {/* Executive KPIs */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12, marginBottom: 20 }}>
              <div style={{ padding: 12, backgroundColor: '#f4f5f7', borderRadius: 6, textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: '#6b778c', textTransform: 'uppercase' }}>Total Tickets</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: '#091e42', marginTop: 4 }}>
                  {latestResult.executiveKPIs?.totalCumulativeTickets ?? 0}
                </div>
              </div>
              <div style={{ padding: 12, backgroundColor: '#e6fcff', borderRadius: 6, textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: '#006644', textTransform: 'uppercase' }}>Open / Active</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: '#0052cc', marginTop: 4 }}>
                  {latestResult.executiveKPIs?.totalOpenTickets ?? 0}
                </div>
              </div>
              <div style={{ padding: 12, backgroundColor: '#e3fcef', borderRadius: 6, textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: '#006644', textTransform: 'uppercase' }}>Closed / Resolved</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: '#00875a', marginTop: 4 }}>
                  {latestResult.executiveKPIs?.totalClosedTickets ?? 0}
                </div>
              </div>
              <div style={{ padding: 12, backgroundColor: '#f4f5f7', borderRadius: 6, textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: '#6b778c', textTransform: 'uppercase' }}>Completion %</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: '#091e42', marginTop: 4 }}>
                  {latestResult.executiveKPIs?.completionPercentage ?? '0%'}
                </div>
              </div>
              <div style={{ padding: 12, backgroundColor: '#ffebe6', borderRadius: 6, textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: '#de350b', textTransform: 'uppercase' }}>Overdue</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: '#de350b', marginTop: 4 }}>
                  {latestResult.executiveKPIs?.totalOverdueTickets ?? 0}
                </div>
              </div>
              <div style={{ padding: 12, backgroundColor: '#fff0b3', borderRadius: 6, textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: '#172b4d', textTransform: 'uppercase' }}>Blocked</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: '#ff991f', marginTop: 4 }}>
                  {latestResult.executiveKPIs?.totalBlockedTickets ?? 0}
                </div>
              </div>
            </div>

            {/* AI Insights Preview */}
            {latestResult.aiInsights && (
              <div style={{ backgroundColor: '#fafbfc', border: '1px solid #dfe1e6', borderRadius: 6, padding: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <div style={{ fontWeight: 700, fontSize: 15, color: '#091e42' }}>
                    {latestResult.aiInsights.headline || 'Management AI Insights'}
                  </div>
                  <span style={{ fontSize: 11, backgroundColor: '#ebecf0', padding: '3px 8px', borderRadius: 10, color: '#5e6c84' }}>
                    {latestResult.aiInsights.modelName} &bull; {latestResult.aiInsights.aiAvailable ? 'Operational' : 'DB Fallback'}
                  </span>
                </div>
                <p style={{ margin: '0 0 12px 0', fontSize: 13, color: '#172b4d', lineHeight: 1.5 }}>
                  {latestResult.aiInsights.executiveSummary}
                </p>

                {(latestResult.aiInsights.strategicBottlenecks || latestResult.aiInsights.projectBottlenecks)?.length > 0 && (
                  <div style={{ marginTop: 10 }}>
                    <strong style={{ fontSize: 12, color: '#de350b' }}>Key Bottlenecks:</strong>
                    <ul style={{ margin: '4px 0', paddingLeft: 20, fontSize: 12, color: '#172b4d' }}>
                      {(latestResult.aiInsights.strategicBottlenecks || latestResult.aiInsights.projectBottlenecks).map((b, idx) => (
                        <li key={idx}>{b}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {(latestResult.aiInsights.nextWeekPriorities || latestResult.aiInsights.groundedRecommendations)?.length > 0 && (
                  <div style={{ marginTop: 10 }}>
                    <strong style={{ fontSize: 12, color: '#00875a' }}>Next Week Focus:</strong>
                    <ul style={{ margin: '4px 0', paddingLeft: 20, fontSize: 12, color: '#172b4d' }}>
                      {(latestResult.aiInsights.nextWeekPriorities || latestResult.aiInsights.groundedRecommendations).map((p, idx) => (
                        <li key={idx}>{p}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* History Table Card */}
        <div style={{ background: '#fff', border: '1px solid #dfe1e6', borderRadius: 8, padding: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: '#091e42' }}>
              Report Run History &amp; Deliveries
            </h2>
            <button
              onClick={fetchHistory}
              style={{
                backgroundColor: '#f4f5f7',
                border: '1px solid #dfe1e6',
                borderRadius: 4,
                padding: '6px 12px',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              Refresh History
            </button>
          </div>

          {retryMessage && (
            <div style={{ marginBottom: 12, padding: 8, backgroundColor: '#e3fcef', color: '#006644', borderRadius: 4, fontSize: 12 }}>
              {retryMessage}
            </div>
          )}

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #dfe1e6', backgroundColor: '#fafbfc' }}>
                  <th style={{ padding: 10, color: '#5e6c84' }}>ID</th>
                  <th style={{ padding: 10, color: '#5e6c84' }}>Timestamp (UTC)</th>
                  <th style={{ padding: 10, color: '#5e6c84' }}>Type</th>
                  <th style={{ padding: 10, color: '#5e6c84' }}>Period</th>
                  <th style={{ padding: 10, color: '#5e6c84' }}>Status</th>
                  <th style={{ padding: 10, color: '#5e6c84' }}>AI / Excel</th>
                  <th style={{ padding: 10, color: '#5e6c84' }}>Email Deliveries</th>
                  <th style={{ padding: 10, color: '#5e6c84', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {runs.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ padding: 20, textAlign: 'center', color: '#6b778c' }}>
                      No reports generated yet. Click "Generate Report" above to run your first report.
                    </td>
                  </tr>
                ) : (
                  runs.map((r) => {
                    const compFile = r.companyFile;
                    const dCounts = r.deliveryCounts || {};
                    return (
                      <tr key={r.id} style={{ borderBottom: '1px solid #ebecf0' }}>
                        <td style={{ padding: 10, fontWeight: 600 }}>#{r.id}</td>
                        <td style={{ padding: 10 }}>{r.created_at?.slice(0, 16)}</td>
                        <td style={{ padding: 10 }}>
                          <span
                            style={{
                              padding: '2px 6px',
                              borderRadius: 4,
                              fontSize: 11,
                              backgroundColor: r.report_type === 'scheduled' ? '#e3fcef' : '#deebff',
                              color: r.report_type === 'scheduled' ? '#006644' : '#0747a6',
                            }}
                          >
                            {r.report_type}
                          </span>
                        </td>
                        <td style={{ padding: 10, fontSize: 12 }}>
                          {r.period_type}
                        </td>
                        <td style={{ padding: 10 }}>
                          <span
                            style={{
                              padding: '2px 6px',
                              borderRadius: 4,
                              fontSize: 11,
                              backgroundColor: r.status === 'completed' ? '#e3fcef' : '#ffebe6',
                              color: r.status === 'completed' ? '#006644' : '#bf2600',
                            }}
                          >
                            {r.status}
                          </span>
                        </td>
                        <td style={{ padding: 10, fontSize: 12 }}>
                          AI: {r.ai_status} &bull; Excel: {r.excel_status}
                        </td>
                        <td style={{ padding: 10, fontSize: 12 }}>
                          {dCounts.accepted + dCounts.logged_local > 0 && (
                            <span style={{ color: '#00875a', marginRight: 6 }}>
                              ✓ {dCounts.accepted + dCounts.logged_local} sent
                            </span>
                          )}
                          {dCounts.failed > 0 && (
                            <span style={{ color: '#de350b', fontWeight: 600, marginRight: 6 }}>
                              ✗ {dCounts.failed} failed
                            </span>
                          )}
                          {dCounts.uncertain > 0 && (
                            <span style={{ color: '#ff991f', marginRight: 6 }}>
                              ? {dCounts.uncertain} uncertain
                            </span>
                          )}
                          {dCounts.accepted === 0 && dCounts.logged_local === 0 && dCounts.failed === 0 && (
                            <span style={{ color: '#6b778c' }}>None (download only)</span>
                          )}
                        </td>
                        <td style={{ padding: 10, textAlign: 'right' }}>
                          <div style={{ display: 'inline-flex', gap: 6 }}>
                            {compFile && (
                              <a
                                href={`/api/weekly-reports/download/${compFile.id}`}
                                download={compFile.filename}
                                style={{
                                  backgroundColor: '#f4f5f7',
                                  color: '#0c66e4',
                                  padding: '4px 8px',
                                  borderRadius: 4,
                                  textDecoration: 'none',
                                  fontSize: 12,
                                  fontWeight: 500,
                                }}
                              >
                                Download .xlsx
                              </a>
                            )}
                            {r.hasFailedDeliveries && isOwnerOrAdmin && (
                              <button
                                onClick={() => handleRetry(r.id)}
                                disabled={retryingRunId === r.id}
                                style={{
                                  backgroundColor: '#de350b',
                                  color: '#fff',
                                  border: 'none',
                                  padding: '4px 8px',
                                  borderRadius: 4,
                                  fontSize: 12,
                                  cursor: 'pointer',
                                }}
                              >
                                {retryingRunId === r.id ? 'Retrying...' : 'Retry Failed'}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Confirmation Modal */}
        {showConfirmModal && (
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(9, 30, 66, 0.54)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 9999,
            }}
          >
            <div
              style={{
                background: '#fff',
                borderRadius: 8,
                maxWidth: 600,
                width: '90%',
                padding: 24,
                boxShadow: '0 8px 24px rgba(9, 30, 66, 0.25)',
              }}
            >
              <h3 style={{ margin: '0 0 12px 0', fontSize: 18, color: '#de350b' }}>
                Confirm Company-Wide Email Distribution
              </h3>
              <p style={{ margin: '0 0 16px 0', fontSize: 14, color: '#172b4d', lineHeight: 1.5 }}>
                You are about to email individual private performance workbooks to all active employees and company reports to management.
              </p>

              {isLoadingRecipients ? (
                <div style={{ padding: 20, textAlign: 'center', color: '#5e6c84' }}>
                  Resolving recipient eligibility &amp; verifying email addresses...
                </div>
              ) : recipientPreview?.error ? (
                <div style={{ padding: 12, backgroundColor: '#ffebe6', color: '#bf2600', borderRadius: 4, fontSize: 13 }}>
                  {recipientPreview.error}
                </div>
              ) : (
                <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid #dfe1e6', borderRadius: 4, padding: 10, marginBottom: 16 }}>
                  <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 6, color: '#5e6c84' }}>
                    Management Recipients ({recipientPreview?.summary?.validManagement || 0}):
                  </div>
                  <ul style={{ margin: '0 0 12px 0', paddingLeft: 18, fontSize: 12 }}>
                    {(recipientPreview?.managementRecipients || []).map((m, idx) => (
                      <li key={idx} style={{ color: m.isValid ? '#172b4d' : '#de350b' }}>
                        {m.name} ({m.email}) {!m.isValid && `— ${m.skipReason}`}
                      </li>
                    ))}
                  </ul>

                  <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 6, color: '#5e6c84' }}>
                    Employee Recipients ({recipientPreview?.summary?.validEmployees || 0}):
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
                    {(recipientPreview?.employeeRecipients || []).map((e, idx) => (
                      <li key={idx} style={{ color: e.isValid ? '#172b4d' : '#de350b' }}>
                        {e.name} ({e.email}) {!e.isValid && `— ${e.skipReason}`}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button
                  onClick={() => setShowConfirmModal(false)}
                  style={{
                    backgroundColor: '#f4f5f7',
                    border: '1px solid #dfe1e6',
                    borderRadius: 4,
                    padding: '8px 16px',
                    fontSize: 14,
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={executeGenerate}
                  disabled={isLoadingRecipients}
                  style={{
                    backgroundColor: '#de350b',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 4,
                    padding: '8px 18px',
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: isLoadingRecipients ? 'not-allowed' : 'pointer',
                  }}
                >
                  Confirm &amp; Send Emails
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

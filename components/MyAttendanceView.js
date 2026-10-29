'use client';

import { useState, useEffect } from 'react';
import AppShell from '@/components/AppShell';
import PageHeader from '@/components/PageHeader';
import { ClipboardIcon } from '@/components/AppShellIcons';
import { formatKolkataTime, formatMinutes, getLeaveTypeLabel } from '@/lib/attendanceMeta';
import LeaveRequestModal from '@/components/LeaveRequestModal';
import MyLeaveRequestsView from '@/components/MyLeaveRequestsView';
import LeaveBalanceCards from '@/components/LeaveBalanceCards';

export default function MyAttendanceView({
  currentUser,
  projects,
  projectCounts,
  myIssuesCount,
  initialData,
}) {
  const [data, setData] = useState(initialData);
  const [month, setMonth] = useState(initialData.month || new Date().toISOString().slice(0, 7));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('attendance'); // 'attendance' | 'leaves'
  const [isLeaveModalOpen, setIsLeaveModalOpen] = useState(false);
  const [leaveRequests, setLeaveRequests] = useState([]);
  const [loadingLeaves, setLoadingLeaves] = useState(false);
  const [balanceData, setBalanceData] = useState(null);
  const [loadingBalances, setLoadingBalances] = useState(false);

  const records = data.records || [];
  const summary = data.summary || {};

  async function fetchBalances() {
    setLoadingBalances(true);
    try {
      const res = await fetch('/api/attendance/leave/balances');
      if (res.ok) {
        const json = await res.json();
        setBalanceData(json.balances || json);
      }
    } catch {
      // ignore
    } finally {
      setLoadingBalances(false);
    }
  }

  async function fetchLeaveRequests() {
    setLoadingLeaves(true);
    try {
      const res = await fetch('/api/attendance/leave/request');
      const json = await res.json();
      if (res.ok && json.requests) {
        setLeaveRequests(json.requests);
      }
    } catch {
      // ignore
    } finally {
      setLoadingLeaves(false);
    }
  }

  useEffect(() => {
    fetchLeaveRequests();
    fetchBalances();
  }, []);

  async function handleMonthChange(newMonth) {
    setMonth(newMonth);
    setLoading(true);
    setError('');

    try {
      const res = await fetch(`/api/attendance/my-history?month=${newMonth}`);
      if (!res.ok) throw new Error('Failed to load attendance history.');
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function getDayName(dateStr) {
    try {
      const d = new Date(`${dateStr}T12:00:00Z`);
      return d.toLocaleDateString('en-US', { weekday: 'short' });
    } catch {
      return '';
    }
  }

  return (
    <AppShell
      currentUser={currentUser}
      projects={projects}
      projectCounts={projectCounts}
      myIssuesCount={myIssuesCount}
      view="my-attendance"
    >
      <div className="board ts-board" style={{ maxWidth: '1100px', margin: '0 auto', padding: '24px' }}>
        <PageHeader
          breadcrumb={[{ label: 'Dashboard', href: '/my-dashboard' }, { label: 'My Attendance' }]}
          title="My Attendance"
          icon={<ClipboardIcon />}
          subtitle="Your personal monthly attendance records, check-in/out timestamps, and leave requests."
          actions={
            <button
              onClick={() => setIsLeaveModalOpen(true)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 16px',
                background: '#0c66e4',
                color: '#ffffff',
                border: 'none',
                borderRadius: '6px',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
                boxShadow: '0 1px 2px rgba(0,0,0,0.1)'
              }}
            >
              🏖️ Apply for Leave
            </button>
          }
        />

        {/* Tab Switcher */}
        <div style={{
          display: 'flex',
          gap: '8px',
          borderBottom: '2px solid #ebecf0',
          marginBottom: '20px'
        }}>
          <button
            onClick={() => setActiveTab('attendance')}
            style={{
              padding: '10px 18px',
              border: 'none',
              background: 'none',
              fontSize: '14px',
              fontWeight: 600,
              color: activeTab === 'attendance' ? '#0c66e4' : '#626f86',
              borderBottom: activeTab === 'attendance' ? '2px solid #0c66e4' : '2px solid transparent',
              marginBottom: '-2px',
              cursor: 'pointer'
            }}
          >
            📅 Attendance History
          </button>
          <button
            onClick={() => setActiveTab('leaves')}
            style={{
              padding: '10px 18px',
              border: 'none',
              background: 'none',
              fontSize: '14px',
              fontWeight: 600,
              color: activeTab === 'leaves' ? '#0c66e4' : '#626f86',
              borderBottom: activeTab === 'leaves' ? '2px solid #0c66e4' : '2px solid transparent',
              marginBottom: '-2px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            🏖️ My Leave Requests
            {leaveRequests.some((r) => r.status === 'pending') && (
              <span style={{
                background: '#fff0b3',
                color: '#172b4d',
                fontSize: '11px',
                padding: '1px 6px',
                borderRadius: '10px',
                fontWeight: 700
              }}>
                {leaveRequests.filter((r) => r.status === 'pending').length}
              </span>
            )}
          </button>
        </div>

        {activeTab === 'leaves' ? (
          <div>
            <LeaveBalanceCards
              balanceData={balanceData}
              loading={loadingBalances}
              onRefresh={fetchBalances}
            />
            <MyLeaveRequestsView
              requests={leaveRequests}
              onRefresh={() => {
                fetchLeaveRequests();
                fetchBalances();
                handleMonthChange(month);
              }}
            />
          </div>
        ) : (
          <div>
            {/* Month Selector Filter Bar */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: '#ffffff',
              padding: '16px 20px',
              borderRadius: '8px',
              border: '1px solid #ebecf0',
              marginBottom: '20px',
              boxShadow: '0 1px 2px rgba(9, 30, 66, 0.05)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ fontWeight: 600, fontSize: '14px', color: '#172b4d' }}>Selected Month:</span>
                <input
                  type="month"
                  value={month}
                  onChange={(e) => handleMonthChange(e.target.value)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '6px',
                    border: '1px solid #dfe1e6',
                    fontSize: '14px',
                    color: '#172b4d',
                    outline: 'none',
                  }}
                />
              </div>

              <div style={{ fontSize: '13px', color: '#626f86' }}>
                Office Hours: <strong>9:00 AM – 5:00 PM</strong> · Lunch: <strong>12:30 PM – 1:00 PM</strong> (Asia/Kolkata)
              </div>
            </div>

            {error && (
              <div style={{
                background: '#ffebe6',
                color: '#ae2e24',
                padding: '12px 16px',
                borderRadius: '6px',
                marginBottom: '16px',
                fontSize: '13px'
              }}>
                {error}
              </div>
            )}

            {/* Monthly Summary Cards */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
              gap: '14px',
              marginBottom: '24px'
            }}>
              <div style={{ background: '#ffffff', padding: '16px', borderRadius: '8px', border: '1px solid #ebecf0', borderLeft: '4px solid #22c55e' }}>
                <span style={{ fontSize: '12px', color: '#626f86', textTransform: 'uppercase', fontWeight: 600 }}>Present / Full Day</span>
                <div style={{ fontSize: '24px', fontWeight: 700, color: '#166534', marginTop: '4px' }}>
                  {summary.presentCount || 0}
                </div>
                <span style={{ fontSize: '12px', color: '#8590a2' }}>Days present</span>
              </div>

              <div style={{ background: '#ffffff', padding: '16px', borderRadius: '8px', border: '1px solid #ebecf0', borderLeft: '4px solid #f59e0b' }}>
                <span style={{ fontSize: '12px', color: '#626f86', textTransform: 'uppercase', fontWeight: 600 }}>Late Arrivals</span>
                <div style={{ fontSize: '24px', fontWeight: 700, color: '#974f00', marginTop: '4px' }}>
                  {summary.lateCount || 0}
                </div>
                <span style={{ fontSize: '12px', color: '#8590a2' }}>Check-in after 11:30 AM</span>
              </div>

              <div style={{ background: '#ffffff', padding: '16px', borderRadius: '8px', border: '1px solid #ebecf0', borderLeft: '4px solid #9333ea' }}>
                <span style={{ fontSize: '12px', color: '#626f86', textTransform: 'uppercase', fontWeight: 600 }}>Half Days</span>
                <div style={{ fontSize: '24px', fontWeight: 700, color: '#6b21a8', marginTop: '4px' }}>
                  {summary.halfDayCount || 0}
                </div>
                <span style={{ fontSize: '12px', color: '#8590a2' }}>Check-in after 12:01 PM</span>
              </div>

              <div style={{ background: '#ffffff', padding: '16px', borderRadius: '8px', border: '1px solid #ebecf0', borderLeft: '4px solid #6b21a8' }}>
                <span style={{ fontSize: '12px', color: '#626f86', textTransform: 'uppercase', fontWeight: 600 }}>Approved Leaves</span>
                <div style={{ fontSize: '24px', fontWeight: 700, color: '#581c87', marginTop: '4px' }}>
                  {summary.onLeaveCount || 0}d
                </div>
                <span style={{ fontSize: '12px', color: '#8590a2' }}>Authorized leave days</span>
              </div>

              <div style={{ background: '#ffffff', padding: '16px', borderRadius: '8px', border: '1px solid #ebecf0', borderLeft: '4px solid #ef4444' }}>
                <span style={{ fontSize: '12px', color: '#626f86', textTransform: 'uppercase', fontWeight: 600 }}>Confirmed Absences</span>
                <div style={{ fontSize: '24px', fontWeight: 700, color: '#991b1b', marginTop: '4px' }}>
                  {summary.confirmedAbsentCount || 0}
                </div>
                <span style={{ fontSize: '12px', color: '#8590a2' }}>Recorded absent days</span>
              </div>

              <div style={{ background: '#ffffff', padding: '16px', borderRadius: '8px', border: '1px solid #ebecf0', borderLeft: '4px solid #0c66e4' }}>
                <span style={{ fontSize: '12px', color: '#626f86', textTransform: 'uppercase', fontWeight: 600 }}>Total Hours</span>
                <div style={{ fontSize: '24px', fontWeight: 700, color: '#0c66e4', marginTop: '4px' }}>
                  {summary.totalHours || '0.0'}h
                </div>
                <span style={{ fontSize: '12px', color: '#8590a2' }}>Net attendance</span>
              </div>
            </div>

            {/* History Records Table */}
            <div style={{ background: '#ffffff', borderRadius: '8px', border: '1px solid #ebecf0', overflow: 'hidden', boxShadow: '0 1px 3px rgba(9, 30, 66, 0.05)' }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid #ebecf0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: '#172b4d' }}>
                  Daily Records ({records.length})
                </h3>
                {loading && <span style={{ fontSize: '13px', color: '#0c66e4' }}>Refreshing...</span>}
              </div>

              {records.length === 0 ? (
                <div style={{ padding: '40px 20px', textAlign: 'center', color: '#626f86' }}>
                  No attendance records found for {month}.
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                    <thead>
                      <tr style={{ background: '#f7f8f9', borderBottom: '1px solid #dfe1e6', color: '#626f86' }}>
                        <th style={{ padding: '12px 16px', fontWeight: 600 }}>Date</th>
                        <th style={{ padding: '12px 16px', fontWeight: 600 }}>Day</th>
                        <th style={{ padding: '12px 16px', fontWeight: 600 }}>Check-In</th>
                        <th style={{ padding: '12px 16px', fontWeight: 600 }}>Check-Out</th>
                        <th style={{ padding: '12px 16px', fontWeight: 600 }}>Net Duration</th>
                        <th style={{ padding: '12px 16px', fontWeight: 600 }}>Source / Verification</th>
                        <th style={{ padding: '12px 16px', fontWeight: 600 }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {records.map((r) => {
                        const isMissingCheckout = !r.check_out_time && r.status !== 'on_leave' && r.status !== 'absent';
                        const isEstimated = r.is_estimated === 1;

                        return (
                          <tr key={r.id} style={{ borderBottom: '1px solid #f1f2f4' }}>
                            <td style={{ padding: '12px 16px', fontWeight: 500, color: '#172b4d' }}>{r.work_date}</td>
                            <td style={{ padding: '12px 16px', color: '#626f86' }}>{getDayName(r.work_date)}</td>
                            <td style={{ padding: '12px 16px', color: '#172b4d' }}>
                              {r.check_in_time ? formatKolkataTime(r.check_in_time) : '—'}
                            </td>
                            <td style={{ padding: '12px 16px', color: '#172b4d' }}>
                              {r.check_out_time ? (
                                formatKolkataTime(r.check_out_time)
                              ) : isMissingCheckout ? (
                                <span style={{ color: '#ae2e24', fontWeight: 600 }}>Missing Checkout</span>
                              ) : (
                                '—'
                              )}
                            </td>
                            <td style={{ padding: '12px 16px', fontWeight: 500 }}>{formatMinutes(r.net_duration_minutes)}</td>
                            <td style={{ padding: '12px 16px' }}>
                              {r.status === 'on_leave' ? (
                                <span style={{ background: '#f3e8ff', color: '#6b21a8', padding: '3px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600 }}>
                                  🏖️ {r.leave_type ? getLeaveTypeLabel(r.leave_type) : 'Approved Leave'}
                                </span>
                              ) : isMissingCheckout ? (
                                <span style={{ background: '#ffebe6', color: '#ae2e24', padding: '3px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600 }}>
                                  ⚠️ Missing Checkout · Pending Review
                                </span>
                              ) : isEstimated ? (
                                <span style={{ background: '#fff7d6', color: '#974f00', padding: '3px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600 }}>
                                  Estimated (Task Sheet Submission)
                                </span>
                              ) : (
                                <span style={{ background: '#e3fcef', color: '#216e4e', padding: '3px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600 }}>
                                  ✓ Actual (User Action)
                                </span>
                              )}
                            </td>
                            <td style={{ padding: '12px 16px' }}>
                              {r.status === 'present' && (
                                <span style={{ background: '#dcfce7', color: '#166534', padding: '3px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 600 }}>
                                  Present
                                </span>
                              )}
                              {r.status === 'late' && (
                                <span style={{ background: '#fef3c7', color: '#92400e', padding: '3px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 600 }}>
                                  Late
                                </span>
                              )}
                              {r.status === 'half_day' && (
                                <div>
                                  <span style={{ background: '#f3e8ff', color: '#6b21a8', padding: '3px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 600 }}>
                                    Half Day
                                  </span>
                                  {r.leave_day_type && (
                                    <div style={{ fontSize: '11px', color: '#581c87', marginTop: '2px', fontWeight: 500 }}>
                                      {r.leave_day_type === 'first_half' ? '1st Half Leave' : '2nd Half Leave'}
                                    </div>
                                  )}
                                </div>
                              )}
                              {r.status === 'on_leave' && (
                                <span style={{ background: '#f3e8ff', color: '#581c87', padding: '3px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 600 }}>
                                  On Leave ({r.leave_day_type === 'first_half' ? '1st Half' : r.leave_day_type === 'second_half' ? '2nd Half' : 'Full Day'})
                                </span>
                              )}
                              {r.status === 'absent' && (
                                <span style={{ background: '#fee2e2', color: '#991b1b', padding: '3px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 600 }}>
                                  Absent
                                </span>
                              )}
                              {r.is_manually_adjusted === 1 && (
                                <span style={{ marginLeft: '6px', fontSize: '11px', color: '#626f86', fontStyle: 'italic' }}>
                                  (Adjusted by Admin)
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        <LeaveRequestModal
          isOpen={isLeaveModalOpen}
          balanceData={balanceData}
          onClose={() => setIsLeaveModalOpen(false)}
          onSubmitted={() => {
            fetchLeaveRequests();
            fetchBalances();
            handleMonthChange(month);
          }}
        />
      </div>
    </AppShell>
  );
}

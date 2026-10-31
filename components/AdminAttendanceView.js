'use client';

import { useState, useEffect } from 'react';
import AppShell from '@/components/AppShell';
import PageHeader from '@/components/PageHeader';
import { PeopleIcon } from '@/components/AppShellIcons';
import AdminAttendanceModal from '@/components/AdminAttendanceModal';
import AdminLeaveRequestsView from '@/components/AdminLeaveRequestsView';
import { formatKolkataTime, formatMinutes } from '@/lib/attendanceMeta';

export default function AdminAttendanceView({
  currentUser,
  projects,
  projectCounts,
  myIssuesCount,
  initialData,
  initialSettings,
  initialHolidays,
}) {
  const [activeTab, setActiveTab] = useState('roster'); // 'roster' | 'leaves' | 'settings' | 'holidays'
  const [data, setData] = useState(initialData);
  const [date, setDate] = useState(initialData.workDate || new Date().toISOString().slice(0, 10));
  const [department, setDepartment] = useState('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pendingLeaveCount, setPendingLeaveCount] = useState(0);

  // Modal state
  const [selectedItem, setSelectedItem] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);

  // Settings tab state
  const [settings, setSettings] = useState(initialSettings);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsSuccess, setSettingsSuccess] = useState('');

  // Holidays state
  const [holidays, setHolidays] = useState(initialHolidays);

  const counts = data.counts || {};
  const roster = data.roster || [];

  async function fetchPendingLeaves() {
    try {
      const res = await fetch('/api/attendance/leave/admin?status=pending');
      const json = await res.json();
      if (res.ok && json.requests) {
        setPendingLeaveCount(json.requests.length);
      }
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    fetchPendingLeaves();
  }, []);

  async function fetchRoster(targetDate, targetDept, targetSearch) {
    setLoading(true);
    setError('');

    try {
      const q = new URLSearchParams({
        date: targetDate,
        department: targetDept,
        search: targetSearch,
      });
      const res = await fetch(`/api/attendance/admin/records?${q.toString()}`);
      if (!res.ok) throw new Error('Failed to load workforce attendance.');
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleDateChange(newDate) {
    setDate(newDate);
    fetchRoster(newDate, department, search);
  }

  function handleDeptChange(newDept) {
    setDepartment(newDept);
    fetchRoster(date, newDept, search);
  }

  function handleSearchSubmit(e) {
    e.preventDefault();
    fetchRoster(date, department, search);
  }

  function openModal(item) {
    setSelectedItem(item);
    setModalOpen(true);
  }

  async function handleSettingsSubmit(e) {
    e.preventDefault();
    setSettingsSaving(true);
    setSettingsSuccess('');
    setError('');

    try {
      const res = await fetch('/api/attendance/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to update settings.');

      setSettings(json.settings);
      setSettingsSuccess('Attendance settings successfully updated.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSettingsSaving(false);
    }
  }

  return (
    <AppShell
      currentUser={currentUser}
      projects={projects}
      projectCounts={projectCounts}
      myIssuesCount={myIssuesCount}
      view="attendance"
    >
      <div className="board ts-board" style={{ maxWidth: '1200px', margin: '0 auto', padding: '24px' }}>
        <PageHeader
          breadcrumb={[{ label: 'Administration', href: '/administration' }, { label: 'Attendance Management' }]}
          title="Attendance Management"
          icon={<PeopleIcon />}
          subtitle="Workforce daily attendance governance, leave approvals, check-in corrections, and official company schedules."
          actions={
            <button
              onClick={() => {
                setSelectedItem({ employee: { id: null, name: 'Select Employee...' }, attendance: null });
                setModalOpen(true);
              }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 16px',
                background: 'var(--primary)',
                color: 'var(--primary-text)',
                border: 'none',
                borderRadius: '6px',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
                boxShadow: '0 1px 2px rgba(0,0,0,0.1)'
              }}
            >
              + Adjust / Regularize Date
            </button>
          }
        />

        {/* Tab Navigation */}
        <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--border-subtle)', marginBottom: '20px' }}>
          <button
            type="button"
            onClick={() => setActiveTab('roster')}
            style={{
              padding: '10px 16px',
              border: 'none',
              background: 'none',
              fontSize: '14px',
              fontWeight: 600,
              cursor: 'pointer',
              color: activeTab === 'roster' ? 'var(--text-link)' : 'var(--text-subtle)',
              borderBottom: activeTab === 'roster' ? '2px solid var(--text-link)' : '2px solid transparent',
            }}
          >
            📅 Workforce Attendance
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('leaves')}
            style={{
              padding: '10px 16px',
              border: 'none',
              background: 'none',
              fontSize: '14px',
              fontWeight: 600,
              cursor: 'pointer',
              color: activeTab === 'leaves' ? 'var(--text-link)' : 'var(--text-subtle)',
              borderBottom: activeTab === 'leaves' ? '2px solid var(--text-link)' : '2px solid transparent',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            🏖️ Leave Applications
            {pendingLeaveCount > 0 && (
              <span style={{
                background: 'var(--warning-banner-bg)',
                color: 'var(--text)',
                fontSize: '11px',
                padding: '1px 6px',
                borderRadius: '10px',
                fontWeight: 700
              }}>
                {pendingLeaveCount}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('settings')}
            style={{
              padding: '10px 16px',
              border: 'none',
              background: 'none',
              fontSize: '14px',
              fontWeight: 600,
              cursor: 'pointer',
              color: activeTab === 'settings' ? 'var(--text-link)' : 'var(--text-subtle)',
              borderBottom: activeTab === 'settings' ? '2px solid var(--text-link)' : '2px solid transparent',
            }}
          >
            Official Schedules & Grace Period
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('holidays')}
            style={{
              padding: '10px 16px',
              border: 'none',
              background: 'none',
              fontSize: '14px',
              fontWeight: 600,
              cursor: 'pointer',
              color: activeTab === 'holidays' ? 'var(--text-link)' : 'var(--text-subtle)',
              borderBottom: activeTab === 'holidays' ? '2px solid var(--text-link)' : '2px solid transparent',
            }}
          >
            Company Holidays
          </button>
        </div>

        {error && (
          <div style={{ background: '#ffebe6', color: 'var(--danger)', padding: '12px 16px', borderRadius: '6px', marginBottom: '16px', fontSize: '13px' }}>
            {error}
          </div>
        )}

        {/* Tab 1: Workforce Roster */}
        {activeTab === 'roster' && (
          <>
            {/* Filter Controls Bar */}
            <div style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '14px',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: 'var(--bg-elevated)',
              padding: '16px 20px',
              borderRadius: '8px',
              border: '1px solid var(--border-subtle)',
              marginBottom: '16px',
              boxShadow: '0 1px 2px rgba(9, 30, 66, 0.05)'
            }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)' }}>Date:</label>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => handleDateChange(e.target.value)}
                    style={{ padding: '6px 12px', borderRadius: '6px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', fontSize: '13px', color: 'var(--text)' }}
                  />
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)' }}>Department:</label>
                  <select
                    value={department}
                    onChange={(e) => handleDeptChange(e.target.value)}
                    style={{ padding: '6px 12px', borderRadius: '6px', border: '1px solid var(--border)', fontSize: '13px', color: 'var(--text)', background: 'var(--bg-elevated)' }}
                  >
                    <option value="all">All Departments</option>
                    <option value="Engineering">Engineering</option>
                    <option value="Product">Product</option>
                    <option value="Design">Design</option>
                    <option value="QA">QA</option>
                    <option value="Operations">Operations</option>
                  </select>
                </div>
              </div>

              <form onSubmit={handleSearchSubmit} style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  placeholder="Search employee..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  style={{ padding: '6px 12px', borderRadius: '6px', background: 'var(--bg-elevated)', color: 'var(--text)', border: '1px solid var(--border)', fontSize: '13px', width: '200px' }}
                />
                <button
                  type="submit"
                  style={{ padding: '6px 14px', borderRadius: '6px', border: 'none', background: 'var(--primary)', color: 'var(--primary-text)', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
                >
                  Search
                </button>
              </form>
            </div>

            {/* Daily Status Banner if Holiday or Sunday */}
            {data.isSunday && (
              <div style={{ background: 'var(--bg-hover)', padding: '10px 16px', borderRadius: '6px', marginBottom: '16px', fontSize: '13px', color: 'var(--neutral-text)', fontWeight: 500 }}>
                📅 <strong>Sunday Official Weekly Off:</strong> Normal working day requirements do not apply.
              </div>
            )}
            {data.holiday?.isHoliday && (
              <div style={{ background: 'var(--bg-selected)', padding: '10px 16px', borderRadius: '6px', marginBottom: '16px', fontSize: '13px', color: 'var(--text-link)', fontWeight: 500 }}>
                🎉 <strong>Official Company Holiday:</strong> {data.holiday.name} {data.holiday.fallsOnSunday ? '(Sunday)' : ''}. Employees are not expected to work.
              </div>
            )}

            {/* Quick KPI Count Bar */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px', marginBottom: '20px' }}>
              <div style={{ background: 'var(--bg-elevated)', padding: '12px 16px', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-subtle)', textTransform: 'uppercase', fontWeight: 600 }}>Total Employees</span>
                <div style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text)' }}>{counts.totalEmployees || 0}</div>
              </div>
              <div style={{ background: 'var(--bg-elevated)', padding: '12px 16px', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-subtle)', textTransform: 'uppercase', fontWeight: 600 }}>Present / Full Day</span>
                <div style={{ fontSize: '20px', fontWeight: 700, color: '#166534' }}>{counts.presentTotal || 0}</div>
              </div>
              <div style={{ background: 'var(--bg-elevated)', padding: '12px 16px', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-subtle)', textTransform: 'uppercase', fontWeight: 600 }}>Late Arrivals</span>
                <div style={{ fontSize: '20px', fontWeight: 700, color: '#974f00' }}>{counts.lateTotal || 0}</div>
              </div>
              <div style={{ background: 'var(--bg-elevated)', padding: '12px 16px', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-subtle)', textTransform: 'uppercase', fontWeight: 600 }}>Half Days</span>
                <div style={{ fontSize: '20px', fontWeight: 700, color: '#6b21a8' }}>{counts.halfDayTotal || 0}</div>
              </div>
              <div style={{ background: 'var(--bg-elevated)', padding: '12px 16px', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-subtle)', textTransform: 'uppercase', fontWeight: 600 }}>Approved Leaves</span>
                <div style={{ fontSize: '20px', fontWeight: 700, color: '#581c87' }}>{counts.onLeaveTotal || 0}</div>
              </div>
              <div style={{ background: 'var(--bg-elevated)', padding: '12px 16px', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-subtle)', textTransform: 'uppercase', fontWeight: 600 }}>Confirmed Absences</span>
                <div style={{ fontSize: '20px', fontWeight: 700, color: '#991b1b' }}>{counts.confirmedAbsentTotal || 0}</div>
              </div>
              <div style={{ background: 'var(--bg-elevated)', padding: '12px 16px', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-subtle)', textTransform: 'uppercase', fontWeight: 600 }}>Unrecorded / Review</span>
                <div style={{ fontSize: '20px', fontWeight: 700, color: '#d97706' }}>{counts.unrecordedTotal || 0}</div>
              </div>
            </div>

            {/* Roster Table */}
            <div style={{ background: 'var(--bg-elevated)', borderRadius: '8px', border: '1px solid var(--border-subtle)', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                <thead>
                  <tr style={{ background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)', color: 'var(--text-subtle)' }}>
                    <th style={{ padding: '12px 16px', fontWeight: 600 }}>Employee</th>
                    <th style={{ padding: '12px 16px', fontWeight: 600 }}>Department</th>
                    <th style={{ padding: '12px 16px', fontWeight: 600 }}>Check-In</th>
                    <th style={{ padding: '12px 16px', fontWeight: 600 }}>Check-Out</th>
                    <th style={{ padding: '12px 16px', fontWeight: 600 }}>Duration</th>
                    <th style={{ padding: '12px 16px', fontWeight: 600 }}>Checkout Source</th>
                    <th style={{ padding: '12px 16px', fontWeight: 600 }}>Status</th>
                    <th style={{ padding: '12px 16px', fontWeight: 600, textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {roster.map((item) => {
                    const emp = item.employee;
                    const att = item.attendance;
                    const st = item.displayStatus;

                    return (
                      <tr key={emp.id} style={{ borderBottom: '1px solid var(--bg-hover)' }}>
                        <td style={{ padding: '12px 16px' }}>
                          <strong style={{ color: 'var(--text)', display: 'block' }}>{emp.name}</strong>
                          <span style={{ fontSize: '12px', color: 'var(--text-subtle)' }}>{emp.email || '—'}</span>
                        </td>
                        <td style={{ padding: '12px 16px', color: 'var(--text-subtle)' }}>{emp.department || 'General'}</td>
                        <td style={{ padding: '12px 16px', color: 'var(--text)' }}>
                          {att?.check_in_time ? formatKolkataTime(att.check_in_time) : '—'}
                        </td>
                        <td style={{ padding: '12px 16px', color: 'var(--text)' }}>
                          {att?.check_out_time ? formatKolkataTime(att.check_out_time) : att && att.status !== 'on_leave' && att.status !== 'absent' ? <span style={{ color: 'var(--danger)', fontWeight: 500 }}>In Progress</span> : '—'}
                        </td>
                        <td style={{ padding: '12px 16px', color: 'var(--text)' }}>
                          {att ? formatMinutes(att.net_duration_minutes) : '—'}
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          {att ? (
                            att.checkout_source === 'leave_approval' ? (
                              <span style={{ background: '#f3e8ff', color: '#6b21a8', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600 }}>
                                🏖️ Leave Approved
                              </span>
                            ) : att.checkout_source === 'task_sheet_submission' ? (
                              <span style={{ background: '#fff7d6', color: '#974f00', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600 }}>
                                Task Sheet Est.
                              </span>
                            ) : att.checkout_source === 'admin_adjustment' ? (
                              <span style={{ background: '#f3e8ff', color: '#6b21a8', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600 }}>
                                Admin Adjusted
                              </span>
                            ) : (
                              <span style={{ background: '#e3fcef', color: '#216e4e', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600 }}>
                                Actual
                              </span>
                            )
                          ) : '—'}
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          {st === 'present' && <span style={{ background: '#dcfce7', color: '#166534', padding: '3px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 600 }}>Present</span>}
                          {st === 'late' && <span style={{ background: '#fef3c7', color: '#92400e', padding: '3px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 600 }}>Late</span>}
                          {st === 'half_day' && (
                            <div>
                              <span style={{ background: '#f3e8ff', color: '#6b21a8', padding: '3px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 600 }}>Half Day</span>
                              {att?.leave_day_type && (
                                <div style={{ fontSize: '11px', color: '#581c87', marginTop: '2px' }}>
                                  {att.leave_day_type === 'first_half' ? '1st Half Leave' : '2nd Half Leave'}
                                </div>
                              )}
                            </div>
                          )}
                          {st === 'on_leave' && (
                            <span style={{ background: '#f3e8ff', color: '#581c87', padding: '3px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 600 }}>
                              🏖️ On Leave
                            </span>
                          )}
                          {st === 'absent' && <span style={{ background: '#fee2e2', color: '#991b1b', padding: '3px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 600 }}>Absent (Confirmed)</span>}
                          {st === 'unrecorded' && (
                            <span style={{ background: '#fffbeb', color: '#b45309', border: '1px dashed #f59e0b', padding: '3px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600 }}>
                              ⚠️ Unrecorded / Review
                            </span>
                          )}
                          {st === 'not_checked_in' && <span style={{ color: 'var(--text-disabled)', fontSize: '12px' }}>Not Checked In</span>}
                          {st === 'weekly_off' && <span style={{ color: 'var(--text-disabled)', fontSize: '12px' }}>Weekly Off</span>}
                          {st === 'holiday' && <span style={{ color: 'var(--text-link)', fontSize: '12px', fontWeight: 500 }}>Holiday ({item.holidayName})</span>}
                          {st === 'not_employed' && <span style={{ color: 'var(--text-disabled)', fontSize: '12px' }}>Not Joined Yet</span>}
                        </td>
                        <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                          <button
                            type="button"
                            onClick={() => openModal(item)}
                            style={{
                              padding: '5px 12px',
                              borderRadius: '4px',
                              border: '1px solid var(--border)',
                              background: 'var(--bg-elevated)',
                              color: 'var(--text-link)',
                              fontSize: '12px',
                              fontWeight: 600,
                              cursor: 'pointer'
                            }}
                          >
                            {att ? 'Correct' : 'Regularize'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* Tab 2: Leave Applications */}
        {activeTab === 'leaves' && (
          <AdminLeaveRequestsView
            onRosterRefresh={() => {
              fetchRoster(date, department, search);
              fetchPendingLeaves();
            }}
          />
        )}

        {/* Tab 3: Settings */}
        {activeTab === 'settings' && (
          <div style={{ background: 'var(--bg-elevated)', padding: '24px', borderRadius: '8px', border: '1px solid var(--border-subtle)', maxWidth: '600px' }}>
            <h3 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: 600, color: 'var(--text)' }}>
              Official Work Timings & Grace Configuration
            </h3>

            {settingsSuccess && (
              <div style={{ background: '#e3fcef', color: '#216e4e', padding: '10px 14px', borderRadius: '6px', fontSize: '13px', marginBottom: '16px' }}>
                {settingsSuccess}
              </div>
            )}

            <form onSubmit={handleSettingsSubmit}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '16px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--neutral-text)', marginBottom: '6px' }}>
                    Work Start Time
                  </label>
                  <input
                    type="time"
                    value={settings.work_start_time}
                    onChange={(e) => setSettings({ ...settings, work_start_time: e.target.value })}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', background: 'var(--bg-elevated)', color: 'var(--text)', border: '1px solid var(--border)', fontSize: '14px' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--neutral-text)', marginBottom: '6px' }}>
                    Work End Time
                  </label>
                  <input
                    type="time"
                    value={settings.work_end_time}
                    onChange={(e) => setSettings({ ...settings, work_end_time: e.target.value })}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', background: 'var(--bg-elevated)', color: 'var(--text)', border: '1px solid var(--border)', fontSize: '14px' }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '16px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--neutral-text)', marginBottom: '6px' }}>
                    Lunch Start Time
                  </label>
                  <input
                    type="time"
                    value={settings.lunch_start_time}
                    onChange={(e) => setSettings({ ...settings, lunch_start_time: e.target.value })}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', background: 'var(--bg-elevated)', color: 'var(--text)', border: '1px solid var(--border)', fontSize: '14px' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--neutral-text)', marginBottom: '6px' }}>
                    Lunch End Time
                  </label>
                  <input
                    type="time"
                    value={settings.lunch_end_time}
                    onChange={(e) => setSettings({ ...settings, lunch_end_time: e.target.value })}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', background: 'var(--bg-elevated)', color: 'var(--text)', border: '1px solid var(--border)', fontSize: '14px' }}
                  />
                </div>
              </div>

              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--neutral-text)', marginBottom: '6px' }}>
                  Grace Period (Minutes, Max 180):
                </label>
                <input
                  type="number"
                  min="0"
                  max="180"
                  value={settings.grace_period_minutes}
                  onChange={(e) => setSettings({ ...settings, grace_period_minutes: e.target.value })}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', background: 'var(--bg-elevated)', color: 'var(--text)', border: '1px solid var(--border)', fontSize: '14px' }}
                />
                <span style={{ fontSize: '12px', color: 'var(--text-subtle)', marginTop: '4px', display: 'block' }}>
                  Company default is 150 minutes (arrival up to 11:30 AM is Present). Fixed threshold priority: 12:01 PM onward is always Half Day.
                </span>
              </div>

              <button
                type="submit"
                disabled={settingsSaving}
                style={{
                  padding: '10px 20px',
                  borderRadius: '6px',
                  border: 'none',
                  background: 'var(--primary)',
                  color: 'var(--primary-text)',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: settingsSaving ? 'not-allowed' : 'pointer'
                }}
              >
                {settingsSaving ? 'Saving Settings...' : 'Save Settings'}
              </button>
            </form>
          </div>
        )}

        {/* Tab 4: Holidays */}
        {activeTab === 'holidays' && (
          <div style={{ background: 'var(--bg-elevated)', borderRadius: '8px', border: '1px solid var(--border-subtle)', padding: '20px', overflowX: 'auto' }}>
            <h3 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: 600, color: 'var(--text)' }}>
              Official Company Holiday Calendar (2026)
            </h3>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
              <thead>
                <tr style={{ background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)', color: 'var(--text-subtle)' }}>
                  <th style={{ padding: '10px 14px' }}>Date</th>
                  <th style={{ padding: '10px 14px' }}>Holiday Name</th>
                  <th style={{ padding: '10px 14px' }}>Type</th>
                  <th style={{ padding: '10px 14px' }}>Sunday Collision</th>
                </tr>
              </thead>
              <tbody>
                {holidays.map((h) => (
                  <tr key={h.id || h.holiday_date} style={{ borderBottom: '1px solid var(--bg-hover)' }}>
                    <td style={{ padding: '10px 14px', fontWeight: 600, color: 'var(--text)' }}>{h.holiday_date}</td>
                    <td style={{ padding: '10px 14px', color: 'var(--text)' }}>{h.name}</td>
                    <td style={{ padding: '10px 14px' }}>
                      {h.is_recurring === 1 ? (
                        <span style={{ background: 'var(--bg-selected)', color: 'var(--text-link)', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600 }}>
                          Recurring Annual
                        </span>
                      ) : (
                        <span style={{ background: 'var(--bg-hover)', color: 'var(--neutral-text)', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600 }}>
                          2026 Festival
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '10px 14px', color: 'var(--text-subtle)' }}>
                      {h.falls_on_sunday === 1 ? 'Yes (Sunday off, no carry-forward)' : 'No'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Regularization / Correction Modal */}
        {selectedItem && (
          <AdminAttendanceModal
            isOpen={modalOpen}
            onClose={() => { setModalOpen(false); setSelectedItem(null); }}
            employee={selectedItem.employee}
            workDate={date}
            attendance={selectedItem.attendance}
            onSaved={() => fetchRoster(date, department, search)}
          />
        )}
      </div>
    </AppShell>
  );
}

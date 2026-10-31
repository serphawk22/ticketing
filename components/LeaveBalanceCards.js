'use client';

import React, { useState } from 'react';

const CATEGORY_ICONS = {
  casual: '🏖️',
  sick: '🩺',
  optional: '⭐',
  earned: '💼',
  maternity: '🤰',
  paternity: '🍼',
  bereavement: '🕊️',
  comp_off: '⏱️',
};

export default function LeaveBalanceCards({ balanceData, loading = false, onRefresh = null }) {
  const [showHolidaysList, setShowHolidaysList] = useState(false);

  if (loading) {
    return (
      <div style={{
        background: '#ffffff',
        border: '1px solid #ebecf0',
        borderRadius: '8px',
        padding: '24px',
        textAlign: 'center',
        color: '#626f86',
        marginBottom: '20px'
      }}>
        Loading real-time leave balances...
      </div>
    );
  }

  const data = balanceData?.balances || balanceData;
  if (!data || !data.categories) {
    return null;
  }

  const { fiscalYear, categories, employee } = data;
  const holidays = categories.holidays || {
    totalConfigured: 13,
    totalEntitlement: 13,
    elapsedCount: 0,
    upcomingCount: 0,
    holidaysList: [],
  };

  const cardStyle = {
    background: '#ffffff',
    border: '1px solid #dfe1e6',
    borderRadius: '8px',
    padding: '18px 20px',
    boxShadow: '0 1px 2px rgba(9, 30, 66, 0.05)',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    minHeight: '260px',
  };

  const headerStyle = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    borderBottom: '1px solid #f4f5f7',
    paddingBottom: '12px',
    marginBottom: '14px',
  };

  const badgeStyle = (bg, color) => ({
    padding: '2px 8px',
    borderRadius: '12px',
    fontSize: '11px',
    fontWeight: 700,
    background: bg,
    color: color,
    whiteSpace: 'nowrap',
  });

  const rowStyle = {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '12px',
    marginBottom: '6px',
    color: '#44546f',
  };

  const valStyle = {
    fontWeight: 600,
    color: '#172b4d',
  };

  // Get active categories excluding holidays
  const categoryEntries = Object.entries(categories).filter(([key, cat]) => {
    if (key === 'holidays') return false;
    // Don't hide casual/sick/optional even if disabled unless explicitly inactive
    if (cat.is_active === false) return false;
    return true;
  });

  return (
    <div style={{ marginBottom: '24px' }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '12px',
        flexWrap: 'wrap',
        gap: '8px'
      }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#172b4d' }}>
            📊 Leave Balances & Entitlements
          </h3>
          <span style={{ fontSize: '12px', color: '#626f86' }}>
            Financial Year: <strong>{fiscalYear}</strong>
            {employee?.employment_type && (
              <> · Employment Type: <strong style={{ textTransform: 'capitalize' }}>{employee.employment_type.replace('_', ' ')}</strong></>
            )}
            {employee?.workspace_id && (
              <> · Company Policy Applied</>
            )}
          </span>
        </div>
        {onRefresh && (
          <button
            onClick={onRefresh}
            style={{
              background: '#f4f5f7',
              border: '1px solid #dfe1e6',
              borderRadius: '4px',
              padding: '4px 10px',
              fontSize: '12px',
              cursor: 'pointer',
              color: '#172b4d',
              fontWeight: 600,
            }}
          >
            ↻ Refresh Balances
          </button>
        )}
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
        gap: '16px'
      }}>
        {/* Dynamic Category Cards */}
        {categoryEntries.map(([code, cat]) => {
          const icon = CATEGORY_ICONS[code] || '📋';
          const isEligible = cat.isEligible !== false;
          const isConfigured = cat.isConfigured !== false;
          const remaining = cat.remainingBalance ?? 0;

          return (
            <div key={code} style={cardStyle}>
              <div>
                <div style={headerStyle}>
                  <div>
                    <div style={{ fontSize: '14px', fontWeight: 700, color: '#172b4d' }}>
                      {icon} {cat.name || code.toUpperCase()} ({code.toUpperCase()})
                    </div>
                    <div style={{ fontSize: '11px', color: '#626f86' }}>
                      {cat.isPaid ? 'Paid' : 'Unpaid (LOP)'} · {cat.carryForwardEnabled ? 'CF Eligible' : 'Non-CF'}
                    </div>
                  </div>
                  <div>
                    {!isConfigured ? (
                      <span style={badgeStyle('#f4f5f7', '#626f86')}>Disabled</span>
                    ) : !isEligible ? (
                      <span style={badgeStyle('#ffebe6', '#bf2600')}>Ineligible</span>
                    ) : cat.carryForwardEnabled ? (
                      <span style={badgeStyle('#e3fcef', '#006644')}>CF Eligible</span>
                    ) : (
                      <span style={badgeStyle('#deebff', '#0747a6')}>Upfront</span>
                    )}
                  </div>
                </div>

                {!isConfigured ? (
                  <div style={{
                    background: '#f4f5f7',
                    borderRadius: '6px',
                    padding: '12px',
                    fontSize: '12px',
                    color: '#626f86',
                    lineHeight: '1.5',
                    marginTop: '10px'
                  }}>
                    This leave category is currently disabled for your organization.
                  </div>
                ) : !isEligible ? (
                  <div style={{
                    background: '#ffebe6',
                    borderRadius: '6px',
                    padding: '12px',
                    fontSize: '12px',
                    color: '#bf2600',
                    lineHeight: '1.5',
                    marginTop: '10px'
                  }}>
                    {cat.name || code} is restricted to eligible employment types. You are currently not eligible to apply for this category.
                  </div>
                ) : (
                  <>
                    <div style={rowStyle}>
                      <span>Annual Entitlement:</span>
                      <span style={valStyle}>{(cat.annualEntitlement ?? 0).toFixed(1)}d</span>
                    </div>
                    <div style={rowStyle}>
                      <span>Accrued Entitlement:</span>
                      <span style={valStyle}>{(cat.accruedEntitlement ?? 0).toFixed(1)}d</span>
                    </div>
                    {cat.carryForwardEnabled && (
                      <div style={rowStyle}>
                        <span>Carried Forward (Prior FY):</span>
                        <span style={{ ...valStyle, color: '#006644' }}>
                          +{(cat.carriedForward ?? 0).toFixed(1)}d
                        </span>
                      </div>
                    )}
                    {cat.manualAdjustment !== 0 && cat.manualAdjustment != null && (
                      <div style={rowStyle}>
                        <span>Admin Adjustment:</span>
                        <span style={{ ...valStyle, color: cat.manualAdjustment > 0 ? '#006644' : '#bf2600' }}>
                          {cat.manualAdjustment > 0 ? `+${cat.manualAdjustment.toFixed(1)}` : cat.manualAdjustment.toFixed(1)}d
                        </span>
                      </div>
                    )}
                    <div style={rowStyle}>
                      <span>Total Days Applied:</span>
                      <span style={valStyle}>{(cat.totalApplied ?? 0).toFixed(1)}d</span>
                    </div>
                    <div style={rowStyle}>
                      <span>Pending Requests:</span>
                      <span style={{ ...valStyle, color: (cat.pendingDays ?? 0) > 0 ? '#ff8b00' : '#44546f' }}>
                        {(cat.pendingDays ?? 0).toFixed(1)}d
                      </span>
                    </div>
                    <div style={rowStyle}>
                      <span>Approved Leave:</span>
                      <span style={{ ...valStyle, color: '#0c66e4' }}>{(cat.approvedDays ?? 0).toFixed(1)}d</span>
                    </div>
                    <div style={rowStyle}>
                      <span>Days Actually Taken:</span>
                      <span style={valStyle}>{(cat.takenDays ?? 0).toFixed(1)}d</span>
                    </div>
                    {((cat.rejectedDays ?? 0) > 0 || (cat.cancelledDays ?? 0) > 0) && (
                      <div style={rowStyle}>
                        <span>Rejected / Cancelled:</span>
                        <span style={{ fontSize: '11px', color: '#626f86' }}>
                          {(cat.rejectedDays ?? 0).toFixed(1)}d rej · {(cat.cancelledDays ?? 0).toFixed(1)}d canc
                        </span>
                      </div>
                    )}
                  </>
                )}
              </div>

              <div style={{
                marginTop: '14px',
                paddingTop: '10px',
                borderTop: '2px solid #ebecf0',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}>
                <span style={{ fontSize: '13px', fontWeight: 700, color: '#172b4d' }}>Remaining Balance:</span>
                <span style={{
                  fontSize: '18px',
                  fontWeight: 800,
                  color: !isConfigured || !isEligible ? '#626f86' : (remaining > 0 ? '#006644' : '#bf2600'),
                }}>
                  {!isConfigured || !isEligible ? '—' : `${remaining.toFixed(1)}d`}
                </span>
              </div>
            </div>
          );
        })}

        {/* Dedicated National & Festival Holidays Card */}
        <div style={cardStyle}>
          <div>
            <div style={headerStyle}>
              <div>
                <div style={{ fontSize: '14px', fontWeight: 700, color: '#172b4d' }}>
                  📅 National & Festival Holidays
                </div>
                <div style={{ fontSize: '11px', color: '#626f86' }}>
                  All Employees Eligible · Company Calendar
                </div>
              </div>
              <span style={badgeStyle('#e3fcef', '#006644')}>All Eligible</span>
            </div>

            <div style={rowStyle}>
              <span>Total Configured Holidays:</span>
              <span style={{ ...valStyle, color: '#0c66e4' }}>
                {holidays.totalConfigured ?? 13} days
              </span>
            </div>
            <div style={rowStyle}>
              <span>Elapsed Holidays (to date):</span>
              <span style={valStyle}>{holidays.elapsedCount ?? 0} days</span>
            </div>
            <div style={rowStyle}>
              <span>Upcoming Holidays:</span>
              <span style={{ ...valStyle, color: '#006644' }}>{holidays.upcomingCount ?? 0} days</span>
            </div>

            <div style={{
              background: '#f4f5f7',
              borderRadius: '6px',
              padding: '10px',
              fontSize: '11px',
              color: '#626f86',
              lineHeight: '1.4',
              marginTop: '10px'
            }}>
              National and festival holidays are tracked separately from leave balances and never deducted from Casual or Sick Leave.
            </div>

            {holidays.holidaysList && holidays.holidaysList.length > 0 && (
              <div style={{ marginTop: '10px' }}>
                <button
                  type="button"
                  onClick={() => setShowHolidaysList(!showHolidaysList)}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    color: '#0c66e4',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    textDecoration: 'underline'
                  }}
                >
                  {showHolidaysList ? 'Hide Holiday Schedule' : `View Holiday Schedule (${holidays.holidaysList.length})`}
                </button>

                {showHolidaysList && (
                  <div style={{
                    maxHeight: '140px',
                    overflowY: 'auto',
                    border: '1px solid #dfe1e6',
                    borderRadius: '4px',
                    marginTop: '6px',
                    fontSize: '11px'
                  }}>
                    {holidays.holidaysList.map((h) => (
                      <div
                        key={h.id || h.holiday_date}
                        style={{
                          padding: '4px 8px',
                          display: 'flex',
                          justifyContent: 'space-between',
                          borderBottom: '1px solid #f4f5f7'
                        }}
                      >
                        <span style={{ fontWeight: 600, color: '#172b4d' }}>{h.name}</span>
                        <span style={{ color: '#626f86' }}>{h.holiday_date}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div style={{
            marginTop: '14px',
            paddingTop: '10px',
            borderTop: '2px solid #ebecf0',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <span style={{ fontSize: '13px', fontWeight: 700, color: '#172b4d' }}>Available Holidays:</span>
            <span style={{ fontSize: '18px', fontWeight: 800, color: '#006644' }}>
              {holidays.upcomingCount ?? 0} upcoming
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

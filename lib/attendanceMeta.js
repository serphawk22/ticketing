import { toKolkata, parseUtcDate } from './businessHours.js';

export const DEFAULT_ATTENDANCE_SETTINGS = {
  work_start_time: '09:00',
  work_end_time: '17:00',
  lunch_start_time: '12:30',
  lunch_end_time: '13:00',
  grace_period_minutes: 150,
  max_grace_period_limit: 180,
  timezone: 'Asia/Kolkata',
};

export const LEAVE_TYPES = [
  { key: 'casual', label: 'Casual Leave (CL)' },
  { key: 'sick', label: 'Sick Leave (SL)' },
  { key: 'paid', label: 'Paid Leave (PL)' },
  { key: 'optional', label: 'Optional Leave' },
  { key: 'unpaid', label: 'Unpaid Leave (UL)' },
  { key: 'other', label: 'Other Leave' },
];

export function getLeaveTypeLabel(type) {
  if (type === 'paid') return 'Paid Leave (PL)';
  const found = LEAVE_TYPES.find((t) => t.key === type);
  return found ? found.label : (type || 'Leave');
}

export function getLeaveDayTypeLabel(dayType) {
  if (dayType === 'first_half') return 'First Half (09:00 AM – 01:00 PM)';
  if (dayType === 'second_half') return 'Second Half (01:00 PM – 05:00 PM)';
  return 'Full Day (09:00 AM – 05:00 PM)';
}

/**
 * Format total minutes as a readable string: "7h 30m"
 */
export function formatMinutes(mins) {
  if (!mins || mins <= 0) return '0m';
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/**
 * Format ISO UTC timestamp to local Asia/Kolkata 12-hour time: "09:15 AM"
 */
export function formatKolkataTime(dateInput) {
  const kd = toKolkata(dateInput);
  if (!kd) return '—';
  const h = kd.getUTCHours();
  const m = kd.getUTCMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  const padM = String(m).padStart(2, '0');
  return `${h12}:${padM} ${ampm}`;
}

/**
 * Calculate attendance status based on server check-in timestamp in Asia/Kolkata.
 * 
 * Standard Boundaries (No Leave):
 * - Before 11:30:00 AM: Present / Full Day ('present')
 * - Exactly 11:30:00 AM through 12:00:59 PM inclusive: Late ('late')
 * - At or after 12:01:00 PM: Half Day ('half_day')
 * - Priority: Half Day overrides Late from 12:01 PM onward. 12:00 PM is never Half Day.
 * - If Sunday or company holiday: Marked 'present' without late penalties.
 * 
 * Dedicated Second-Half Arrival Window (Approved First-Half Leave):
 * - Window: 12:45 PM to 01:15 PM (01:00 PM shift start with 15m grace)
 * - Arriving <= 01:15:00 PM: On-time second half ('half_day', isLate: false, '1st Half Leave + Worked')
 * - Arriving > 01:15:00 PM: Late second half ('half_day', isLate: true, 'Late 2nd Half Arrival')
 * 
 * Approved Second-Half Leave:
 * - Expected morning work (09:00 AM - 01:00 PM)
 * - Arriving < 11:30 AM: ('half_day', isLate: false, 'Worked + 2nd Half Leave')
 */
export function calculateAttendanceStatus({
  checkInDate,
  isSundayOrHoliday = false,
  leaveInfo = null,
}) {
  if (isSundayOrHoliday) {
    return { status: 'present', isLate: false, isHalfDay: false, lateMinutes: 0, leaveSubBadge: null };
  }

  const kd = toKolkata(checkInDate);
  if (!kd) {
    return { status: 'present', isLate: false, isHalfDay: false, lateMinutes: 0, leaveSubBadge: null };
  }

  const hours = kd.getUTCHours();
  const minutes = kd.getUTCMinutes();
  const seconds = kd.getUTCSeconds();
  const totalSeconds = hours * 3600 + minutes * 60 + seconds;

  // 1. Exception for Approved First-Half Leave
  if (leaveInfo && leaveInfo.dayType === 'first_half') {
    // 01:15:00 PM = 13*3600 + 15*60 = 47,700s
    const secondHalfCutoff = 13 * 3600 + 15 * 60;

    if (totalSeconds <= secondHalfCutoff) {
      return {
        status: 'half_day',
        isLate: false,
        isHalfDay: true,
        lateMinutes: 0,
        leaveSubBadge: '1st Half Leave + Worked',
      };
    } else {
      const lateMins = Math.max(0, Math.floor((totalSeconds - (13 * 3600)) / 60));
      return {
        status: 'half_day',
        isLate: true,
        isHalfDay: true,
        lateMinutes: lateMins,
        leaveSubBadge: 'Late 2nd Half Arrival',
      };
    }
  }

  // 2. Exception for Approved Second-Half Leave
  if (leaveInfo && leaveInfo.dayType === 'second_half') {
    const lateCutoffSeconds = 11 * 3600 + 30 * 60;
    if (totalSeconds >= lateCutoffSeconds) {
      const lateMins = Math.max(0, Math.floor((totalSeconds - (9 * 3600)) / 60));
      return {
        status: 'half_day',
        isLate: true,
        isHalfDay: true,
        lateMinutes: lateMins,
        leaveSubBadge: 'Late Morning + 2nd Half Leave',
      };
    }
    return {
      status: 'half_day',
      isLate: false,
      isHalfDay: true,
      lateMinutes: 0,
      leaveSubBadge: 'Worked + 2nd Half Leave',
    };
  }

  // 3. Exact Standard Fixed Boundaries (Unchanged for Employees Without Approved Leave)
  // 11:30:00 AM = 11*3600 + 30*60 = 41,400s
  const lateCutoffSeconds = 11 * 3600 + 30 * 60;
  // 12:00:59 PM = 12*3600 + 0*60 + 59 = 43,259s
  const lateUpperSeconds = 12 * 3600 + 59;
  // 12:01:00 PM = 12*3600 + 1*60 = 43,260s
  const halfDayCutoffSeconds = 12 * 3600 + 60;

  // Half Day takes priority at and after 12:01:00 PM
  if (totalSeconds >= halfDayCutoffSeconds) {
    const lateMinutes = Math.max(0, Math.floor((totalSeconds - (9 * 3600)) / 60));
    return { status: 'half_day', isLate: false, isHalfDay: true, lateMinutes, leaveSubBadge: null };
  }

  // Late: 11:30:00 AM through 12:00:59 PM inclusive
  if (totalSeconds >= lateCutoffSeconds && totalSeconds <= lateUpperSeconds) {
    const lateMinutes = Math.max(0, Math.floor((totalSeconds - (9 * 3600)) / 60));
    return { status: 'late', isLate: true, isHalfDay: false, lateMinutes, leaveSubBadge: null };
  }

  // Before 11:30:00 AM: Present / Full Day
  return { status: 'present', isLate: false, isHalfDay: false, lateMinutes: 0, leaveSubBadge: null };
}

/**
 * Calculate lunch break deduction in minutes.
 * Configured Lunch: 12:30 PM to 1:00 PM (12:30 to 13:00, 30 min) Asia/Kolkata.
 * Subtracts the exact overlap between [checkIn, checkOut] and [12:30, 13:00].
 * Capped at 30 minutes, never subtracted twice.
 */
export function calculateLunchDeduction(checkInDate, checkOutDate) {
  const kin = toKolkata(checkInDate);
  const kout = toKolkata(checkOutDate);
  if (!kin || !kout || kout.getTime() <= kin.getTime()) return 0;

  const dayStartMs = Date.UTC(kin.getUTCFullYear(), kin.getUTCMonth(), kin.getUTCDate(), 0, 0, 0);
  const lunchStartMs = dayStartMs + (12 * 3600 + 30 * 60) * 1000;
  const lunchEndMs = dayStartMs + (13 * 3600) * 1000;

  const inMs = kin.getTime();
  const outMs = kout.getTime();

  const overlapMs = Math.max(0, Math.min(outMs, lunchEndMs) - Math.max(inMs, lunchStartMs));
  const overlapMinutes = Math.round(overlapMs / 60000);

  return Math.min(30, Math.max(0, overlapMinutes));
}

/**
 * Calculate total durations (gross, lunch deduction, net) in minutes
 */
export function calculateAttendanceDurations(checkInDate, checkOutDate) {
  const inDate = parseUtcDate(checkInDate);
  const outDate = parseUtcDate(checkOutDate);
  if (!inDate || !outDate || outDate.getTime() <= inDate.getTime()) {
    return { grossMinutes: 0, breakMinutes: 0, netMinutes: 0 };
  }

  const grossMinutes = Math.max(0, Math.round((outDate.getTime() - inDate.getTime()) / 60000));
  const breakMinutes = calculateLunchDeduction(inDate, outDate);
  const netMinutes = Math.max(0, grossMinutes - breakMinutes);

  return { grossMinutes, breakMinutes, netMinutes };
}

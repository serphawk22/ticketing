import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB_PATH = path.resolve(__dirname, '../data/test_phase3_isolated.db');

for (const ext of ['', '-wal', '-shm']) {
  if (fs.existsSync(TEST_DB_PATH + ext)) fs.unlinkSync(TEST_DB_PATH + ext);
}

process.env.DB_DRIVER = 'sqlite';
process.env.SQLITE_DB_PATH = TEST_DB_PATH;
delete process.env.POSTGRES_URL;
delete process.env.DATABASE_URL;

const { db } = await import('../lib/db.js');
const { calculateDurationsBetween } = await import('../lib/businessHours.js');
const {
  loadScheduleContext,
  calculateDurationsWithDb,
  createScheduleVersion,
  verifyBaselineSchedule,
} = await import('../lib/businessScheduleService.js');
const { resolveDateRange, isWithinRange } = await import('../lib/dateFilters.js');

after(() => {
  try {
    db.close();
  } catch {
    // ignore
  }
  for (const ext of ['', '-wal', '-shm']) {
    if (fs.existsSync(TEST_DB_PATH + ext)) fs.unlinkSync(TEST_DB_PATH + ext);
  }
});

test('Phase 3: Dual-Clock Sat 15:00 IST -> Mon 11:00 IST benchmark & Holiday exclusions', () => {
  const startUtc = '2026-10-24T09:30:00Z'; // Sat 15:00 IST
  const endUtc = '2026-10-26T05:30:00Z';   // Mon 11:00 IST

  const baseSched = [
    {
      id: 1,
      effective_from: '2026-10-24',
      effective_to: null,
      work_start_time: '09:00',
      work_end_time: '17:00',
      working_days_json: '[1,2,3,4,5,6]',
      effective_date_status: 'provisional_inferred_from_settings',
    },
  ];

  const noHoliday = calculateDurationsBetween(startUtc, endUtc, { schedules: baseSched, holidays: [] });
  assert.equal(noHoliday.calendarSeconds, 44 * 3600);
  assert.equal(noHoliday.businessSeconds, 4 * 3600);
  assert.equal(noHoliday.precision, 'provisional_baseline');

  // Exact date holiday on Monday 2026-10-26 -> only Saturday 2h counts
  const exactHoliday = calculateDurationsBetween(startUtc, endUtc, {
    schedules: baseSched,
    holidays: [{ holiday_date: '2026-10-26', is_recurring: 0 }],
  });
  assert.equal(exactHoliday.calendarSeconds, 44 * 3600);
  assert.equal(exactHoliday.businessSeconds, 2 * 3600);

  // Recurring holiday from previous year 2025-10-26 -> also excludes Monday
  const recurringHoliday = calculateDurationsBetween(startUtc, endUtc, {
    schedules: baseSched,
    holidays: [{ holiday_date: '2025-10-26', is_recurring: 1 }],
  });
  assert.equal(recurringHoliday.businessSeconds, 2 * 3600);
});

test('Phase 3: Pre-schedule estimation, Mixed boundary, Baseline verification & Schedule Versioning', async () => {
  const adminRes = await db
    .prepare("INSERT INTO users (name, email, password, role) VALUES ('Owner P3', 'ownerp3@test.local', 'hash', 'owner')")
    .run();
  const actor = { id: Number(adminRes.lastInsertRowid), name: 'Owner P3' };

  // Pre-schedule 2026-10-24 range
  const preRes = await calculateDurationsWithDb('2026-10-12T03:30:00Z', '2026-10-12T11:30:00Z'); // Mon 09:00..17:00 IST
  assert.equal(preRes.businessSeconds, 8 * 3600);
  assert.equal(preRes.precision, 'estimated_pre_schedule');

  // Range spanning across 2026-10-23 -> 2026-10-24
  const spanRes = await calculateDurationsWithDb('2026-10-23T09:30:00Z', '2026-10-24T05:30:00Z'); // Fri 15:00..Sat 11:00 IST
  assert.equal(spanRes.businessSeconds, 4 * 3600);
  assert.equal(spanRes.precision, 'mixed_estimated');

  // Owner verifies baseline starting 2026-10-24
  const verifiedBaseline = await verifyBaselineSchedule({
    actor,
    effectiveFrom: '2026-10-24',
    reason: 'Confirmed by Owner from HR records',
  });
  assert.equal(verifiedBaseline.effective_date_status, 'owner_confirmed');

  const postVerify = await calculateDurationsWithDb('2026-10-24T09:30:00Z', '2026-10-26T05:30:00Z');
  assert.equal(postVerify.precision, 'verified');
  assert.equal(postVerify.businessSeconds, 4 * 3600);

  // Add new schedule effective 2026-11-01 (Mon-Fri 10:00-18:00, Saturday OFF)
  const v2 = await createScheduleVersion({
    actor,
    effectiveFrom: '2026-11-01',
    workStartTime: '10:00',
    workEndTime: '18:00',
    workingDays: [1, 2, 3, 4, 5],
    reason: 'November 5-day policy update',
  });
  assert.equal(v2.effective_from, '2026-11-01');

  const ctx = await loadScheduleContext();
  assert.equal(ctx.schedules.length, 2);
  assert.equal(ctx.schedules[0].effective_to, '2026-10-31');

  // Check Saturday Nov 7 2026 -> 0 business hours under v2!
  const novSat = await calculateDurationsWithDb('2026-11-07T04:30:00Z', '2026-11-07T11:30:00Z'); // Sat 10:00..17:00 IST
  assert.equal(novSat.businessSeconds, 0);
  assert.equal(novSat.calendarSeconds, 7 * 3600);
});

test('Phase 3: IST dateFilters handles late-night UTC boundary & yesterday / last_month presets', () => {
  // 2026-11-10T20:00:00Z === 2026-11-11 01:30:00 IST!
  const ref = new Date('2026-11-10T20:00:00Z');

  const today = resolveDateRange({ preset: 'today', referenceDate: ref });
  assert.equal(today.startDate, '2026-11-11');
  assert.equal(today.endDate, '2026-11-11');
  assert.equal(today.startIso, '2026-11-10T18:30:00.000Z');
  assert.equal(today.endIso, '2026-11-11T18:29:59.999Z');
  assert.equal(isWithinRange('2026-11-11', today.startMs, today.endMs), true);
  assert.equal(isWithinRange('2026-11-10', today.startMs, today.endMs), false);

  const yesterday = resolveDateRange({ preset: 'yesterday', referenceDate: ref });
  assert.equal(yesterday.startDate, '2026-11-10');
  assert.equal(yesterday.endDate, '2026-11-10');
  assert.equal(isWithinRange('2026-11-10', yesterday.startMs, yesterday.endMs), true);

  const lastMonth = resolveDateRange({ preset: 'last_month', referenceDate: ref });
  assert.equal(lastMonth.startDate, '2026-10-01');
  assert.equal(lastMonth.endDate, '2026-10-31');
  assert.equal(lastMonth.startIso, '2026-09-30T18:30:00.000Z');
  assert.equal(lastMonth.endIso, '2026-10-31T18:29:59.999Z');

  // Verify YYYY-MM-DD work_date edge
  assert.equal(isWithinRange('2026-10-31', lastMonth.startMs, lastMonth.endMs), true);
  assert.equal(isWithinRange('2026-11-01', lastMonth.startMs, lastMonth.endMs), false);
});

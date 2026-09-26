// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { hubWeek, shiftNudgeDue, type NudgeInput, weekNeedsShifts } from './nudge.js';

const sec = (iso: string) => Date.parse(iso) / 1000;

describe('hubWeek', () => {
  it('uses the hub time zone, not UTC: Sunday 22:30 UTC is already Monday in Rome', () => {
    const now = sec('2026-09-27T22:30:00Z');
    expect(hubWeek(now, 'UTC').key).toBe('2026-09-21');
    expect(hubWeek(now, 'Europe/Rome').key).toBe('2026-09-28');
  });

  it('spans local Monday 00:00 to the next local Monday 00:00', () => {
    const w = hubWeek(sec('2026-09-30T12:00:00Z'), 'Europe/Rome');
    expect(w.start).toBe(sec('2026-09-27T22:00:00Z'));
    expect(w.end).toBe(sec('2026-10-04T22:00:00Z'));
  });

  it('stays correct across a daylight-saving change', () => {
    // Rome leaves CEST on Sunday 2026-10-25.
    const w = hubWeek(sec('2026-10-21T12:00:00Z'), 'Europe/Rome');
    expect(w.start).toBe(sec('2026-10-18T22:00:00Z'));
    expect(w.end).toBe(sec('2026-10-25T23:00:00Z'));
  });

  it('falls back to UTC for an unknown time zone', () => {
    expect(hubWeek(sec('2026-09-30T12:00:00Z'), 'Not/AZone').key).toBe('2026-09-28');
  });
});

describe('shiftNudgeDue (AC-c6)', () => {
  const now = sec('2026-09-30T10:00:00Z'); // Wednesday
  const base: NudgeInput = {
    nowSec: now,
    timezone: 'UTC',
    loggedIn: true,
    boardMode: false,
    isAdmin: false,
    snoozedWeek: null,
    myShiftStarts: [],
    joinableShiftStarts: [sec('2026-10-02T09:00:00Z')],
  };

  it('shows for a logged-in resident with 0 or 1 shifts this week', () => {
    expect(shiftNudgeDue(base)).toBe(true);
    expect(shiftNudgeDue({ ...base, myShiftStarts: [sec('2026-09-28T09:00:00Z')] })).toBe(true);
  });

  it('does not show once the resident has reached the threshold', () => {
    const two = [sec('2026-09-28T09:00:00Z'), sec('2026-10-03T09:00:00Z')];
    expect(shiftNudgeDue({ ...base, myShiftStarts: two })).toBe(false);
  });

  it('counts only shifts inside this hub week', () => {
    const one = [sec('2026-09-28T09:00:00Z'), sec('2026-10-06T09:00:00Z')]; // second is next week
    expect(shiftNudgeDue({ ...base, myShiftStarts: one })).toBe(true);
  });

  it('respects a custom threshold', () => {
    expect(shiftNudgeDue({ ...base, threshold: 1, myShiftStarts: [sec('2026-09-28T09:00:00Z')] })).toBe(false);
  });

  it('never shows logged out, on the shared board, or to the admin', () => {
    expect(shiftNudgeDue({ ...base, loggedIn: false })).toBe(false);
    expect(shiftNudgeDue({ ...base, boardMode: true })).toBe(false);
    expect(shiftNudgeDue({ ...base, isAdmin: true })).toBe(false);
  });

  it('does not show when every remaining shift this week is full', () => {
    expect(shiftNudgeDue({ ...base, joinableShiftStarts: [] })).toBe(false);
    // A joinable shift that already started, or is next week, does not count.
    expect(shiftNudgeDue({ ...base, joinableShiftStarts: [sec('2026-09-29T09:00:00Z'), sec('2026-10-06T09:00:00Z')] })).toBe(false);
  });

  it('a "not this week" snooze holds for this week only', () => {
    expect(shiftNudgeDue({ ...base, snoozedWeek: hubWeek(now, 'UTC').key })).toBe(false);
    expect(shiftNudgeDue({ ...base, snoozedWeek: '2026-09-21' })).toBe(true);
  });
});

describe('weekNeedsShifts (the programme\'s red glow)', () => {
  const now = sec('2026-09-30T10:00:00Z'); // Wednesday
  const open = [sec('2026-10-02T09:00:00Z'), sec('2026-10-07T09:00:00Z'), sec('2026-10-14T09:00:00Z')];
  const base = { nowSec: now, timezone: 'UTC', myShiftStarts: [] as number[], joinableShiftStarts: open };

  it('is on for the viewed week when the viewer has fewer than 2 shifts in it', () => {
    expect(weekNeedsShifts({ ...base, viewDate: '2026-10-01' })).toBe(true);
    expect(weekNeedsShifts({ ...base, viewDate: '2026-10-01', myShiftStarts: [sec('2026-09-28T09:00:00Z')] })).toBe(true);
    expect(weekNeedsShifts({ ...base, viewDate: '2026-10-01', myShiftStarts: [sec('2026-09-28T09:00:00Z'), sec('2026-10-04T09:00:00Z')] })).toBe(false);
  });

  it('judges the week of the viewed date, not the current week', () => {
    const nextWeek = '2026-10-07';
    const twoThisWeek = [sec('2026-09-28T09:00:00Z'), sec('2026-09-29T09:00:00Z')];
    expect(weekNeedsShifts({ ...base, viewDate: nextWeek, myShiftStarts: twoThisWeek })).toBe(true);
    expect(weekNeedsShifts({ ...base, viewDate: '2026-09-28', myShiftStarts: twoThisWeek })).toBe(false);
  });

  it('is off for weeks that are over', () => {
    expect(weekNeedsShifts({ ...base, viewDate: '2026-09-21' })).toBe(false);
  });

  it('uses the hub time zone and a custom threshold', () => {
    // Sunday 22:30 UTC is Monday in Rome: a shift then counts for the next Rome week.
    const shift = [sec('2026-10-04T22:30:00Z')];
    expect(weekNeedsShifts({ ...base, timezone: 'Europe/Rome', viewDate: '2026-10-05', myShiftStarts: shift, threshold: 1 })).toBe(false);
    expect(weekNeedsShifts({ ...base, timezone: 'Europe/Rome', viewDate: '2026-10-01', myShiftStarts: shift, threshold: 1 })).toBe(true);
  });

  it('stays off when nothing in the viewed week can still be joined', () => {
    expect(weekNeedsShifts({ ...base, viewDate: '2026-10-01', joinableShiftStarts: [] })).toBe(false);
    // Joinable shifts only in another week, or already started, do not count.
    expect(weekNeedsShifts({ ...base, viewDate: '2026-10-01', joinableShiftStarts: [sec('2026-10-07T09:00:00Z'), sec('2026-09-29T09:00:00Z')] })).toBe(false);
    expect(weekNeedsShifts({ ...base, viewDate: '2026-10-01', joinableShiftStarts: [sec('2026-10-01T09:00:00Z')] })).toBe(true);
  });
});

// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The shift nudge (valley-os v2c AC-c6): a resident with fewer than
// `threshold` accepted shifts in the current hub week is pointed to sign up.
// The week is Monday to Sunday in the hub's time zone (`settings.timezone`),
// never the device's. Pure: callers pass in who is looking and which shifts
// exist; no store, no clock.

import { addDays, toWallClock, wallClockToUtc, zoneOrUtc } from '../time/index.js';

export const DEFAULT_NUDGE_THRESHOLD = 2;

export interface HubWeek {
  /** The week's Monday as a hub-local date, e.g. `2026-09-28`. */
  key: string;
  /** Unix seconds of local Monday 00:00 (inclusive). */
  start: number;
  /** Unix seconds of the next local Monday 00:00 (exclusive). */
  end: number;
}

/** The hub-local Monday-to-Sunday week containing `nowSec`. */
export function hubWeek(nowSec: number, timezone: string): HubWeek {
  const tz = zoneOrUtc(timezone);
  const today = toWallClock(nowSec * 1000, tz);
  const monday = addDays(today.date, -((today.weekday + 6) % 7));
  return {
    key: monday,
    start: wallClockToUtc(monday, 0, tz) / 1000,
    end: wallClockToUtc(addDays(monday, 7), 0, tz) / 1000,
  };
}

export interface NudgeInput {
  nowSec: number;
  /** `settings.timezone`. */
  timezone: string;
  threshold?: number;
  loggedIn: boolean;
  /** This device is the shared board: no personal nudges. */
  boardMode: boolean;
  isAdmin: boolean;
  /** The week key the user snoozed ("not this week"), if any. */
  snoozedWeek?: string | null;
  /** Starts (unix s) of the shifts the user holds an accepted RSVP on. */
  myShiftStarts: number[];
  /** Starts (unix s) of the shifts with room left that the user is not on. */
  joinableShiftStarts: number[];
}

export function shiftNudgeDue(input: NudgeInput): boolean {
  if (!input.loggedIn || input.boardMode || input.isAdmin) return false;
  const week = hubWeek(input.nowSec, input.timezone);
  if (input.snoozedWeek === week.key) return false;
  const inWeek = (s: number) => s >= week.start && s < week.end;
  const mine = input.myShiftStarts.filter(inWeek).length;
  if (mine >= (input.threshold ?? DEFAULT_NUDGE_THRESHOLD)) return false;
  return input.joinableShiftStarts.some((s) => inWeek(s) && s >= input.nowSec);
}

/**
 * Whether the viewer is short of shifts in the hub week that contains
 * `viewDate` (a hub-local date): fewer than `threshold` shifts they are on,
 * the week is the current one or later, and some shift in it can still be
 * joined (not started, not full, not theirs). Drives the programme's red glow;
 * everyone gets it, the admin included (owner, 2026-09-26).
 */
export function weekNeedsShifts(input: {
  viewDate: string;
  nowSec: number;
  timezone: string;
  myShiftStarts: number[];
  /** Starts (unix s) of shifts with room left that the viewer is not on. */
  joinableShiftStarts: number[];
  threshold?: number;
}): boolean {
  const tz = zoneOrUtc(input.timezone);
  const start = wallClockToUtc(input.viewDate, 0, tz) / 1000;
  const week = hubWeek(start + 12 * 3600, tz);
  if (week.end <= input.nowSec) return false;
  const inWeek = (s: number) => s >= week.start && s < week.end;
  if (input.myShiftStarts.filter(inWeek).length >= (input.threshold ?? DEFAULT_NUDGE_THRESHOLD)) return false;
  return input.joinableShiftStarts.some((s) => inWeek(s) && s >= input.nowSec);
}

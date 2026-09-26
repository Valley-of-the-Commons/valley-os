// SPDX-License-Identifier: AGPL-3.0-or-later

import { addDays, toWallClock, wallClockToUtc, zoneOrUtc } from '../time/index.js';
import type { SeriesRule, Session } from './types.js';

/** The longest repeat interval a series may have. */
export const MAX_INTERVAL_WEEKS = 52;

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/**
 * Expand a recurrence rule into concrete occurrences (AC-b4).
 *
 * The rule is read in the hub's time zone (`settings.timezone`, the single
 * conversion point): weekdays, `until` (inclusive) and exception dates are
 * hub-local dates, and every occurrence starts at the base session's hub-local
 * wall-clock time, so a weekly 19:00 stays 19:00 across a DST change. Each
 * occurrence keeps the base session's duration. Only occurrences starting in
 * the half-open window `[start, end)` are returned, in chronological order.
 * A rule whose interval is not a whole number of weeks from 1 to 52 yields
 * nothing. Expansion starts at the first cycle that can reach the window.
 */
export function expandSeries(
  rule: SeriesRule,
  baseSession: Pick<Session, 'startsAt' | 'endsAt' | 'roomId'>,
  window: { start: string; end: string },
  timezone = 'UTC',
): Array<{ startsAt: string; endsAt: string }> {
  const interval = rule.intervalWeeks;
  if (!Number.isInteger(interval) || interval < 1 || interval > MAX_INTERVAL_WEEKS) return [];
  const startMs = Date.parse(baseSession.startsAt);
  if (!Number.isFinite(startMs) || !Number.isFinite(Date.parse(window.start)) || !Number.isFinite(Date.parse(window.end))) return [];
  const duration = Date.parse(baseSession.endsAt) - startMs;
  if (!(duration > 0)) return [];

  const tz = zoneOrUtc(timezone);
  const base = toWallClock(startMs, tz);
  const windowStart = Date.parse(window.start);
  const windowEnd = Date.parse(window.end);
  const exceptions = new Set(rule.exceptions ?? []);
  // Chronological within a week: Monday first, Sunday last.
  const offsets = [...new Set(rule.weekdays)].map((d) => (d + 6) % 7).sort((a, b) => a - b);

  const results: Array<{ startsAt: string; endsAt: string }> = [];
  // Jump straight to the first cycle that can reach the window, so a base far
  // in the past costs nothing.
  const baseMonday = addDays(base.date, -((base.weekday + 6) % 7));
  const windowDate = toWallClock(windowStart, tz).date;
  const cycleDays = interval * 7;
  const skipCycles = Math.max(0, Math.floor((daysBetween(baseMonday, windowDate) - 7) / cycleDays));
  for (
    let monday = addDays(baseMonday, skipCycles * cycleDays);
    monday <= rule.until && wallClockToUtc(monday, 0, tz) < windowEnd;
    monday = addDays(monday, interval * 7)
  ) {
    for (const offset of offsets) {
      const date = addDays(monday, offset);
      if (date < base.date || date > rule.until || exceptions.has(date)) continue;
      const occurrence = wallClockToUtc(date, base.minutes, tz);
      if (occurrence < windowStart || occurrence >= windowEnd) continue;
      results.push({
        startsAt: new Date(occurrence).toISOString(),
        endsAt: new Date(occurrence + duration).toISOString(),
      });
    }
  }
  return results;
}

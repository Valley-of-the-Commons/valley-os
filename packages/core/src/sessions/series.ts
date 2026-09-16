// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SeriesRule, Session } from './types.js';

/**
 * Parse a UTC ISO-8601 date-time string and return its components.
 * We only use string arithmetic to preserve UTC correctness.
 */
function parseDate(iso: string): { datePart: string; timePart: string } {
  const tIdx = iso.indexOf('T');
  return { datePart: iso.slice(0, tIdx), timePart: iso.slice(tIdx) };
}

/** Return the ISO date string (YYYY-MM-DD) N days after `date`. */
function addDays(date: string, n: number): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Day of week (0=Sunday) for a YYYY-MM-DD date (UTC). */
function weekdayOf(date: string): number {
  return new Date(date + 'T00:00:00Z').getUTCDay();
}

/**
 * Expand a recurrence rule into concrete occurrences.
 *
 * Strategy:
 * 1. Find the first occurrence date >= baseDate that matches a weekday in the rule.
 * 2. Step forward by intervalWeeks each cycle, emitting all matching weekdays per cycle.
 * 3. Stop when the candidate date exceeds `rule.until` or the window end.
 * 4. Skip exception dates.
 */
export function expandSeries(
  rule: SeriesRule,
  baseSession: Pick<Session, 'startsAt' | 'endsAt' | 'roomId'>,
  window: { start: string; end: string },
): Array<{ startsAt: string; endsAt: string }> {
  const { datePart: baseDate, timePart: startTimePart } = parseDate(baseSession.startsAt);
  const { timePart: endTimePart } = parseDate(baseSession.endsAt);

  const exceptions = new Set(rule.exceptions ?? []);
  const weekdays = new Set(rule.weekdays);

  const results: Array<{ startsAt: string; endsAt: string }> = [];

  // We iterate week-by-week from the base date (aligned to week boundaries).
  // For each week cycle, emit all matching weekdays within that week.
  // The anchor for each cycle is the Monday of the base date's week, advanced
  // by intervalWeeks * 7 days each cycle.

  // Find the Monday of the week containing baseDate.
  const baseDow = weekdayOf(baseDate);
  // days since Monday (Mon=0 offset)
  const daysSinceMon = (baseDow + 6) % 7;
  let cycleMonday = addDays(baseDate, -daysSinceMon);

  // Safety limit to prevent infinite loops.
  const MAX_CYCLES = 10000;

  for (let cycle = 0; cycle < MAX_CYCLES; cycle++) {
    // The Sunday of this week is cycleMonday + 6.
    // Check if this cycle's Monday is already past the until date.
    if (cycleMonday > rule.until && cycle > 0) break;

    for (let dow = 0; dow <= 6; dow++) {
      if (!weekdays.has(dow)) continue;
      // Convert dow (0=Sun) to offset from Monday.
      const offsetFromMon = (dow + 6) % 7;
      const candidateDate = addDays(cycleMonday, offsetFromMon);

      // Skip dates before the base date.
      if (candidateDate < baseDate) continue;
      // Skip past `until`.
      if (candidateDate > rule.until) continue;

      const candidateStartsAt = candidateDate + startTimePart;
      const candidateEndsAt = candidateDate + endTimePart;

      // Skip if outside the requested window (half-open [window.start, window.end)).
      if (candidateStartsAt < window.start || candidateStartsAt >= window.end) continue;

      // Skip exceptions.
      if (exceptions.has(candidateDate)) continue;

      results.push({ startsAt: candidateStartsAt, endsAt: candidateEndsAt });
    }

    // Advance to the next cycle.
    cycleMonday = addDays(cycleMonday, rule.intervalWeeks * 7);
    // Break early if we've gone past both window end and until.
    if (cycleMonday > rule.until && cycleMonday > window.end.slice(0, 10)) break;
  }

  return results;
}

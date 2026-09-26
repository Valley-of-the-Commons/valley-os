// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { toWallClock, wallClockToUtc, zoneOrUtc } from './index.js';

const ms = (iso: string) => Date.parse(iso);

describe('wall clock <-> UTC', () => {
  it('converts a hub-local wall-clock time to the UTC instant', () => {
    expect(wallClockToUtc('2026-09-30', 19 * 60, 'Europe/Rome')).toBe(ms('2026-09-30T17:00:00Z'));
    expect(wallClockToUtc('2026-11-04', 19 * 60, 'Europe/Rome')).toBe(ms('2026-11-04T18:00:00Z')); // after DST ends
    expect(wallClockToUtc('2026-09-30', 0, 'UTC')).toBe(ms('2026-09-30T00:00:00Z'));
  });

  it('reads the hub-local date, minutes and weekday of an instant', () => {
    expect(toWallClock(ms('2026-09-27T22:30:00Z'), 'Europe/Rome')).toEqual({ date: '2026-09-28', minutes: 30, weekday: 1 });
    expect(toWallClock(ms('2026-09-27T22:30:00Z'), 'UTC')).toEqual({ date: '2026-09-27', minutes: 22 * 60 + 30, weekday: 0 });
  });

  it('round-trips through a DST change', () => {
    for (const iso of ['2026-10-24T17:00:00Z', '2026-10-26T18:00:00Z']) {
      const w = toWallClock(ms(iso), 'Europe/Rome');
      expect(wallClockToUtc(w.date, w.minutes, 'Europe/Rome')).toBe(ms(iso));
    }
  });

  it('treats an unknown zone as UTC', () => {
    expect(zoneOrUtc('Not/AZone')).toBe('UTC');
    expect(zoneOrUtc('Europe/Rome')).toBe('Europe/Rome');
    expect(zoneOrUtc('')).toBe('UTC');
  });
});

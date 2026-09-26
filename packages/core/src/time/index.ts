// SPDX-License-Identifier: AGPL-3.0-or-later
//
// @holons/core/time: hub-local wall-clock time <-> UTC instants, the single
// conversion point behind `settings.timezone`. Built on Intl only.

const DAY_MS = 86_400_000;

const formatters = new Map<string, Intl.DateTimeFormat>();

/** One cached formatter per zone: building Intl formatters is the costly part. */
function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(tz, f);
  }
  return f;
}

/** `tz` when the runtime knows it, else `UTC`. */
export function zoneOrUtc(tz: string | null | undefined): string {
  if (!tz) return 'UTC';
  if (formatters.has(tz)) return tz;
  try {
    partsFormatter(tz);
    return tz;
  } catch {
    return 'UTC';
  }
}

/** Offset of `tz` from UTC at the instant `utcMs`, in ms. */
function offsetMs(utcMs: number, tz: string): number {
  const parts = partsFormatter(tz).formatToParts(new Date(utcMs));
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second'));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

export interface WallClock {
  /** Hub-local calendar date, `YYYY-MM-DD`. */
  date: string;
  /** Minutes since hub-local midnight. */
  minutes: number;
  /** 0 = Sunday ... 6 = Saturday, hub-local. */
  weekday: number;
}

/** The hub-local date, time and weekday of a UTC instant. */
export function toWallClock(utcMs: number, tz: string): WallClock {
  const zone = zoneOrUtc(tz);
  const local = new Date(utcMs + offsetMs(utcMs, zone));
  return {
    date: local.toISOString().slice(0, 10),
    minutes: local.getUTCHours() * 60 + local.getUTCMinutes(),
    weekday: local.getUTCDay(),
  };
}

/** The UTC instant of a hub-local wall-clock time on a hub-local date. */
export function wallClockToUtc(date: string, minutes: number, tz: string): number {
  const zone = zoneOrUtc(tz);
  const naive = Date.parse(`${date}T00:00:00Z`) + minutes * 60_000;
  const first = naive - offsetMs(naive, zone);
  return naive - offsetMs(first, zone);
}

/** `YYYY-MM-DD` shifted by whole days. */
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

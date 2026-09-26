// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Time helpers for the programme's pickers and navigation (valley-os v2c).
// Sessions live on the half-hour grid in the hub's time zone; these helpers
// only convert and step, the rule itself is core's (sessionTimeErrors).

import { addDays, toWallClock, wallClockToUtc } from "@holons/core/time";

/** "00:00" … "23:30": the only start and end times the pickers offer. */
export const HALF_HOURS: string[] = Array.from({ length: 48 }, (_, i) => {
  const h = Math.floor(i / 2);
  return `${String(h).padStart(2, "0")}:${i % 2 ? "30" : "00"}`;
});

const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/** UTC ISO instant of a hub-local date and HH:MM ("24:00" is next midnight). */
export function instantFor(date: string, hhmm: string, tz: string): string {
  return new Date(wallClockToUtc(date, minutesOf(hhmm), tz)).toISOString();
}

/** Hub-local date and HH:MM of an instant. */
export function wallTimeOf(
  iso: string,
  tz: string,
): { date: string; time: string } {
  const w = toWallClock(Date.parse(iso), tz);
  return {
    date: w.date,
    time: `${String(Math.floor(w.minutes / 60)).padStart(2, "0")}:${String(w.minutes % 60).padStart(2, "0")}`,
  };
}

/** The half-hour slot a minute-of-day falls in. */
export function slotAt(minute: number): string {
  const i = Math.min(47, Math.max(0, Math.floor(minute / 30)));
  return HALF_HOURS[i];
}

export function todayIn(nowMs: number, tz: string): string {
  return toWallClock(nowMs, tz).date;
}

export function shiftDate(
  date: string,
  view: "day" | "week",
  steps: number,
): string {
  return addDays(date, steps * (view === "week" ? 7 : 1));
}

/** Monday-first weeks covering the month of `date`, for the mini-month picker. */
export function monthGrid(
  date: string,
): { date: string; inMonth: boolean }[][] {
  const first = `${date.slice(0, 8)}01`;
  const month = date.slice(0, 7);
  const weekday = new Date(`${first}T00:00:00Z`).getUTCDay();
  let day = addDays(first, -((weekday + 6) % 7));
  const weeks: { date: string; inMonth: boolean }[][] = [];
  do {
    const week = Array.from({ length: 7 }, (_, i) => {
      const d = addDays(day, i);
      return { date: d, inMonth: d.startsWith(month) };
    });
    weeks.push(week);
    day = addDays(day, 7);
  } while (day.startsWith(month));
  return weeks;
}

/** The URL if `text` is an absolute http(s) link, else null (no javascript:, data: …). */
export function safeWebUrl(text: string): string | null {
  try {
    const url = new URL(text.trim());
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}

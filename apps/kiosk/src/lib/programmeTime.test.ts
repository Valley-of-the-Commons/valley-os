// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import {
  HALF_HOURS,
  instantFor,
  monthGrid,
  shiftDate,
  slotAt,
  todayIn,
  wallTimeOf,
  safeWebUrl,
} from "./programmeTime";

describe("programme time helpers", () => {
  it("offers every half hour of the day", () => {
    expect(HALF_HOURS).toHaveLength(48);
    expect(HALF_HOURS.slice(0, 3)).toEqual(["00:00", "00:30", "01:00"]);
    expect(HALF_HOURS.at(-1)).toBe("23:30");
  });

  it("turns a hub-local date and HH:MM into a UTC instant, and back", () => {
    expect(instantFor("2026-09-30", "10:30", "Europe/Rome")).toBe(
      "2026-09-30T08:30:00.000Z",
    );
    expect(wallTimeOf("2026-09-30T08:30:00.000Z", "Europe/Rome")).toEqual({
      date: "2026-09-30",
      time: "10:30",
    });
    expect(instantFor("2026-09-30", "24:00", "UTC")).toBe(
      "2026-10-01T00:00:00.000Z",
    );
  });

  it("snaps a grid click to the half hour it falls in", () => {
    expect(slotAt(10 * 60 + 29)).toBe("10:00");
    expect(slotAt(10 * 60 + 30)).toBe("10:30");
    expect(slotAt(23 * 60 + 59)).toBe("23:30");
    expect(slotAt(-5)).toBe("00:00");
  });

  it("knows today in the hub zone and steps dates", () => {
    expect(todayIn(Date.parse("2026-09-27T22:30:00Z"), "Europe/Rome")).toBe(
      "2026-09-28",
    );
    expect(shiftDate("2026-09-30", "day", 1)).toBe("2026-10-01");
    expect(shiftDate("2026-09-30", "week", -1)).toBe("2026-09-23");
  });

  it("builds a Monday-first month grid of whole weeks", () => {
    const g = monthGrid("2026-09-15");
    expect(g[0][0]).toEqual({ date: "2026-08-31", inMonth: false });
    expect(g[0][1]).toEqual({ date: "2026-09-01", inMonth: true });
    expect(g.every((w) => w.length === 7)).toBe(true);
    expect(g.at(-1)!.at(-1)).toEqual({ date: "2026-10-04", inMonth: false });
  });

  it("only http(s) comment links are treated as links", () => {
    expect(safeWebUrl("https://commonshub.org/x")).toBe(
      "https://commonshub.org/x",
    );
    expect(safeWebUrl(" http://a.b ")).toBe("http://a.b/");
    expect(safeWebUrl("javascript:alert(1)")).toBeNull();
    expect(safeWebUrl("data:text/html,<b>x</b>")).toBeNull();
    expect(safeWebUrl("not a url")).toBeNull();
  });
});

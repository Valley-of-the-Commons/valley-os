// SPDX-License-Identifier: AGPL-3.0-or-later
//
// v2a: the Commons Hub's lean calendar chrome. Every removal is gated on the
// Commons Hub so other holons (and the Library calendar) keep their controls.

import { describe, expect, it } from "vitest";
import {
  COMMONS_HUB_ID,
  calendarModesFor,
  effectiveCalendarMode,
  effectiveScope,
  isCommonsHub,
  scopeOptionsFor,
} from "./hubChrome";

const ALL_MODES = ["day", "week", "month", "year"].map((id) => ({ id }));
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);
const OTHER_HUB = "-1001234567890";

describe("isCommonsHub", () => {
  it("is true only for the Commons Hub holon", () => {
    expect(isCommonsHub(COMMONS_HUB_ID)).toBe(true);
    expect(isCommonsHub(OTHER_HUB)).toBe(false);
    expect(isCommonsHub(null)).toBe(false);
  });
});

describe("calendar view switch (AC-a1)", () => {
  it("offers exactly Day and Week on the Commons Hub", () => {
    expect(ids(calendarModesFor(COMMONS_HUB_ID, ALL_MODES))).toEqual([
      "day",
      "week",
    ]);
  });

  it("leaves every other holon's modes untouched", () => {
    expect(calendarModesFor(OTHER_HUB, ALL_MODES)).toEqual(ALL_MODES);
  });
});

describe("scope switch (AC-a6)", () => {
  const ALL = ["personal", "all", "networked"].map((id) => ({ id }));

  it("hides the Federation (networked) segment on the Commons Hub", () => {
    expect(ids(scopeOptionsFor(COMMONS_HUB_ID, ALL))).toEqual([
      "personal",
      "all",
    ]);
  });

  it("keeps Federation on other holons", () => {
    expect(scopeOptionsFor(OTHER_HUB, ALL)).toEqual(ALL);
  });
});

describe("effective values: the device preference, adjusted for the Commons Hub", () => {
  it("a remembered Month or Year window reads as Week on the Commons Hub only", () => {
    expect(effectiveCalendarMode(COMMONS_HUB_ID, "month")).toBe("week");
    expect(effectiveCalendarMode(COMMONS_HUB_ID, "year")).toBe("week");
    expect(effectiveCalendarMode(COMMONS_HUB_ID, "day")).toBe("day");
    expect(effectiveCalendarMode(OTHER_HUB, "month")).toBe("month");
  });

  it("a remembered Federation scope reads as Local on the Commons Hub only", () => {
    expect(effectiveScope(COMMONS_HUB_ID, "networked")).toBe("all");
    expect(effectiveScope(COMMONS_HUB_ID, "personal")).toBe("personal");
    expect(effectiveScope(OTHER_HUB, "networked")).toBe("networked");
  });
});

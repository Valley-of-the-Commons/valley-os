// SPDX-License-Identifier: AGPL-3.0-or-later
//
// v2a: the shared scope and calendar-mode stores expose the effective value
// for the current holon, while writes keep the device preference intact.

import { describe, expect, it } from "vitest";
import { get } from "svelte/store";
import { calendarMode, federated, holonId, scope } from "./stores";
import { COMMONS_HUB_ID } from "./hubChrome";

describe("holon-adjusted stores", () => {
  it("Federation reads as Local on the Commons Hub and returns on another holon", () => {
    holonId.set(COMMONS_HUB_ID);
    scope.set("networked");
    expect(get(scope)).toBe("all");
    expect(get(federated)).toBe(false);
    holonId.set("-1001234567890");
    expect(get(scope)).toBe("networked");
    expect(get(federated)).toBe(true);
  });

  it("a Month window reads as Week on the Commons Hub and returns elsewhere", () => {
    holonId.set(COMMONS_HUB_ID);
    calendarMode.set("month");
    expect(get(calendarMode)).toBe("week");
    holonId.set("-1001234567890");
    expect(get(calendarMode)).toBe("month");
  });

  it("re-selecting the value already shown leaves the device preference alone", () => {
    holonId.set(COMMONS_HUB_ID);
    scope.set("networked");
    scope.set("all"); // tapping the already-checked "Local" on the Commons Hub
    holonId.set("-1001234567890");
    expect(get(scope)).toBe("networked");

    holonId.set(COMMONS_HUB_ID);
    calendarMode.set("month");
    calendarMode.set("week"); // tapping the already-checked "Week"
    holonId.set("-1001234567890");
    expect(get(calendarMode)).toBe("month");
  });

  it("choosing a different value still writes it", () => {
    holonId.set(COMMONS_HUB_ID);
    calendarMode.set("month");
    calendarMode.set("day");
    holonId.set("-1001234567890");
    expect(get(calendarMode)).toBe("day");
  });
});

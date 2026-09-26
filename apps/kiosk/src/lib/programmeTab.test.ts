// SPDX-License-Identifier: AGPL-3.0-or-later
//
// valley-os v2c AC-c1: the Commons Hub shows exactly one tab, the unified
// programme; device toggles cannot bring others back; other holons keep
// their own set and never see the programme tab.

import { describe, expect, it } from "vitest";
import { get } from "svelte/store";
import {
  hiddenTabs,
  holonId,
  setTabShown,
  visibleTabs,
  activeTab,
} from "./stores";
import { COMMONS_HUB_ID } from "./hubChrome";

const OTHER = "-1001234567890";
const ids = () => get(visibleTabs).map((t) => t.id);

describe("programme tab (AC-c1)", () => {
  it("the Commons Hub shows exactly [programme]", () => {
    holonId.set(COMMONS_HUB_ID);
    expect(ids()).toEqual(["programme"]);
  });

  it("turning tabs on in device settings does not reintroduce them there", () => {
    holonId.set(COMMONS_HUB_ID);
    setTabShown("tasks", true);
    setTabShown("shifts", true);
    setTabShown("calendar", true);
    expect(ids()).toEqual(["programme"]);
  });

  it("the Commons Hub offers nothing to add back", () => {
    holonId.set(COMMONS_HUB_ID);
    expect(get(hiddenTabs)).toEqual([]);
  });

  it("a device on Calendar lands on the programme when it shows the Commons Hub", () => {
    holonId.set(OTHER);
    activeTab.set("calendar");
    holonId.set(COMMONS_HUB_ID);
    expect(get(activeTab)).toBe("programme");
  });

  it("another holon keeps its normal set and never gets the programme tab", () => {
    holonId.set(OTHER);
    setTabShown("tasks", true);
    setTabShown("calendar", true);
    expect(ids()).toContain("tasks");
    expect(ids()).toContain("calendar");
    expect(ids()).not.toContain("programme");
    expect(get(hiddenTabs).map((t) => t.id)).not.toContain("programme");
  });
});

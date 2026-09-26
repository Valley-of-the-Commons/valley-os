// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The Commons Hub's lean board chrome (valley-os v2a). The kiosk is
// multi-tenant, so every removal is gated on the Commons Hub holon and applied
// at render sites; shared types (CalendarMode) and other holons are untouched.

/** The Commons Hub holon (valley.hubs.network and commons.hubs.network). */
export const COMMONS_HUB_ID = "-1003691108237";

export const isCommonsHub = (holon: string | null | undefined): boolean =>
  holon === COMMONS_HUB_ID;

const LEAN_CALENDAR_MODES = new Set(["day", "week"]);

/** The calendar tab's view-switch modes: Day and Week only on the Commons Hub. */
export function calendarModesFor<T extends { id: string }>(
  holon: string | null | undefined,
  modes: readonly T[],
): T[] {
  return isCommonsHub(holon)
    ? modes.filter((m) => LEAN_CALENDAR_MODES.has(m.id))
    : [...modes];
}

/** The calendar window the Commons Hub shows for a remembered one: Month/Year read as Week. */
export function effectiveCalendarMode<M extends string>(
  holon: string | null | undefined,
  mode: M,
): M | "week" {
  return isCommonsHub(holon) && !LEAN_CALENDAR_MODES.has(mode) ? "week" : mode;
}

/** The scope the Commons Hub shows for a remembered one: Federation reads as Local. */
export function effectiveScope<S extends string>(
  holon: string | null | undefined,
  scope: S,
): S | "all" {
  return isCommonsHub(holon) && scope === "networked" ? "all" : scope;
}

/**
 * The tabs a holon can ever show (valley-os v2c AC-c1): the Commons Hub shows
 * only its unified programme, whatever the device toggles say; every other
 * holon keeps its own set and never gets the programme tab.
 */
export function tabsForHolon<T extends { id: string }>(
  holon: string | null | undefined,
  tabs: readonly T[],
): T[] {
  return isCommonsHub(holon)
    ? tabs.filter((t) => t.id === "programme")
    : tabs.filter((t) => t.id !== "programme");
}

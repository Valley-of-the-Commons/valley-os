// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The Commons Hub programme's live data (valley-os v2c): the public session
// lenses turned into a typed programme, the identity registry, the viewer's
// write tier, and shifts as grid items. Subscriptions are opened by the view
// and closed when it goes away.

import { derived, get, writable, type Readable } from "svelte/store";
import {
  PROGRAMME_LENSES,
  buildProgramme,
  buildRegistry,
  computeOwnership,
  isAdmin as isAdminUid,
  type Programme,
  type ProgrammeLens,
  type WriteTier,
} from "@holons/core/sessions";
import { enrolledPubkeys, isEnrolled, hasCapacity } from "@holons/core/shifts";
import { currentUser } from "./auth";
import { resolveShiftCoordinator } from "./config";
import { getHolosphere, getWriter, subscribeLens } from "./holosphere";
import { programmeActions, type ActionContext } from "./programmeActions";
import type { ShiftItem } from "./programmeGrid";
import { shiftSigner } from "./shifts";
import {
  holonAdmin,
  holonId,
  rawShifts,
  shiftAttestations,
  shiftIdentity,
  showNotice,
} from "./stores";

/** `settings.timezone` of the bound holon; the layout keeps it current. */
export const hubTimezone = writable<string>("UTC");

const raw = writable<Partial<Record<ProgrammeLens, unknown[]>>>({});
/** True once every programme lens has emitted at least once. */
export const programmeLoaded = writable(false);

export const programme: Readable<Programme> = derived(
  [raw, hubTimezone],
  ([$raw, $tz]) => buildProgramme($raw, { timezone: $tz }),
);

/** One person across Telegram ids and keys (coordinator attestations only). */
export const registry = derived(shiftAttestations, ($atts) =>
  buildRegistry({
    attestations: $atts,
    coordinatorPubkey: resolveShiftCoordinator() ?? undefined,
  }),
);

export const viewerUid = derived(currentUser, ($u) =>
  $u ? String($u.id) : null,
);

export const writeTier: Readable<WriteTier> = derived(
  [viewerUid, holonAdmin, registry],
  ([$uid, $admin, $reg]) =>
    !$uid
      ? "logged-out"
      : isAdminUid($reg, $uid, $admin)
        ? "admin"
        : "logged-in",
);

/** Contested clusters, with only the admin's rulings counting. */
export const ownership = derived(
  [programme, registry, holonAdmin],
  ([$p, $reg, $admin]) =>
    computeOwnership($p.sessions, $p.resolutions, (by) =>
      isAdminUid($reg, by, $admin),
    ).clusters,
);

/** Shifts in the grid's shape: mine, full, and how many signed up. */
export const shiftItems: Readable<ShiftItem[]> = derived(
  [rawShifts, shiftIdentity, shiftSigner],
  ([$shifts, $identity, $signer]) =>
    $shifts.occurrences.map((o) => ({
      id: o.address,
      title: o.title,
      start: o.start * 1000,
      end: o.end * 1000,
      mine:
        !!$signer && isEnrolled(o, $signer.pubkey, $shifts.rsvps, $identity),
      full: !hasCapacity(o, $shifts.rsvps, $identity),
      taken: enrolledPubkeys(o, $shifts.rsvps, $identity).length,
    })),
);

/** Open the programme lenses for a holon. Returns the teardown. */
export function startProgramme(holon: string): () => void {
  raw.set({});
  programmeLoaded.set(false);
  let closed = false;
  const subs: { unsubscribe(): void }[] = [];
  const seen = new Set<string>();
  void getHolosphere().then((hs) => {
    if (closed) return;
    for (const [key, lens] of Object.entries(PROGRAMME_LENSES) as [
      ProgrammeLens,
      string,
    ][]) {
      subs.push(
        subscribeLens(hs, holon, lens, (items) => {
          raw.update((r) => ({ ...r, [key]: items }));
          seen.add(key);
          if (seen.size === Object.keys(PROGRAMME_LENSES).length)
            programmeLoaded.set(true);
        }),
      );
    }
  });
  return () => {
    closed = true;
    for (const s of subs) s.unsubscribe();
  };
}

const newId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;

/**
 * The actions, bound to the current holon, viewer and programme snapshot.
 * `track` sees every id a write creates, so a view can mark it pending.
 */
export async function actions(track: (id: string) => void = () => {}) {
  const holon = get(holonId);
  if (!holon) throw new Error("no holon bound");
  const writer = await getWriter(holon, (message) => showNotice(message));
  const reg = get(registry);
  const ctx: ActionContext = {
    writer,
    viewerUid: get(viewerUid),
    tier: get(writeTier),
    resolve: (id) => reg.resolve(id),
    timezone: get(hubTimezone),
    now: () => new Date().toISOString(),
    newId: () => {
      const id = newId();
      track(id);
      return id;
    },
    programme: get(programme),
  };
  return programmeActions(ctx);
}

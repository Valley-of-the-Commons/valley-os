// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `isAdmin`: whether the logged-in user is this holon's admin (valley-os v2a
// AC-a7). Gates admin-only controls (keynotes, contest resolution) in v2c.

import { derived } from "svelte/store";
import { currentUser } from "./auth";
import { resolveShiftCoordinator } from "./config";
import { holonAdmin, shiftAttestations } from "./stores";
import { userIsAdmin } from "./admin";

export const isAdmin = derived(
  [currentUser, holonAdmin, shiftAttestations],
  ([$user, $admin, $attestations]) =>
    userIsAdmin($user, $admin, {
      attestations: $attestations,
      coordinatorPubkey: resolveShiftCoordinator() ?? undefined,
    }),
);

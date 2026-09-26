// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Admin detection (valley-os v2a AC-a7). The holon admin is `settings.admin`;
// the current user matches when both resolve to the same person through the
// core identity registry, so a key-login admin (attested by the coordinator)
// matches too. The rule itself lives in @holons/core/sessions.

import { buildRegistry, isAdmin } from "@holons/core/sessions";
import type { IdentityAttestation } from "@holons/core/shifts";

export interface AdminTrust {
  attestations: IdentityAttestation[];
  coordinatorPubkey?: string;
}

export function userIsAdmin(
  user: { id: string | number } | null,
  settingsAdmin: string | null | undefined,
  trust: AdminTrust,
): boolean {
  if (!user || !settingsAdmin) return false;
  return isAdmin(buildRegistry(trust), String(user.id), settingsAdmin);
}

// SPDX-License-Identifier: AGPL-3.0-or-later
//
// v2a AC-a7: is the current user the holon admin (settings.admin, resolved
// through the core identity registry)?

import { describe, expect, it } from "vitest";
import type { IdentityAttestation } from "@holons/core/shifts";
import { userIsAdmin } from "./admin";

const coordinator = "c".repeat(64);
const adminKey = "a".repeat(64);

const attestation: IdentityAttestation = {
  provider: coordinator,
  identifier: "telegram:99",
  platform: "telegram",
  platformId: "99",
  pubkeys: [adminKey],
  createdAt: 1,
  id: "att-1",
};
const trust = { attestations: [attestation], coordinatorPubkey: coordinator };

describe("userIsAdmin", () => {
  it("is true for the admin (Telegram login)", () => {
    expect(userIsAdmin({ id: 99 }, "99", trust)).toBe(true);
  });

  it("is true for the admin logged in with an attested key", () => {
    expect(userIsAdmin({ id: adminKey }, "99", trust)).toBe(true);
  });

  it("is false for a non-admin", () => {
    expect(userIsAdmin({ id: 77 }, "99", trust)).toBe(false);
  });

  it("is false when logged out", () => {
    expect(userIsAdmin(null, "99", trust)).toBe(false);
  });

  it("is false for everyone when the holon has no admin set", () => {
    expect(userIsAdmin({ id: 99 }, "", trust)).toBe(false);
    expect(userIsAdmin({ id: 99 }, null, trust)).toBe(false);
  });
});

// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Why the programme cannot sign a shift sign-up for the viewer, so the
// message says what is actually wrong (never "use Telegram").

import { describe, expect, it } from "vitest";
import { cannotSignReason } from "./programmeSigning";

describe("cannotSignReason", () => {
  it("is null when a signer is available", () => {
    expect(
      cannotSignReason(
        { provider: "telegram" },
        { pubkey: "p", mode: "server" },
      ),
    ).toBeNull();
  });

  it("a key login without its key in memory must log in again", () => {
    expect(cannotSignReason({ provider: "nostr" }, null)).toBe("key");
    expect(cannotSignReason({ provider: "ethereum" }, null)).toBe("key");
  });

  it("a Telegram login the server cannot sign for means the board is not set up", () => {
    expect(cannotSignReason({ provider: "telegram" }, null)).toBe("server");
  });

  it("logged out is a login question, not a signing one", () => {
    expect(cannotSignReason(null, null)).toBeNull();
  });
});

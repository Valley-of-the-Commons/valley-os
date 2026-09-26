// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Why the kiosk cannot sign a shift sign-up for the viewer. A Telegram login
// is signed by the server with the hub's secret; when the server cannot, the
// board is not set up for sign-ups. A key login signs in the browser with a
// key held only in memory, so after a reload the person must log in again.

export type CannotSign = "server" | "key";

export function cannotSignReason(
  user: { provider: string } | null,
  signer: { pubkey: string; mode?: string } | null,
): CannotSign | null {
  if (!user || signer) return null;
  return user.provider === "telegram" ? "server" : "key";
}

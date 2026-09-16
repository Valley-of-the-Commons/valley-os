// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SwapRequest, Session } from './types.js';

export type SwapState =
  | 'proposed'
  | 'expired'
  | 'auto-declined'
  | 'accepted-apply'
  | 'declined'
  | 'withdrawn'
  | 'voided-by-delete';

/**
 * Derive the current state of a swap request.
 *
 * Terminal outcomes (from the record itself) take priority. Then voided-by-delete
 * if either session is deleted. Then live-proposal logic (auto-declined if another
 * smaller (createdAt, id) proposal exists for the same slot pair). Finally
 * proposed vs expired by comparing now to expiresAt.
 */
export function deriveSwapState(
  swap: SwapRequest,
  allSwaps: SwapRequest[],
  sessions: Session[],
  now: string,
): SwapState {
  // Terminal outcome recorded on the swap itself.
  if (swap.outcome != null) {
    return swap.outcome.type;
  }

  // Voided if either referenced session has been deleted.
  const sessionMap = new Map(sessions.map((s) => [s.id, s]));
  const from = sessionMap.get(swap.fromSessionId);
  const target = sessionMap.get(swap.targetSessionId);
  if ((from != null && from.deleted) || (target != null && target.deleted)) {
    return 'voided-by-delete';
  }

  // Among non-terminal proposals for this slot pair, find the live one.
  const slotKey = `${swap.fromSessionId}:${swap.targetSessionId}`;
  const candidates = allSwaps.filter(
    (s) => s.outcome == null && `${s.fromSessionId}:${s.targetSessionId}` === slotKey,
  );

  // The live proposal is the one with smallest (createdAt, id).
  const live = candidates.reduce((best, s) => {
    if (s.createdAt < best.createdAt) return s;
    if (s.createdAt === best.createdAt && s.id < best.id) return s;
    return best;
  });

  if (live.id !== swap.id) {
    return 'auto-declined';
  }

  // Live proposal: check expiry.
  return now >= swap.expiresAt ? 'expired' : 'proposed';
}

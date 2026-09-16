// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Star, Session } from './types.js';

/** Count stars for a given session. */
export function countStars(stars: Star[], sessionId: string): number {
  return stars.filter((s) => s.sessionId === sessionId).length;
}

/**
 * Rank sessions by star count descending.
 * Ties are broken by sessionId ascending (lexical).
 */
export function rankSessions(sessions: Session[], stars: Star[]): Session[] {
  const counts = new Map<string, number>();
  for (const s of sessions) {
    counts.set(s.id, countStars(stars, s.id));
  }
  return [...sessions].sort((a, b) => {
    const diff = (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0);
    if (diff !== 0) return diff;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

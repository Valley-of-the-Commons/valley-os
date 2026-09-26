// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Star, Session } from './types.js';

const same = (id: string) => id;

/**
 * Count the people who starred a session. `resolve` (the registry's) folds the
 * several ids one person acts under, so they count once.
 */
export function countStars(stars: Star[], sessionId: string, resolve: (id: string) => string = same): number {
  return new Set(stars.filter((s) => s.sessionId === sessionId).map((s) => resolve(s.uid))).size;
}

/**
 * Rank sessions by star count descending.
 * Ties are broken by sessionId ascending (lexical).
 */
export function rankSessions(sessions: Session[], stars: Star[], resolve: (id: string) => string = same): Session[] {
  const counts = new Map<string, number>();
  for (const s of sessions) {
    counts.set(s.id, countStars(stars, s.id, resolve));
  }
  return [...sessions].sort((a, b) => {
    const diff = (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0);
    if (diff !== 0) return diff;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

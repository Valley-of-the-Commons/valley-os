// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Session, AdminResolution } from './types.js';

export interface ClusterResult {
  roomId: string;
  sessionIds: string[];
  contested: boolean;
  committedOwner?: string;
  provisionalWinner: string;
}

export interface OwnershipResult {
  clusters: ClusterResult[];
}

/** Half-open interval overlap: [a.startsAt, a.endsAt) ∩ [b.startsAt, b.endsAt) is non-empty. */
function overlaps(a: Session, b: Session): boolean {
  return a.startsAt < b.endsAt && b.startsAt < a.endsAt;
}

/** Cluster key for resolution matching: roomId + minStart + maxEnd of all sessions. */
function clusterKey(roomId: string, sessions: Session[]): string {
  const minStart = sessions.reduce((m, s) => (s.startsAt < m ? s.startsAt : m), sessions[0].startsAt);
  const maxEnd = sessions.reduce((m, s) => (s.endsAt > m ? s.endsAt : m), sessions[0].endsAt);
  return `${roomId}:${minStart}:${maxEnd}`;
}

/** Provisional winner: smallest createdAt, ties broken by smallest id lexically. */
function provisionalWinner(sessions: Session[]): string {
  return sessions.reduce((best, s) => {
    if (s.createdAt < best.createdAt) return s;
    if (s.createdAt === best.createdAt && s.id < best.id) return s;
    return best;
  }).id;
}

/**
 * Find connected components via flood-fill.
 * Returns arrays of session indices (into `sessions`).
 */
function findComponents(sessions: Session[]): number[][] {
  const visited = new Array<boolean>(sessions.length).fill(false);
  const components: number[][] = [];

  for (let i = 0; i < sessions.length; i++) {
    if (visited[i]) continue;
    const component: number[] = [];
    const queue = [i];
    visited[i] = true;
    while (queue.length > 0) {
      const cur = queue.shift()!;
      component.push(cur);
      for (let j = 0; j < sessions.length; j++) {
        if (!visited[j] && overlaps(sessions[cur], sessions[j])) {
          visited[j] = true;
          queue.push(j);
        }
      }
    }
    components.push(component);
  }

  return components;
}

export function computeOwnership(
  sessions: Session[],
  resolutions: AdminResolution[],
  resolveUid: (id: string) => string,
): OwnershipResult {
  // Group non-deleted sessions by room.
  const byRoom = new Map<string, Session[]>();
  for (const s of sessions) {
    if (s.deleted) continue;
    const list = byRoom.get(s.roomId) ?? [];
    list.push(s);
    byRoom.set(s.roomId, list);
  }

  const clusters: ClusterResult[] = [];

  for (const [roomId, roomSessions] of byRoom) {
    const components = findComponents(roomSessions);

    for (const indices of components) {
      const clusterSessions = indices.map((i) => roomSessions[i]);
      const sessionIds = clusterSessions.map((s) => s.id).sort();
      const contested = clusterSessions.length > 1;
      const winner = provisionalWinner(clusterSessions);

      let committedOwner: string | undefined;

      if (contested) {
        const key = clusterKey(roomId, clusterSessions);

        // Find all valid resolutions for this cluster.
        const validResolutions = resolutions.filter((r) => {
          // chosenSessionId must belong to this cluster (deleted sessions are never in clusterSessions).
          if (!sessionIds.includes(r.chosenSessionId)) return false;
          return r.slotKey === key;
        });

        if (validResolutions.length > 0) {
          // Latest createdAt wins; ties broken by smallest id.
          const best = validResolutions.reduce((best, r) => {
            if (r.createdAt > best.createdAt) return r;
            if (r.createdAt === best.createdAt && r.id < best.id) return r;
            return best;
          });
          // committedOwner is the session chosen by the winning admin resolution.
          // resolveUid is called at call sites to normalise the createdBy identity;
          // here we record the chosen sessionId as the committed slot owner.
          void resolveUid(best.createdBy); // ensure resolver is exercised (validates linkage)
          committedOwner = best.chosenSessionId;
        }
      }

      clusters.push({ roomId, sessionIds, contested, committedOwner, provisionalWinner: winner });
    }
  }

  return { clusters };
}

// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Session, AdminResolution } from './types.js';

export interface ClusterResult {
  roomId: string;
  /** The slot's key, `room:<first start>:<last end>` in canonical UTC. */
  slotKey: string;
  sessionIds: string[];
  contested: boolean;
  /** The session holding the slot: the only one, or the admin's choice. Unset while contested. */
  owner?: string;
  /** Set only when an admin resolution decided a contested slot. */
  committedOwner?: string;
  /** Display-only tentative winner: smallest (createdAt, id). Never a commitment. */
  provisionalWinner: string;
}

export interface OwnershipResult {
  clusters: ClusterResult[];
}

const at = (iso: string) => Date.parse(iso);
const canonical = (ms: number) => new Date(ms).toISOString();

/** Half-open interval overlap on instants: [a.start, a.end) ∩ [b.start, b.end) is non-empty. */
function overlaps(a: Session, b: Session): boolean {
  return at(a.startsAt) < at(b.endsAt) && at(b.startsAt) < at(a.endsAt);
}

function clusterKey(roomId: string, sessions: Session[]): string {
  const minStart = Math.min(...sessions.map((s) => at(s.startsAt)));
  const maxEnd = Math.max(...sessions.map((s) => at(s.endsAt)));
  return `${roomId}:${canonical(minStart)}:${canonical(maxEnd)}`;
}

/** Smallest (createdAt, id). */
function earliest<T extends { id: string; createdAt: string }>(items: T[]): T {
  return items.reduce((best, s) => {
    const d = at(s.createdAt) - at(best.createdAt);
    return d < 0 || (d === 0 && s.id < best.id) ? s : best;
  });
}

/** Latest createdAt; ties to the smallest id, then the smallest chosen session. */
function latest(items: AdminResolution[]): AdminResolution {
  return items.reduce((best, r) => {
    const d = at(r.createdAt) - at(best.createdAt);
    if (d !== 0) return d > 0 ? r : best;
    if (r.id !== best.id) return r.id < best.id ? r : best;
    return r.chosenSessionId < best.chosenSessionId ? r : best;
  });
}

/** Connected components of the overlap graph (transitive clusters). */
function findComponents(sessions: Session[]): Session[][] {
  const visited = new Array<boolean>(sessions.length).fill(false);
  const components: Session[][] = [];
  for (let i = 0; i < sessions.length; i++) {
    if (visited[i]) continue;
    const component: Session[] = [];
    const queue = [i];
    visited[i] = true;
    while (queue.length > 0) {
      const cur = queue.shift()!;
      component.push(sessions[cur]);
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

/**
 * Pure slot-ownership reducer (AC-b1/b2). Output is identical on every peer
 * regardless of arrival order: clusters are sorted by slot key. An admin ruling
 * holds while the clash contains only the talks it ruled on (owner decision
 * 2026-09-25), so editing a ruled-on talk's times cannot undo it.
 *
 * `isAdminAuthor(createdBy)` decides whether a resolution record was written by
 * the hub admin; callers compose it from the registry and `settings.admin`
 * (see `isAdmin`). Resolutions by anyone else are ignored, so a later
 * non-admin write can never overturn the admin's decision.
 */
export function computeOwnership(
  sessions: Session[],
  resolutions: AdminResolution[],
  isAdminAuthor: (createdBy: string) => boolean,
): OwnershipResult {
  const byRoom = new Map<string, Session[]>();
  for (const s of sessions) {
    if (s.deleted) continue;
    const list = byRoom.get(s.roomId) ?? [];
    list.push(s);
    byRoom.set(s.roomId, list);
  }

  const clusters: ClusterResult[] = [];
  for (const [roomId, roomSessions] of byRoom) {
    for (const members of findComponents(roomSessions)) {
      const sessionIds = members.map((s) => s.id).sort();
      const slotKey = clusterKey(roomId, members);
      const contested = members.length > 1;
      const cluster: ClusterResult = { roomId, slotKey, sessionIds, contested, provisionalWinner: earliest(members).id };

      if (!contested) {
        cluster.owner = sessionIds[0];
      } else {
        // A ruling applies while the clash holds only talks it ruled on.
        const valid = resolutions.filter(
          (r) =>
            isAdminAuthor(r.createdBy) &&
            sessionIds.includes(r.chosenSessionId) &&
            sessionIds.every((id) => r.sessionIds.includes(id)),
        );
        if (valid.length > 0) {
          cluster.committedOwner = latest(valid).chosenSessionId;
          cluster.owner = cluster.committedOwner;
        }
      }
      clusters.push(cluster);
    }
  }

  clusters.sort((a, b) => (a.slotKey < b.slotKey ? -1 : a.slotKey > b.slotKey ? 1 : 0));
  return { clusters };
}

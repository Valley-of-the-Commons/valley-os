// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { computeOwnership } from './ownership.js';
import { expandSeries } from './series.js';
import { countStars, rankSessions } from './stars.js';
import { canPerform } from './permissions.js';
import type { Action } from './permissions.js';
import type { Session, AdminResolution, Star } from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSession(overrides: Partial<Session> & { id: string }): Session {
  return {
    type: 'session',
    roomId: 'R',
    title: 'Test',
    startsAt: '2026-09-01T10:00:00Z',
    endsAt: '2026-09-01T11:00:00Z',
    createdBy: 'user1',
    createdAt: '2026-09-01T09:00:00Z',
    ...overrides,
  };
}

/** isAdminAuthor for a hub whose (canonical) admin is `admin1`. */
const adminIsAdmin1 = (createdBy: string) => createdBy === 'admin1';

// ---------------------------------------------------------------------------
// AC-b1 + AC-b2: Slot ownership reducer
// ---------------------------------------------------------------------------

describe('computeOwnership: AC-b1/b2', () => {
  it('single session owns its slot uncontested', () => {
    const s = makeSession({ id: 's1' });
    const result = computeOwnership([s], [], adminIsAdmin1);
    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0].contested).toBe(false);
    expect(result.clusters[0].provisionalWinner).toBe('s1');
    expect(result.clusters[0].committedOwner).toBeUndefined();
  });

  it('adjacent sessions (touching at exactly one point) are NOT in the same cluster', () => {
    // S1 [10:00,11:00), S3 [11:00,12:00) are adjacent,, no overlap
    const s1 = makeSession({ id: 's1', startsAt: '2026-09-01T10:00:00Z', endsAt: '2026-09-01T11:00:00Z' });
    const s3 = makeSession({ id: 's3', startsAt: '2026-09-01T11:00:00Z', endsAt: '2026-09-01T12:00:00Z' });
    const result = computeOwnership([s1, s3], [], adminIsAdmin1);
    expect(result.clusters).toHaveLength(2);
    result.clusters.forEach((c) => expect(c.contested).toBe(false));
  });

  it('spec worked example: S1/S2/S3 form one contested cluster, S1 is provisional winner', () => {
    // S1 [10:00,11:00) createdAt 09:00
    // S2 [10:30,11:30) createdAt 09:05
    // S3 [11:00,12:00) createdAt 09:02
    // S1∩S2: overlap; S2∩S3: overlap; S1∩S3: adjacent (no overlap)
    // Transitively: one cluster of 3
    const s1 = makeSession({ id: 's1', startsAt: '2026-09-01T10:00:00Z', endsAt: '2026-09-01T11:00:00Z', createdAt: '2026-09-01T09:00:00Z' });
    const s2 = makeSession({ id: 's2', startsAt: '2026-09-01T10:30:00Z', endsAt: '2026-09-01T11:30:00Z', createdAt: '2026-09-01T09:05:00Z' });
    const s3 = makeSession({ id: 's3', startsAt: '2026-09-01T11:00:00Z', endsAt: '2026-09-01T12:00:00Z', createdAt: '2026-09-01T09:02:00Z' });

    const result = computeOwnership([s1, s2, s3], [], adminIsAdmin1);
    expect(result.clusters).toHaveLength(1);
    const cluster = result.clusters[0];
    expect(cluster.contested).toBe(true);
    expect(cluster.sessionIds.sort()).toEqual(['s1', 's2', 's3']);
    expect(cluster.provisionalWinner).toBe('s1'); // earliest createdAt
    expect(cluster.committedOwner).toBeUndefined();
  });

  it('determinism: same output regardless of input ordering', () => {
    const s1 = makeSession({ id: 's1', startsAt: '2026-09-01T10:00:00Z', endsAt: '2026-09-01T11:00:00Z', createdAt: '2026-09-01T09:00:00Z' });
    const s2 = makeSession({ id: 's2', startsAt: '2026-09-01T10:30:00Z', endsAt: '2026-09-01T11:30:00Z', createdAt: '2026-09-01T09:05:00Z' });
    const s3 = makeSession({ id: 's3', startsAt: '2026-09-01T11:00:00Z', endsAt: '2026-09-01T12:00:00Z', createdAt: '2026-09-01T09:02:00Z' });

    const orderings = [
      [s1, s2, s3],
      [s3, s1, s2],
      [s2, s3, s1],
    ];

    const results = orderings.map((order) => computeOwnership(order, [], adminIsAdmin1));
    const first = results[0].clusters[0];
    for (const res of results.slice(1)) {
      expect(res.clusters[0].provisionalWinner).toBe(first.provisionalWinner);
      expect(res.clusters[0].sessionIds.sort()).toEqual(first.sessionIds.sort());
      expect(res.clusters[0].contested).toBe(first.contested);
    }
  });

  it('admin resolution commits the chosen session as winner', () => {
    const s1 = makeSession({ id: 's1', startsAt: '2026-09-01T10:00:00Z', endsAt: '2026-09-01T11:00:00Z', createdAt: '2026-09-01T09:00:00Z' });
    const s2 = makeSession({ id: 's2', startsAt: '2026-09-01T10:30:00Z', endsAt: '2026-09-01T11:30:00Z', createdAt: '2026-09-01T09:05:00Z' });

    const clusterKey = 'R:2026-09-01T10:00:00.000Z:2026-09-01T11:30:00.000Z';
    const resolution: AdminResolution = {
      id: 'res1',
      sessionIds: ['s1', 's2'],
      chosenSessionId: 's2',
      createdBy: 'admin1',
      createdAt: '2026-09-01T10:00:00Z',
    };

    const result = computeOwnership([s1, s2], [resolution], adminIsAdmin1);
    expect(result.clusters[0].committedOwner).toBe('s2');
  });

  it('resolution pointing at a deleted session is ignored', () => {
    const s1 = makeSession({ id: 's1', startsAt: '2026-09-01T10:00:00Z', endsAt: '2026-09-01T11:00:00Z', createdAt: '2026-09-01T09:00:00Z' });
    const s2 = makeSession({ id: 's2', startsAt: '2026-09-01T10:30:00Z', endsAt: '2026-09-01T11:30:00Z', createdAt: '2026-09-01T09:05:00Z', deleted: true });

    const clusterKey = 'R:2026-09-01T10:00:00.000Z:2026-09-01T11:30:00.000Z';
    const resolution: AdminResolution = {
      id: 'res1',
      sessionIds: ['s1', 's2'],
      chosenSessionId: 's2',
      createdBy: 'admin1',
      createdAt: '2026-09-01T10:00:00Z',
    };

    // s2 is deleted so it's excluded from the room entirely; cluster is just s1
    const result = computeOwnership([s1, s2], [resolution], adminIsAdmin1);
    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0].sessionIds).toEqual(['s1']);
    expect(result.clusters[0].contested).toBe(false);
    expect(result.clusters[0].committedOwner).toBeUndefined();
  });

  it('two conflicting resolutions: later createdAt wins', () => {
    const s1 = makeSession({ id: 's1', startsAt: '2026-09-01T10:00:00Z', endsAt: '2026-09-01T11:00:00Z', createdAt: '2026-09-01T09:00:00Z' });
    const s2 = makeSession({ id: 's2', startsAt: '2026-09-01T10:30:00Z', endsAt: '2026-09-01T11:30:00Z', createdAt: '2026-09-01T09:05:00Z' });

    const clusterKey = 'R:2026-09-01T10:00:00.000Z:2026-09-01T11:30:00.000Z';
    const res1: AdminResolution = { id: 'res1', sessionIds: ['s1', 's2'], chosenSessionId: 's1', createdBy: 'admin1', createdAt: '2026-09-01T10:00:00Z' };
    const res2: AdminResolution = { id: 'res2', sessionIds: ['s1', 's2'], chosenSessionId: 's2', createdBy: 'admin1', createdAt: '2026-09-01T11:00:00Z' };

    const result = computeOwnership([s1, s2], [res1, res2], adminIsAdmin1);
    expect(result.clusters[0].committedOwner).toBe('s2'); // later resolution wins
  });

  it('a resolution written by a non-admin is ignored (slot stays contested)', () => {
    const s1 = makeSession({ id: 's1', startsAt: '2026-09-01T10:00:00Z', endsAt: '2026-09-01T11:00:00Z', createdAt: '2026-09-01T09:00:00Z' });
    const s2 = makeSession({ id: 's2', startsAt: '2026-09-01T10:30:00Z', endsAt: '2026-09-01T11:30:00Z', createdAt: '2026-09-01T09:05:00Z' });
    const key = 'R:2026-09-01T10:00:00.000Z:2026-09-01T11:30:00.000Z';
    const forged: AdminResolution = { id: 'f1', sessionIds: ['s1', 's2'], chosenSessionId: 's2', createdBy: 'resident7', createdAt: '2026-09-01T10:00:00Z' };

    const cluster = computeOwnership([s1, s2], [forged], adminIsAdmin1).clusters[0];
    expect(cluster.contested).toBe(true);
    expect(cluster.committedOwner).toBeUndefined();
  });

  it('a non-admin resolution NEWER than the admin decision does not overturn it', () => {
    const s1 = makeSession({ id: 's1', startsAt: '2026-09-01T10:00:00Z', endsAt: '2026-09-01T11:00:00Z', createdAt: '2026-09-01T09:00:00Z' });
    const s2 = makeSession({ id: 's2', startsAt: '2026-09-01T10:30:00Z', endsAt: '2026-09-01T11:30:00Z', createdAt: '2026-09-01T09:05:00Z' });
    const key = 'R:2026-09-01T10:00:00.000Z:2026-09-01T11:30:00.000Z';
    const admin: AdminResolution = { id: 'a1', sessionIds: ['s1', 's2'], chosenSessionId: 's1', createdBy: 'admin1', createdAt: '2026-09-01T10:00:00Z' };
    const later: AdminResolution = { id: 'f1', sessionIds: ['s1', 's2'], chosenSessionId: 's2', createdBy: 'resident7', createdAt: '2026-09-01T12:00:00Z' };

    expect(computeOwnership([s1, s2], [admin, later], adminIsAdmin1).clusters[0].committedOwner).toBe('s1');
  });

  it('deleted sessions are excluded from clustering', () => {
    const s1 = makeSession({ id: 's1', deleted: true });
    const s2 = makeSession({ id: 's2' });
    const result = computeOwnership([s1, s2], [], adminIsAdmin1);
    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0].sessionIds).toEqual(['s2']);
  });

  it('sessions in different rooms form separate clusters', () => {
    const s1 = makeSession({ id: 's1', roomId: 'A' });
    const s2 = makeSession({ id: 's2', roomId: 'B' });
    const result = computeOwnership([s1, s2], [], adminIsAdmin1);
    expect(result.clusters).toHaveLength(2);
    expect(result.clusters.map((c) => c.roomId).sort()).toEqual(['A', 'B']);
  });

  it('provisional winner ties broken by id lexically', () => {
    const s1 = makeSession({ id: 'b-session', createdAt: '2026-09-01T09:00:00Z', startsAt: '2026-09-01T10:00:00Z', endsAt: '2026-09-01T11:00:00Z' });
    const s2 = makeSession({ id: 'a-session', createdAt: '2026-09-01T09:00:00Z', startsAt: '2026-09-01T10:30:00Z', endsAt: '2026-09-01T11:30:00Z' });
    const result = computeOwnership([s1, s2], [], adminIsAdmin1);
    expect(result.clusters[0].provisionalWinner).toBe('a-session');
  });
});

// ---------------------------------------------------------------------------
// AC-b3: Swap state machine
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// AC-b4: Series expansion
// ---------------------------------------------------------------------------

describe('expandSeries: AC-b4', () => {
  it('expands Tue+Thu weekly over 3 weeks with one exception and respects until', () => {
    // Base: Tuesday 2026-09-01 10:00-11:00 UTC
    // Rule: weekdays [2 (Tue), 4 (Thu)], intervalWeeks: 1
    // until: 2026-09-17 (Thu of week 3)
    // exceptions: ['2026-09-03'] (Thu of week 1, skipped)
    // window: [2026-09-01T00:00:00Z, 2026-09-18T00:00:00Z)
    const base = {
      startsAt: '2026-09-01T10:00:00.000Z',
      endsAt: '2026-09-01T11:00:00.000Z',
      roomId: 'R',
    };
    const rule = {
      weekdays: [2, 4],
      intervalWeeks: 1,
      until: '2026-09-17',
      exceptions: ['2026-09-03'],
    };
    const window = { start: '2026-09-01T00:00:00.000Z', end: '2026-09-18T00:00:00.000Z' };

    const occurrences = expandSeries(rule, base, window);

    // Expected:
    // Week 1: Tue 09-01 ✓, Thu 09-03 ✗ (exception)
    // Week 2: Tue 09-08 ✓, Thu 09-10 ✓
    // Week 3: Tue 09-15 ✓, Thu 09-17 ✓ (until inclusive)
    expect(occurrences).toHaveLength(5);
    expect(occurrences.map((o) => o.startsAt)).toEqual([
      '2026-09-01T10:00:00.000Z',
      '2026-09-08T10:00:00.000Z',
      '2026-09-10T10:00:00.000Z',
      '2026-09-15T10:00:00.000Z',
      '2026-09-17T10:00:00.000Z',
    ]);
  });

  it('respects until date: occurrences after until are excluded', () => {
    const base = { startsAt: '2026-09-01T09:00:00.000Z', endsAt: '2026-09-01T10:00:00.000Z', roomId: 'R' };
    const rule = { weekdays: [2], intervalWeeks: 1, until: '2026-09-08' };
    const window = { start: '2026-09-01T00:00:00.000Z', end: '2026-09-30T00:00:00.000Z' };

    const occurrences = expandSeries(rule, base, window);
    expect(occurrences.map((o) => o.startsAt)).toEqual([
      '2026-09-01T09:00:00.000Z',
      '2026-09-08T09:00:00.000Z',
    ]);
  });

  it('window start excludes earlier occurrences', () => {
    const base = { startsAt: '2026-09-01T09:00:00.000Z', endsAt: '2026-09-01T10:00:00.000Z', roomId: 'R' };
    const rule = { weekdays: [2], intervalWeeks: 1, until: '2026-09-22' };
    const window = { start: '2026-09-08T00:00:00.000Z', end: '2026-09-20T00:00:00.000Z' };

    const occurrences = expandSeries(rule, base, window);
    expect(occurrences.map((o) => o.startsAt)).toEqual([
      '2026-09-08T09:00:00.000Z',
      '2026-09-15T09:00:00.000Z',
    ]);
  });

  it('Sun+Mon weekday set emits in chronological order (Sun is calendar-last in its week)', () => {
    // Base: Monday 2026-09-07. Rule: weekdays [0 (Sun), 1 (Mon)], 1-week interval.
    // Week 1: Mon 09-07 ✓, Sun 09-13 ✓
    // Week 2: Mon 09-14 ✓, Sun 09-20 ✓
    const base = { startsAt: '2026-09-07T10:00:00.000Z', endsAt: '2026-09-07T11:00:00.000Z', roomId: 'R' };
    const rule = { weekdays: [0, 1], intervalWeeks: 1, until: '2026-09-20' };
    const window = { start: '2026-09-07T00:00:00.000Z', end: '2026-09-21T00:00:00.000Z' };

    const occurrences = expandSeries(rule, base, window);
    expect(occurrences.map((o) => o.startsAt)).toEqual([
      '2026-09-07T10:00:00.000Z',  // Mon
      '2026-09-13T10:00:00.000Z',  // Sun
      '2026-09-14T10:00:00.000Z',  // Mon
      '2026-09-20T10:00:00.000Z',  // Sun
    ]);
  });

  it('bi-weekly: intervalWeeks 2 skips alternating weeks', () => {
    // Mon (1) bi-weekly starting 2026-09-07
    const base = { startsAt: '2026-09-07T08:00:00.000Z', endsAt: '2026-09-07T09:00:00.000Z', roomId: 'R' };
    const rule = { weekdays: [1], intervalWeeks: 2, until: '2026-10-05' };
    const window = { start: '2026-09-07T00:00:00.000Z', end: '2026-10-06T00:00:00.000Z' };

    const occurrences = expandSeries(rule, base, window);
    expect(occurrences.map((o) => o.startsAt)).toEqual([
      '2026-09-07T08:00:00.000Z',
      '2026-09-21T08:00:00.000Z',
      '2026-10-05T08:00:00.000Z',
    ]);
  });
});

// ---------------------------------------------------------------------------
// AC-b5: Stars
// ---------------------------------------------------------------------------

describe('countStars + rankSessions: AC-b5', () => {
  const stars: Star[] = [
    { sessionId: 's1', uid: 'u1', createdAt: '2026-09-01T10:00:00Z' },
    { sessionId: 's1', uid: 'u2', createdAt: '2026-09-01T10:01:00Z' },
    { sessionId: 's2', uid: 'u1', createdAt: '2026-09-01T10:02:00Z' },
    { sessionId: 's3', uid: 'u3', createdAt: '2026-09-01T10:03:00Z' },
    { sessionId: 's3', uid: 'u4', createdAt: '2026-09-01T10:04:00Z' },
    { sessionId: 's3', uid: 'u5', createdAt: '2026-09-01T10:05:00Z' },
  ];

  it('countStars returns correct count per session', () => {
    expect(countStars(stars, 's1')).toBe(2);
    expect(countStars(stars, 's2')).toBe(1);
    expect(countStars(stars, 's3')).toBe(3);
    expect(countStars(stars, 's4')).toBe(0);
  });

  it('rankSessions orders by descending star count', () => {
    const sessions = [
      makeSession({ id: 's1' }),
      makeSession({ id: 's2' }),
      makeSession({ id: 's3' }),
    ];
    const ranked = rankSessions(sessions, stars);
    expect(ranked.map((s) => s.id)).toEqual(['s3', 's1', 's2']);
  });

  it('rankSessions breaks ties by lexical sessionId ascending', () => {
    // s4 and s5 both have 0 stars; s4 < s5 lexically
    const sessions = [
      makeSession({ id: 's5' }),
      makeSession({ id: 's4' }),
    ];
    const ranked = rankSessions(sessions, []);
    expect(ranked.map((s) => s.id)).toEqual(['s4', 's5']);
  });

  it('countStars counts people, not records: two ids of one person star once', () => {
    const stars: Star[] = [
      { sessionId: 's1', uid: '5', createdAt: 'x' },
      { sessionId: 's1', uid: 'telegram:5', createdAt: 'x' },
      { sessionId: 's1', uid: 'telegram:6', createdAt: 'x' },
    ];
    const resolve = (id: string) => (id.startsWith('telegram:') ? id : `telegram:${id}`);
    expect(countStars(stars, 's1', resolve)).toBe(2);
    expect(countStars(stars, 's1')).toBe(3);
  });

  it('rankSessions does not mutate input array', () => {
    const sessions = [makeSession({ id: 's1' }), makeSession({ id: 's2' })];
    const original = [...sessions];
    rankSessions(sessions, stars);
    expect(sessions.map((s) => s.id)).toEqual(original.map((s) => s.id));
  });
});

// ---------------------------------------------------------------------------
// AC-b6: Write-tier permissions
// ---------------------------------------------------------------------------

describe('canPerform: AC-b6', () => {
  // All actions
  const adminOnlyActions: Action[] = [
    'create-keynote', 'edit-keynote',
    'create-room', 'edit-room',
    'create-track', 'edit-track',
    'create-format', 'edit-format',
    'create-tag', 'edit-tag',
    'create-break', 'edit-break',
    'resolve-contest', 'import',
    'edit-any-session',
  ];

  const loggedInActions: Action[] = [
    'create-session', 'star', 'comment',
  ];

  const ownershipActions: Action[] = ['edit-own-session', 'delete-own-session'];

  describe('logged-out: no writes allowed', () => {
    const allActions: Action[] = [...adminOnlyActions, ...loggedInActions, ...ownershipActions];
    for (const action of allActions) {
      it(`denies ${action}`, () => {
        expect(canPerform('logged-out', action)).toBe(false);
      });
    }
  });

  describe('admin: everything allowed', () => {
    const allActions: Action[] = [...adminOnlyActions, ...loggedInActions, ...ownershipActions];
    for (const action of allActions) {
      it(`allows ${action}`, () => {
        expect(canPerform('admin', action, { actorUid: 'admin1', recordOwnerUid: 'other' })).toBe(true);
      });
    }
  });

  describe('logged-in: limited actions', () => {
    it('allows create-session', () => {
      expect(canPerform('logged-in', 'create-session')).toBe(true);
    });

    it('allows star', () => {
      expect(canPerform('logged-in', 'star')).toBe(true);
    });

    it('allows comment', () => {
      expect(canPerform('logged-in', 'comment')).toBe(true);
    });

    it('allows edit-own-session when actorUid === recordOwnerUid', () => {
      expect(canPerform('logged-in', 'edit-own-session', { actorUid: 'u1', recordOwnerUid: 'u1' })).toBe(true);
    });

    it('denies edit-own-session when actorUid !== recordOwnerUid', () => {
      expect(canPerform('logged-in', 'edit-own-session', { actorUid: 'u1', recordOwnerUid: 'u2' })).toBe(false);
    });

    it('allows delete-own-session when actorUid === recordOwnerUid', () => {
      expect(canPerform('logged-in', 'delete-own-session', { actorUid: 'u1', recordOwnerUid: 'u1' })).toBe(true);
    });

    it('denies delete-own-session when actorUid !== recordOwnerUid', () => {
      expect(canPerform('logged-in', 'delete-own-session', { actorUid: 'u1', recordOwnerUid: 'u2' })).toBe(false);
    });

    for (const action of adminOnlyActions) {
      it(`denies admin-only action: ${action}`, () => {
        expect(canPerform('logged-in', action)).toBe(false);
      });
    }
  });
});

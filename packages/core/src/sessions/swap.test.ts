// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Slot swaps (AC-b3) as offers about positions: every proposal is built with
// buildSwapRequest, which snapshots both talks.

import { describe, expect, it } from 'vitest';
import { MAX_SWAP_TTL_HOURS, applySwap, buildSwapRequest, canApplySwap, deriveSwapState, planSwapApply, decideSwap } from './swap.js';
import type { Session, SlotChoice, SwapRequest } from './types.js';

const T0 = '2026-09-01T08:00:00.000Z';
const NOW = '2026-09-01T09:00:00.000Z';
function talk(id: string, roomId: string, startsAt: string, endsAt: string, extra: Partial<Session> = {}): Session {
  return { id, type: 'session', roomId, title: id, startsAt, endsAt, createdBy: `owner-${id}`, createdAt: T0, ...extra };
}
const alice = talk('alice', 'A', '2026-09-01T10:00:00.000Z', '2026-09-01T11:00:00.000Z'); // holds the slot
const bob = talk('bob', 'B', '2026-09-01T15:00:00.000Z', '2026-09-01T16:00:00.000Z'); // asks for it
const carol = talk('carol', 'C', '2026-09-01T17:00:00.000Z', '2026-09-01T18:00:00.000Z');
const dave = talk('dave', 'D', '2026-09-01T12:00:00.000Z', '2026-09-01T13:00:00.000Z');
const ALL = [alice, bob, carol, dave];

function propose(id: string, from: Session, target: Session, opts: { at?: string; alt?: SlotChoice | null; by?: string; ttlHours?: number } = {}): SwapRequest {
  return buildSwapRequest({
    id, from, target, proposedAlt: opts.alt ?? null, createdBy: opts.by ?? from.createdBy, now: opts.at ?? T0, ttlHours: opts.ttlHours ?? 48,
  });
}
const decide = (w: SwapRequest, type: 'accepted-apply' | 'declined' | 'withdrawn', by: string, at = '2026-09-01T08:30:00.000Z'): SwapRequest =>
  ({ ...w, outcome: { type, createdBy: by, createdAt: at } });
const moved = (s: Session, to: Session): Session => ({ ...s, roomId: to.roomId, startsAt: to.startsAt, endsAt: to.endsAt });
const state = (w: SwapRequest, all: SwapRequest[] = [w], sessions: Session[] = ALL, now = NOW, resolve?: (id: string) => string, tz?: string) =>
  deriveSwapState(w, all, sessions, now, resolve, tz);

describe('buildSwapRequest', () => {
  it('snapshots both talks and sets the expiry, capped at 7 days', () => {
    const w = propose('w', bob, alice);
    expect(w.snapshot).toEqual({
      from: { roomId: 'B', startsAt: bob.startsAt, endsAt: bob.endsAt, owner: 'owner-bob' },
      target: { roomId: 'A', startsAt: alice.startsAt, endsAt: alice.endsAt, owner: 'owner-alice' },
    });
    expect(w.expiresAt).toBe('2026-09-03T08:00:00.000Z');
    expect(propose('w', bob, alice, { ttlHours: 1000 }).expiresAt).toBe(new Date(Date.parse(T0) + MAX_SWAP_TTL_HOURS * 3_600_000).toISOString());
  });
});

describe('states', () => {
  it('a fresh proposal is proposed, then expired at expiresAt', () => {
    const w = propose('w', bob, alice);
    expect(state(w)).toBe('proposed');
    expect(state(w, [w], ALL, w.expiresAt)).toBe('expired');
  });

  it('the holder accepts or declines; the requester withdraws', () => {
    const w = propose('w', bob, alice);
    expect(state(decide(w, 'accepted-apply', 'owner-alice'))).toBe('accepted-apply');
    expect(state(decide(w, 'declined', 'owner-alice'))).toBe('declined');
    expect(state(decide(w, 'withdrawn', 'owner-bob'))).toBe('withdrawn');
  });

  it('ignores decisions by anyone else, or out of time', () => {
    const w = propose('w', bob, alice);
    expect(state(decide(w, 'accepted-apply', 'owner-bob'))).toBe('proposed');
    expect(state(decide(w, 'declined', 'mallory'))).toBe('proposed');
    expect(state(decide(w, 'withdrawn', 'owner-alice'))).toBe('proposed');
    expect(state(decide(w, 'accepted-apply', 'owner-alice', '2026-09-01T07:00:00.000Z'))).toBe('proposed'); // before it was made
    expect(state(decide(w, 'declined', 'owner-alice', w.expiresAt), [w], ALL, '2026-09-04T00:00:00.000Z')).toBe('expired'); // at expiry
    expect(state(decide(w, 'withdrawn', 'owner-bob', '2026-09-05T00:00:00.000Z'), [w], ALL, '2026-09-06T00:00:00.000Z')).toBe('withdrawn');
  });

  it('resolves deciders through the registry', () => {
    const resolve = (id: string) => (id === 'alice-key' ? 'owner-alice' : id);
    const w = propose('w', bob, alice);
    expect(state(decide(w, 'accepted-apply', 'alice-key'), undefined, ALL, NOW, resolve)).toBe('accepted-apply');
  });

  it('a terminal outcome stays put even if a talk later disappears or moves', () => {
    const w = decide(propose('w', bob, alice), 'accepted-apply', 'owner-alice');
    expect(state(w, [w], [bob])).toBe('accepted-apply');
    expect(state(w, [w], [moved(bob, alice), moved(alice, bob)])).toBe('accepted-apply');
  });

  it('voided-by-delete when either talk is deleted, voided-by-move when either moved', () => {
    const w = propose('w', bob, alice);
    expect(state(w, [w], [alice, { ...bob, deleted: true }])).toBe('voided-by-delete');
    expect(state(w, [w], [{ ...alice, deleted: true }, bob])).toBe('voided-by-delete');
    expect(state(w, [w], [alice, { ...bob, startsAt: '2026-09-01T15:30:00.000Z', endsAt: '2026-09-01T16:30:00.000Z' }])).toBe('voided-by-move');
    expect(state(w, [w], [{ ...alice, roomId: 'Z' }, bob])).toBe('voided-by-move');
  });
});

describe('invalid proposals block nobody', () => {
  it('a proposal not made by the requesting talk\'s owner', () => {
    const forged = propose('aaa', bob, alice, { by: 'mallory', at: '2026-09-01T07:00:00.000Z' });
    const real = propose('zzz', carol, alice);
    expect(state(forged, [forged, real])).toBe('invalid');
    expect(state(real, [forged, real])).toBe('proposed');
    expect(canApplySwap('owner-alice', forged, ALL, [forged, real], NOW)).toBe(false);
  });

  it('resolves the proposer through the registry', () => {
    const resolve = (id: string) => (id === 'bob-key' ? 'owner-bob' : id);
    expect(state(propose('w', bob, alice, { by: 'bob-key' }), undefined, ALL, NOW, resolve)).toBe('proposed');
    expect(state(propose('w', bob, alice, { by: 'bob-key' }))).toBe('invalid');
  });

  it('a self-swap, a missing talk, a changed owner, or a forged snapshot owner', () => {
    expect(state(propose('s', alice, alice))).toBe('invalid');
    expect(state(propose('m', bob, talk('ghost', 'A', alice.startsAt, alice.endsAt)))).toBe('invalid');
    expect(state(propose('o', bob, alice), undefined, [{ ...alice, createdBy: 'owner-x' }, bob])).toBe('invalid');
    const w = propose('f', bob, alice);
    expect(state({ ...w, snapshot: { ...w.snapshot, target: { ...w.snapshot.target, owner: 'owner-bob' } } })).toBe('invalid');
  });

  it('an alternative that is incomplete, backwards, or off the hub grid', () => {
    const alts = [
      { roomId: '', startsAt: '2026-09-01T14:00:00.000Z', endsAt: '2026-09-01T15:00:00.000Z' },
      { roomId: 'C', startsAt: '2026-09-01T15:00:00.000Z', endsAt: '2026-09-01T14:00:00.000Z' },
      { roomId: 'C', startsAt: '2026-09-01T14:10:00.000Z', endsAt: '2026-09-01T15:10:00.000Z' },
    ];
    for (const alt of alts) expect(state(propose('w', bob, alice, { alt }))).toBe('invalid');
    // 14:00 UTC is 19:45 in Kathmandu: off the grid there, on it in UTC.
    const utcGrid = { roomId: 'C', startsAt: '2026-09-01T14:00:00.000Z', endsAt: '2026-09-01T15:00:00.000Z' };
    expect(state(propose('w', bob, alice, { alt: utcGrid }))).toBe('proposed');
    expect(state(propose('w', bob, alice, { alt: utcGrid }), undefined, ALL, NOW, undefined, 'Asia/Kathmandu')).toBe('invalid');
  });

  it('an expiry beyond 7 days or not after creation', () => {
    const w = propose('w', bob, alice);
    expect(state({ ...w, expiresAt: '9999-01-01T00:00:00.000Z' })).toBe('invalid');
    expect(state({ ...w, expiresAt: w.createdAt })).toBe('invalid');
  });
});

describe('one live proposal per slot, judged by history', () => {
  it('the earlier of two concurrent proposals is live; ties go to the smaller id', () => {
    const first = propose('b', bob, alice, { at: '2026-09-01T08:00:00.000Z' });
    const second = propose('a', carol, alice, { at: '2026-09-01T08:05:00.000Z' });
    expect([state(first, [first, second]), state(second, [first, second])]).toEqual(['proposed', 'auto-declined']);
    const tieA = propose('a', bob, alice);
    const tieB = propose('b', carol, alice);
    expect([state(tieA, [tieA, tieB]), state(tieB, [tieA, tieB])]).toEqual(['proposed', 'auto-declined']);
  });

  it('a later proposal is live if the earlier one had already expired, been declined or withdrawn', () => {
    const expiredEarly = propose('e', bob, alice, { at: '2026-09-01T06:00:00.000Z', ttlHours: 1 });
    const declinedEarly = decide(propose('d', dave, alice, { at: '2026-09-01T06:10:00.000Z' }), 'declined', 'owner-alice', '2026-09-01T06:20:00.000Z');
    const later = propose('l', carol, alice, { at: '2026-09-01T08:00:00.000Z' });
    expect(state(later, [expiredEarly, declinedEarly, later])).toBe('proposed');
  });

  it('a proposal beaten while the earlier one was open stays declined afterwards', () => {
    const first = propose('first', bob, alice, { at: '2026-09-01T08:00:00.000Z' });
    const second = propose('second', carol, alice, { at: '2026-09-01T08:05:00.000Z' });
    const declined = decide(first, 'declined', 'owner-alice', '2026-09-01T08:30:00.000Z');
    expect(state(second, [declined, second])).toBe('auto-declined');
  });

  it('proposals for different positions do not compete', () => {
    const toAlice = propose('a', bob, alice);
    const toDave = propose('b', carol, dave);
    expect([state(toAlice, [toAlice, toDave]), state(toDave, [toAlice, toDave])]).toEqual(['proposed', 'proposed']);
  });
});

describe('after an accept, nothing follows the moved talks', () => {
  const afterAccept = [moved(bob, alice), moved(alice, bob), carol, dave];

  it('the requester\'s other proposal is void (one talk cannot win two swaps)', () => {
    const toDave = propose('w2', bob, dave);
    expect(state(toDave, [toDave], afterAccept)).toBe('voided-by-move');
  });

  it('a proposal aimed at a talk that moved is void', () => {
    const forBob = propose('c', carol, bob);
    expect(state(forBob, [forBob], afterAccept)).toBe('voided-by-move');
  });

  it('a fresh proposal on the moved talk\'s new place is live, not blocked by dead ones', () => {
    const w1 = decide(propose('w1', bob, alice), 'accepted-apply', 'owner-alice');
    const rival = propose('rival', carol, alice, { at: '2026-09-01T08:10:00.000Z' });
    const fresh = propose('fresh', dave, afterAccept[1], { at: '2026-09-01T08:40:00.000Z' });
    expect(state(rival, [w1, rival, fresh], afterAccept)).toBe('voided-by-move');
    expect(state(fresh, [w1, rival, fresh], afterAccept)).toBe('proposed');
  });
});

describe('canApplySwap', () => {
  it('only the holder, only while live', () => {
    const live = propose('a', bob, alice);
    const rival = propose('z', carol, alice);
    expect(canApplySwap('owner-alice', live, ALL, [live, rival], NOW)).toBe(true);
    expect(canApplySwap('owner-bob', live, ALL, [live, rival], NOW)).toBe(false);
    expect(canApplySwap('owner-alice', rival, ALL, [live, rival], NOW)).toBe(false); // auto-declined
    expect(canApplySwap('owner-alice', live, ALL, [live], '2026-09-04T00:00:00.000Z')).toBe(false); // expired
    expect(canApplySwap(null, live, ALL, [live], NOW)).toBe(false);
  });
});

describe('planSwapApply', () => {
  it('moves the requester into the slot and the holder to the alternative', () => {
    const alt = { roomId: 'C', startsAt: '2026-09-01T14:00:00.000Z', endsAt: '2026-09-01T15:00:00.000Z' };
    expect(planSwapApply(propose('p', bob, alice, { alt }), [alice, bob], 'UTC')).toEqual({
      ok: true,
      updates: [moved(bob, alice), { ...alice, ...alt }],
    });
  });

  it('with no alternative the talks trade places', () => {
    expect(planSwapApply(propose('p', bob, alice), [alice, bob], 'UTC')).toEqual({ ok: true, updates: [moved(bob, alice), moved(alice, bob)] });
  });

  it('refuses when the moved talks would overlap each other', () => {
    const near = talk('near', 'A', '2026-09-01T10:30:00.000Z', '2026-09-01T11:30:00.000Z');
    expect(planSwapApply(propose('p', near, alice), [alice, near], 'UTC')).toMatchObject({ ok: false, reason: 'slot-taken' });
    const ownSlot = { roomId: 'A', startsAt: alice.startsAt, endsAt: alice.endsAt };
    expect(planSwapApply(propose('p', bob, alice, { alt: ownSlot }), [alice, bob], 'UTC')).toMatchObject({ ok: false });
  });

  it('refuses when a third talk sits on either destination, in the same room only', () => {
    const onAlice = talk('squat', 'A', '2026-09-01T10:30:00.000Z', '2026-09-01T11:30:00.000Z');
    const onBob = talk('squat2', 'B', '2026-09-01T15:30:00.000Z', '2026-09-01T16:30:00.000Z');
    const elsewhere = talk('elsewhere', 'Z', alice.startsAt, alice.endsAt);
    const gone = talk('gone', 'A', alice.startsAt, alice.endsAt, { deleted: true });
    const w = propose('p', bob, alice);
    expect(planSwapApply(w, [alice, bob, onAlice], 'UTC')).toEqual({ ok: false, reason: 'slot-taken', blockedBy: ['squat'] });
    expect(planSwapApply(w, [alice, bob, onBob], 'UTC')).toEqual({ ok: false, reason: 'slot-taken', blockedBy: ['squat2'] });
    expect(planSwapApply(w, [alice, bob, elsewhere, gone], 'UTC').ok).toBe(true);
  });

  it('refuses when a talk is deleted or it is a self-swap, and a bad alternative', () => {
    const w = propose('p', bob, alice);
    expect(planSwapApply(w, [alice, { ...bob, deleted: true }], 'UTC')).toEqual({ ok: false, reason: 'missing-session' });
    expect(planSwapApply(w, [{ ...alice, deleted: true }, bob], 'UTC')).toEqual({ ok: false, reason: 'missing-session' });
    expect(planSwapApply(propose('s', alice, alice), [alice], 'UTC')).toEqual({ ok: false, reason: 'missing-session' });
    const offGrid = { roomId: 'C', startsAt: '2026-09-01T14:00:00.000Z', endsAt: '2026-09-01T15:00:00.000Z' };
    expect(planSwapApply(propose('k', bob, alice, { alt: offGrid }), [alice, bob], 'Asia/Kathmandu')).toEqual({ ok: false, reason: 'bad-alternative' });
  });
});

describe('applySwap', () => {
  it('the holder gets both writes and a canonical outcome; anyone else is refused', () => {
    const w = propose('p', bob, alice);
    expect(applySwap('owner-bob', w, ALL, [w], NOW, 'UTC')).toEqual({ ok: false, reason: 'not-allowed' });
    expect(applySwap('owner-alice', w, ALL, [w], '2026-09-01T11:00:00+02:00', 'UTC')).toEqual({
      ok: true,
      updates: [moved(bob, alice), moved(alice, bob)],
      outcome: { type: 'accepted-apply', createdBy: 'owner-alice', createdAt: NOW },
    });
  });
});

describe('round 5: only live proposals block', () => {
  it('a beaten proposal does not block a later one (N1)', () => {
    const p1 = decide(propose('p1', bob, alice, { at: '2026-09-01T08:00:00.000Z' }), 'declined', 'owner-alice', '2026-09-01T08:10:00.000Z');
    const p2 = propose('p2', carol, alice, { at: '2026-09-01T08:05:00.000Z' }); // beaten by p1
    const p3 = propose('p3', dave, alice, { at: '2026-09-01T08:20:00.000Z' });
    expect(state(p2, [p1, p2, p3])).toBe('auto-declined');
    expect(state(p3, [p1, p2, p3])).toBe('proposed');
  });

  it('rivals voided by an accept do not block the new occupant (N2)', () => {
    const afterAccept = [moved(bob, alice), moved(alice, bob), carol, dave];
    const w1 = decide(propose('w1', bob, alice), 'accepted-apply', 'owner-alice');
    const rival = propose('rival', carol, alice, { at: '2026-09-01T08:10:00.000Z' });
    const fresh = propose('fresh', dave, afterAccept[0], { at: '2026-09-01T08:40:00.000Z' }); // bob now at A 10-11
    expect(state(fresh, [w1, rival, fresh], afterAccept)).toBe('proposed');
  });

  it('a recreated talk at the same place starts clean (N3)', () => {
    const old = propose('old', bob, alice, { at: '2026-09-01T07:00:00.000Z' });
    const alice2 = talk('alice2', 'A', alice.startsAt, alice.endsAt);
    const fresh = propose('fresh', carol, alice2, { at: '2026-09-01T08:00:00.000Z' });
    const sessions = [{ ...alice, deleted: true }, alice2, bob, carol];
    expect(state(old, [old, fresh], sessions)).toBe('voided-by-delete');
    expect(state(fresh, [old, fresh], sessions)).toBe('proposed');
  });

  it('a stranger\'s self-consistent record about talks that do not exist blocks nobody (N4)', () => {
    const phantom = talk('phantom', 'Z', '2026-09-01T12:00:00.000Z', '2026-09-01T13:00:00.000Z', { createdBy: 'mallory' });
    const junk = propose('aaa', phantom, alice, { at: '2026-09-01T07:00:00.000Z' });
    const real = propose('zzz', bob, alice);
    expect(state(junk, [junk, real])).toBe('invalid');
    expect(state(real, [junk, real])).toBe('proposed');
  });

  it('an alternative on top of the slot being given up is invalid (N8)', () => {
    const alt = { roomId: 'A', startsAt: '2026-09-01T10:30:00.000Z', endsAt: '2026-09-01T11:30:00.000Z' };
    expect(state(propose('w', bob, alice, { alt }))).toBe('invalid');
  });

  it('boundaries: a TTL of exactly 7 days is fine; a decision at the proposal instant counts', () => {
    const w = propose('w', bob, alice, { ttlHours: MAX_SWAP_TTL_HOURS });
    expect(state(w)).toBe('proposed');
    expect(state(decide(w, 'declined', 'owner-alice', w.createdAt))).toBe('declined');
    const expiresExactly = propose('e', bob, alice, { at: '2026-09-01T06:00:00.000Z', ttlHours: 2 }); // until 08:00
    const later = propose('l', carol, alice, { at: '2026-09-01T08:00:00.000Z' });
    expect(state(later, [expiresExactly, later])).toBe('proposed');
  });

  it('a move of only the start, or only the end, voids it; so does a changed requester owner', () => {
    const w = propose('w', bob, alice);
    expect(state(w, [w], [{ ...alice, startsAt: '2026-09-01T09:30:00.000Z' }, bob])).toBe('voided-by-move');
    expect(state(w, [w], [{ ...alice, endsAt: '2026-09-01T11:30:00.000Z' }, bob])).toBe('voided-by-move');
    expect(state(w, [w], [alice, { ...bob, createdBy: 'owner-x' }])).toBe('invalid');
  });

  it('proposals on the same room and start but a different end are different positions', () => {
    const longer = talk('longer', 'A', alice.startsAt, '2026-09-01T11:30:00.000Z');
    const a = propose('a', bob, alice);
    const b = propose('b', carol, longer, { at: '2026-09-01T08:05:00.000Z' });
    expect(state(b, [a, b], [alice, longer, bob, carol])).toBe('proposed');
  });
});

describe('round 5: guarded decisions and clock skew', () => {
  it('decideSwap: the holder declines a live proposal; the requester withdraws a live or beaten one', () => {
    const w = propose('w', bob, alice);
    expect(decideSwap('owner-alice', 'declined', w, ALL, [w], NOW)).toEqual({ ok: true, outcome: { type: 'declined', createdBy: 'owner-alice', createdAt: NOW } });
    expect(decideSwap('owner-bob', 'declined', w, ALL, [w], NOW).ok).toBe(false);
    expect(decideSwap('owner-bob', 'withdrawn', w, ALL, [w], NOW).ok).toBe(true);
    expect(decideSwap('owner-alice', 'withdrawn', w, ALL, [w], NOW).ok).toBe(false);
    const beaten = propose('z', carol, alice, { at: '2026-09-01T08:05:00.000Z' });
    expect(decideSwap('owner-carol', 'withdrawn', beaten, ALL, [w, beaten], NOW).ok).toBe(true);
    expect(decideSwap('owner-alice', 'declined', beaten, ALL, [w, beaten], NOW).ok).toBe(false);
  });

  it('decideSwap refuses once decided: no withdrawing an accepted swap (N6)', () => {
    const accepted = decide(propose('w', bob, alice), 'accepted-apply', 'owner-alice');
    expect(decideSwap('owner-bob', 'withdrawn', accepted, ALL, [accepted], NOW).ok).toBe(false);
    expect(decideSwap(null, 'withdrawn', accepted, ALL, [accepted], NOW).ok).toBe(false);
  });

  it('a decision is never timestamped before the proposal, whatever the clock says (N9)', () => {
    const ahead = { ...propose('w', bob, alice), createdAt: '2026-09-01T09:30:00.000Z', expiresAt: '2026-09-02T09:30:00.000Z' };
    const r = applySwap('owner-alice', ahead, ALL, [ahead], '2026-09-01T09:40:00.000Z', 'UTC');
    expect(r.ok && r.outcome.createdAt).toBe('2026-09-01T09:40:00.000Z');
    const d = decideSwap('owner-alice', 'declined', ahead, ALL, [ahead], '2026-09-01T09:40:00.000Z');
    expect(d.ok && d.outcome.createdAt).toBe('2026-09-01T09:40:00.000Z');
    // The holder's clock is behind the proposer's: the outcome is lifted to the proposal time, so it still counts.
    const behind = applySwap('owner-alice', ahead, ALL, [ahead], '2026-09-01T09:20:00.000Z', 'UTC');
    expect(behind.ok && behind.outcome.createdAt).toBe(ahead.createdAt);
    const recorded = { ...ahead, outcome: behind.ok ? behind.outcome : null };
    expect(deriveSwapState(recorded, [recorded], ALL, '2026-09-01T10:00:00.000Z')).toBe('accepted-apply');
  });
});

describe('planSwapApply: adjacency is not a clash', () => {
  it('a third talk right next to a destination does not block', () => {
    const before = talk('before', 'A', '2026-09-01T09:00:00.000Z', alice.startsAt);
    const after = talk('after', 'B', bob.endsAt, '2026-09-01T17:00:00.000Z');
    expect(planSwapApply(propose('p', bob, alice), [alice, bob, before, after], 'UTC').ok).toBe(true);
  });
});

describe('round 6: pin the fixes the suite did not prove', () => {
  it('two talks at the same position are separate positions (talk identity in the key)', () => {
    const twin = talk('twin', 'A', alice.startsAt, alice.endsAt); // clashes with alice
    const a = propose('a', bob, alice);
    const b = propose('b', carol, twin, { at: '2026-09-01T08:05:00.000Z' });
    const sessions = [alice, twin, bob, carol];
    expect([state(a, [a, b], sessions), state(b, [a, b], sessions)]).toEqual(['proposed', 'proposed']);
  });

  it('withdraw is refused once decided, expired or void', () => {
    const w = propose('w', bob, alice);
    expect(decideSwap('owner-bob', 'withdrawn', decide(w, 'declined', 'owner-alice'), ALL, [w], NOW).ok).toBe(false);
    expect(decideSwap('owner-bob', 'withdrawn', w, ALL, [w], '2026-09-04T00:00:00.000Z').ok).toBe(false);
    expect(decideSwap('owner-bob', 'withdrawn', w, [alice, { ...bob, startsAt: '2026-09-01T15:30:00.000Z', endsAt: '2026-09-01T16:30:00.000Z' }], [w], NOW).ok).toBe(false);
  });

  it('decideSwap lifts the decision time to the proposal when the clock is behind', () => {
    const ahead = { ...propose('w', bob, alice), createdAt: '2026-09-01T09:30:00.000Z', expiresAt: '2026-09-02T09:30:00.000Z' };
    const d = decideSwap('owner-alice', 'declined', ahead, ALL, [ahead], '2026-09-01T09:20:00.000Z');
    expect(d.ok && d.outcome.createdAt).toBe(ahead.createdAt);
  });

  it('deciders resolve through the registry in decideSwap too', () => {
    const resolve = (id: string) => (id === 'alice-key' ? 'owner-alice' : id);
    const w = propose('w', bob, alice);
    expect(decideSwap('alice-key', 'declined', w, ALL, [w], NOW, resolve).ok).toBe(true);
    expect(decideSwap('alice-key', 'declined', w, ALL, [w], NOW).ok).toBe(false);
  });

  it('an alternative next to the target slot, or in another room at the same time, is valid', () => {
    expect(state(propose('w', bob, alice, { alt: { roomId: 'A', startsAt: alice.endsAt, endsAt: '2026-09-01T12:00:00.000Z' } }))).toBe('proposed');
    expect(state(propose('w', bob, alice, { alt: { roomId: 'Z', startsAt: alice.startsAt, endsAt: alice.endsAt } }))).toBe('proposed');
  });

  it('buildSwapRequest stores a canonical creation time', () => {
    expect(propose('w', bob, alice, { at: '2026-09-01T10:00:00+02:00' }).createdAt).toBe(T0);
  });
});

describe('round 6: deriving many swaps stays fast', () => {
  it('200 proposals with alternatives on one position derive in a few seconds at most', () => {
    const swaps = Array.from({ length: 200 }, (_, i) =>
      propose(`p${String(i).padStart(3, '0')}`, bob, alice, {
        at: new Date(Date.parse(T0) + i * 60_000).toISOString(),
        alt: { roomId: 'C', startsAt: '2026-09-01T14:00:00.000Z', endsAt: '2026-09-01T15:00:00.000Z' },
      }),
    );
    const t = performance.now();
    for (const w of swaps) deriveSwapState(w, swaps, ALL, NOW, undefined, 'Europe/Rome');
    // Guards the old cubic blow-up (about 6 s); generous so a loaded CI runner does not flake.
    expect(performance.now() - t).toBeLessThan(4000);
  });
});

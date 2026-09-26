// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Slot swaps (AC-b3), as offers about positions. A proposal snapshots both
// talks (room, times, owner) when it is made; if either talk has moved since,
// the proposal is void. Only the proposal and its terminal outcome are
// written; every other state is derived here from the records and `now`.

import { isOnHalfHourGrid } from './grid.js';
import type { Session, SlotChoice, SlotSnapshot, SwapOutcome, SwapRequest } from './types.js';

export type SwapState =
  | 'proposed'
  | 'expired'
  | 'auto-declined'
  | 'accepted-apply'
  | 'declined'
  | 'withdrawn'
  | 'voided-by-delete'
  /** A talk moved since the proposal was made. */
  | 'voided-by-move'
  /** Not a real proposal: malformed, forged, a self-swap, or its talk is missing. */
  | 'invalid';

/** The longest a proposal may stay open. */
export const MAX_SWAP_TTL_HOURS = 7 * 24;

type Resolve = (id: string) => string;
const same: Resolve = (id) => id;
const at = (iso: string) => Date.parse(iso);
const HOUR = 3_600_000;

const snapshotOf = (s: Session): SlotSnapshot => ({ roomId: s.roomId, startsAt: s.startsAt, endsAt: s.endsAt, owner: s.createdBy });
const samePlace = (s: Session, snap: SlotSnapshot) =>
  s.roomId === snap.roomId && at(s.startsAt) === at(snap.startsAt) && at(s.endsAt) === at(snap.endsAt);
/** Proposals compete per target talk at its snapshotted position. */
const slotKey = (w: SwapRequest) =>
  `${w.targetSessionId}@${w.snapshot.target.roomId}:${at(w.snapshot.target.startsAt)}:${at(w.snapshot.target.endsAt)}`;

function isChoice(alt: SlotChoice, timezone: string): boolean {
  return (
    typeof alt.roomId === 'string' && alt.roomId !== '' &&
    at(alt.endsAt) > at(alt.startsAt) &&
    isOnHalfHourGrid(alt, timezone)
  );
}

/** Checks that need no current sessions: shape, author, TTL, alternative. */
function wellFormed(w: SwapRequest, resolve: Resolve, timezone: string): boolean {
  const snap = w.snapshot;
  if (!snap?.from || !snap.target || w.fromSessionId === w.targetSessionId) return false;
  if (resolve(w.createdBy) !== resolve(snap.from.owner)) return false;
  const ttl = at(w.expiresAt) - at(w.createdAt);
  if (!(ttl > 0 && ttl <= MAX_SWAP_TTL_HOURS * HOUR)) return false;
  const alt = w.proposedAlt;
  if (alt == null) return true;
  // An alternative on top of the slot being given up could never be applied.
  const t = snap.target;
  const onTarget = alt.roomId === t.roomId && at(alt.startsAt) < at(t.endsAt) && at(t.startsAt) < at(alt.endsAt);
  return isChoice(alt, timezone) && !onTarget;
}

type Sessions = Map<string, Session>;

/** Whether the proposal's talks still exist, with the recorded owners, where it recorded them. */
function stands(w: SwapRequest, byId: Sessions, resolve: Resolve): 'ok' | 'invalid' | 'voided-by-delete' | 'voided-by-move' {
  const from = byId.get(w.fromSessionId);
  const target = byId.get(w.targetSessionId);
  if (!from || !target) return 'invalid';
  if (resolve(from.createdBy) !== resolve(w.snapshot.from.owner)) return 'invalid';
  if (resolve(target.createdBy) !== resolve(w.snapshot.target.owner)) return 'invalid';
  if (from.deleted || target.deleted) return 'voided-by-delete';
  if (!samePlace(from, w.snapshot.from) || !samePlace(target, w.snapshot.target)) return 'voided-by-move';
  return 'ok';
}

/**
 * The recorded outcome, if its author may decide it and it was recorded in
 * time: the holder (target owner at proposal time) accepts or declines
 * between the proposal and its expiry; the requester withdraws after
 * proposing. Anyone else's outcome is ignored.
 */
function validOutcome(w: SwapRequest, resolve: Resolve) {
  const o = w.outcome;
  if (o == null || o.createdBy == null) return null;
  const decider = o.type === 'withdrawn' ? w.snapshot.from.owner : w.snapshot.target.owner;
  if (resolve(o.createdBy) !== resolve(decider)) return null;
  const t = at(o.createdAt);
  if (!(t >= at(w.createdAt))) return null;
  if (o.type !== 'withdrawn' && !(t < at(w.expiresAt))) return null;
  return o;
}

/** Whether `q` was still open at the instant `t`. */
function openAt(q: SwapRequest, t: number, resolve: Resolve): boolean {
  if (!(at(q.expiresAt) > t)) return false;
  const o = validOutcome(q, resolve);
  return o == null || at(o.createdAt) > t;
}

const byAge = (a: SwapRequest, b: SwapRequest) => at(a.createdAt) - at(b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Which proposals on `swap`'s position were beaten. Walked oldest first: a
 * proposal is beaten if an earlier proposal that was not itself beaten, still
 * stands, and was open when it was made exists. So a beaten, void, invalid or
 * decided-before proposal never blocks anyone.
 */
function beatenOnPosition(swap: SwapRequest, allSwaps: SwapRequest[], byId: Sessions, resolve: Resolve, timezone: string): Set<string> {
  const key = slotKey(swap);
  const rivals = [...allSwaps.filter((q) => q.id !== swap.id), swap]
    .filter((q) => slotKey(q) === key && wellFormed(q, resolve, timezone))
    .sort(byAge);
  const beaten = new Set<string>();
  const blockers: SwapRequest[] = [];
  for (const p of rivals) {
    const made = at(p.createdAt);
    if (blockers.some((q) => openAt(q, made, resolve))) beaten.add(p.id);
    else if (stands(p, byId, resolve) === 'ok') blockers.push(p);
  }
  return beaten;
}

/**
 * Derive the current state of a swap request (AC-b3).
 *
 * Order: malformed or forged proposals are `invalid`; a valid terminal outcome
 * then wins and is stable; otherwise the talks must exist with the recorded
 * owners (else `invalid`), not be deleted (`voided-by-delete`) and stand where
 * they were (`voided-by-move`, for as long as either is away); then `expired`;
 * then `auto-declined` if an earlier live proposal on the same target talk and
 * position was open when this one was made (see beatenOnPosition); else
 * `proposed`.
 */
export function deriveSwapState(
  swap: SwapRequest,
  allSwaps: SwapRequest[],
  sessions: Session[],
  now: string,
  resolve: Resolve = same,
  timezone = 'UTC',
): SwapState {
  if (!wellFormed(swap, resolve, timezone)) return 'invalid';
  const outcome = validOutcome(swap, resolve);
  if (outcome) return outcome.type;

  const byId = new Map(sessions.map((s) => [s.id, s]));
  const standing = stands(swap, byId, resolve);
  if (standing !== 'ok') return standing;
  if (at(now) >= at(swap.expiresAt)) return 'expired';
  return beatenOnPosition(swap, allSwaps, byId, resolve, timezone).has(swap.id) ? 'auto-declined' : 'proposed';
}

/** A new proposal from `from` for `target`'s slot, snapshotting both. */
export function buildSwapRequest(input: {
  id: string;
  from: Session;
  target: Session;
  proposedAlt?: SlotChoice | null;
  createdBy: string;
  now: string;
  ttlHours: number;
}): SwapRequest {
  const createdAt = new Date(at(input.now)).toISOString();
  const ttl = Math.min(input.ttlHours, MAX_SWAP_TTL_HOURS);
  return {
    id: input.id,
    fromSessionId: input.from.id,
    targetSessionId: input.target.id,
    snapshot: { from: snapshotOf(input.from), target: snapshotOf(input.target) },
    proposedAlt: input.proposedAlt ?? null,
    createdBy: input.createdBy,
    createdAt,
    expiresAt: new Date(at(createdAt) + ttl * HOUR).toISOString(),
    outcome: null,
  };
}

/** Only the slot holder may accept, and only while the proposal is live. */
export function canApplySwap(
  actorUid: string | null | undefined,
  swap: SwapRequest,
  sessions: Session[],
  allSwaps: SwapRequest[],
  now: string,
  resolve: Resolve = same,
  timezone = 'UTC',
): boolean {
  const target = sessions.find((s) => s.id === swap.targetSessionId);
  if (!actorUid || !target || resolve(actorUid) !== resolve(target.createdBy)) return false;
  return deriveSwapState(swap, allSwaps, sessions, now, resolve, timezone) === 'proposed';
}

export type SwapPlan =
  | { ok: true; updates: [Session, Session] }
  | { ok: false; reason: 'missing-session' | 'bad-alternative' | 'slot-taken'; blockedBy?: string[] };

const overlap = (a: Pick<Session, 'roomId' | 'startsAt' | 'endsAt'>, b: Pick<Session, 'roomId' | 'startsAt' | 'endsAt'>) =>
  a.roomId === b.roomId && at(a.startsAt) < at(b.endsAt) && at(b.startsAt) < at(a.endsAt);

/**
 * The two writes an accepted swap makes (owner decision 2026-09-25: accepting
 * moves both talks). The requester's talk takes the holder's slot; the
 * holder's talk moves to the offered alternative (complete, forward, on the
 * half-hour grid in the hub zone), or to the requester's old slot. Nothing is
 * moved if a third talk sits on either destination or the two moved talks
 * would overlap each other.
 */
export function planSwapApply(swap: SwapRequest, sessions: Session[], timezone: string): SwapPlan {
  const from = sessions.find((s) => s.id === swap.fromSessionId && !s.deleted);
  const target = sessions.find((s) => s.id === swap.targetSessionId && !s.deleted);
  if (!from || !target || from.id === target.id) return { ok: false, reason: 'missing-session' };

  const alt = swap.proposedAlt;
  if (alt != null && !isChoice(alt, timezone)) return { ok: false, reason: 'bad-alternative' };
  const destination = alt ?? { roomId: from.roomId, startsAt: from.startsAt, endsAt: from.endsAt };

  const movedFrom: Session = { ...from, roomId: target.roomId, startsAt: target.startsAt, endsAt: target.endsAt };
  const movedTarget: Session = { ...target, roomId: destination.roomId, startsAt: destination.startsAt, endsAt: destination.endsAt };

  const others = sessions.filter((s) => !s.deleted && s.id !== from.id && s.id !== target.id);
  const blockedBy = [...new Set(others.filter((o) => overlap(o, movedFrom) || overlap(o, movedTarget)).map((s) => s.id))].sort();
  if (blockedBy.length > 0) return { ok: false, reason: 'slot-taken', blockedBy };
  if (overlap(movedFrom, movedTarget)) return { ok: false, reason: 'slot-taken', blockedBy: [] };
  return { ok: true, updates: [movedFrom, movedTarget] };
}

export type SwapApply =
  | { ok: true; updates: [Session, Session]; outcome: { type: SwapOutcome; createdBy: string; createdAt: string } }
  | { ok: false; reason: 'not-allowed' | 'missing-session' | 'bad-alternative' | 'slot-taken'; blockedBy?: string[] };

/**
 * Accept and apply a swap: the single entry point a UI calls. Allowed only for
 * the slot holder on a live proposal; returns the two session writes (the one
 * sanctioned exception to "edit only your own") and the outcome to record.
 */
export function applySwap(
  actorUid: string | null | undefined,
  swap: SwapRequest,
  sessions: Session[],
  allSwaps: SwapRequest[],
  now: string,
  timezone: string,
  resolve: Resolve = same,
): SwapApply {
  if (!canApplySwap(actorUid, swap, sessions, allSwaps, now, resolve, timezone)) return { ok: false, reason: 'not-allowed' };
  const plan = planSwapApply(swap, sessions, timezone);
  if (!plan.ok) return plan;
  return {
    ok: true,
    updates: plan.updates,
    outcome: { type: 'accepted-apply', createdBy: actorUid!, createdAt: decisionTime(swap, now) },
  };
}

/** A decision's timestamp: now, but never before the proposal (clock skew). */
const decisionTime = (swap: SwapRequest, now: string) => new Date(Math.max(at(now), at(swap.createdAt))).toISOString();

export type SwapDecision =
  | { ok: true; outcome: { type: 'declined' | 'withdrawn'; createdBy: string; createdAt: string } }
  | { ok: false; reason: 'not-allowed' };

/**
 * Decline (the holder, while live) or withdraw (the requester, while live or
 * beaten): the guarded entry point for the non-accept outcomes. Returns the
 * outcome to record on the proposal.
 */
export function decideSwap(
  actorUid: string | null | undefined,
  type: 'declined' | 'withdrawn',
  swap: SwapRequest,
  sessions: Session[],
  allSwaps: SwapRequest[],
  now: string,
  resolve: Resolve = same,
  timezone = 'UTC',
): SwapDecision {
  if (!actorUid) return { ok: false, reason: 'not-allowed' };
  const decider = type === 'withdrawn' ? swap.snapshot?.from?.owner : swap.snapshot?.target?.owner;
  if (decider == null || resolve(actorUid) !== resolve(decider)) return { ok: false, reason: 'not-allowed' };
  const state = deriveSwapState(swap, allSwaps, sessions, now, resolve, timezone);
  const allowed = type === 'declined' ? state === 'proposed' : state === 'proposed' || state === 'auto-declined';
  if (!allowed) return { ok: false, reason: 'not-allowed' };
  return { ok: true, outcome: { type, createdBy: actorUid, createdAt: decisionTime(swap, now) } };
}

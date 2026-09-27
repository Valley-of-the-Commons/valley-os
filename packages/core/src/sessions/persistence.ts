// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Programme persistence: which public lens each entity lives in, how raw lens
// data (untrusted: anyone can write to a public lens) becomes typed records,
// and the write helpers UIs call. I/O itself goes through the UI's writer
// (`createHolonWriter` from `@holons/core/holosphere`) and its lens
// subscriptions; the logic here stays pure and store-free.

import type {
  AdminResolution,
  Break,
  Comment,
  Format,
  Room,
  Series,
  Session,
  Star,
  SwapRequest,
  Tag,
  Track,
} from './types.js';
import { isOnHalfHourGrid } from './grid.js';

export const PROGRAMME_LENSES = {
  sessions: 'sessions',
  rooms: 'session_rooms',
  tracks: 'session_tracks',
  formats: 'session_formats',
  tags: 'session_tags',
  breaks: 'session_breaks',
  stars: 'session_stars',
  comments: 'session_comments',
  swaps: 'session_swaps',
  series: 'session_series',
  resolutions: 'session_resolutions',
} as const;

export type ProgrammeLens = keyof typeof PROGRAMME_LENSES;

export interface Programme {
  sessions: Session[];
  rooms: Room[];
  tracks: Track[];
  formats: Format[];
  tags: Tag[];
  breaks: Break[];
  stars: Star[];
  comments: Comment[];
  swaps: SwapRequest[];
  series: Series[];
  resolutions: AdminResolution[];
}

/** The slice of a holon writer the helpers need (`HolonWriter` satisfies it). */
export interface LensWriter {
  put(lens: string, data: unknown): Promise<boolean>;
}

type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isInstant = (v: unknown): v is string => isStr(v) && !Number.isNaN(Date.parse(v));

/** Drop transport/provenance fields (`_holon`, `_federation`, ...). */
function clean(r: Rec): Rec {
  return Object.fromEntries(Object.entries(r).filter(([k]) => !k.startsWith('_')));
}

/**
 * A parser: required string fields, required instant fields (rewritten to one
 * canonical UTC form so they compare consistently), and an entity check.
 */
function parser<T>(required: string[], instants: string[] = [], check: (r: Rec) => boolean = () => true) {
  return (raw: unknown): T | null => {
    if (!isRec(raw) || raw._deleted) return null;
    if (!required.every((k) => isStr(raw[k])) || !instants.every((k) => isInstant(raw[k])) || !check(raw)) return null;
    const out = clean(raw);
    for (const k of instants) out[k] = new Date(Date.parse(raw[k] as string)).toISOString();
    return out as T;
  };
}

const OUTCOMES = new Set(['accepted-apply', 'declined', 'withdrawn']);
const isOutcome = (o: unknown) =>
  o == null || (isRec(o) && OUTCOMES.has(o.type as string) && isStr(o.createdBy) && isInstant(o.createdAt));
/** Series repeat every 1 to 52 weeks. */
const isInterval = (n: unknown) => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 52;
/** A real calendar date: `YYYY-MM-DD` that survives a round trip (no 2026-02-31). */
const isDate = (v: unknown) =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  !Number.isNaN(Date.parse(v)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const isStrList = (v: unknown) => v === undefined || v === null || (Array.isArray(v) && v.every(isStr));
const isOptBool = (v: unknown) => v === undefined || typeof v === 'boolean';
const canonicalInstant = (v: string) => new Date(Date.parse(v)).toISOString();
/** A slot record: roomId plus a forward pair of instants (and an owner, for snapshots). */
const isSlot = (v: unknown, withOwner: boolean) =>
  isRec(v) && isStr(v.roomId) && isInstant(v.startsAt) && isInstant(v.endsAt) &&
  Date.parse(v.endsAt as string) > Date.parse(v.startsAt as string) && (!withOwner || isStr(v.owner));
const isSnapshot = (v: unknown) => isRec(v) && isSlot(v.from, true) && isSlot(v.target, true);

/** A slot rewritten to its known fields with canonical instants. */
function slot<T extends { roomId: string; startsAt: string; endsAt: string }>(v: T, owner?: string) {
  const out: Record<string, string> = { roomId: v.roomId, startsAt: canonicalInstant(v.startsAt), endsAt: canonicalInstant(v.endsAt) };
  if (owner !== undefined) out.owner = owner;
  return out;
}

/** Canonicalise the instants nested in a swap and drop unknown nested fields. */
function withNested(parse: (raw: unknown) => SwapRequest | null) {
  return (raw: unknown): SwapRequest | null => {
    const swap = parse(raw);
    if (!swap) return null;
    return {
      ...swap,
      snapshot: {
        from: slot(swap.snapshot.from, swap.snapshot.from.owner),
        target: slot(swap.snapshot.target, swap.snapshot.target.owner),
      } as unknown as SwapRequest['snapshot'],
      proposedAlt: swap.proposedAlt ? (slot(swap.proposedAlt) as unknown as SwapRequest['proposedAlt']) : null,
      outcome: swap.outcome
        ? { type: swap.outcome.type, createdBy: swap.outcome.createdBy, createdAt: canonicalInstant(swap.outcome.createdAt) }
        : null,
    };
  };
}

/** Comments are plain text; older records still carry a note/link/question kind, dropped here. */
function withoutKind(parse: (raw: unknown) => Comment | null) {
  return (raw: unknown): Comment | null => {
    const c = parse(raw);
    if (!c) return null;
    const { kind: _kind, ...rest } = c as Comment & { kind?: unknown };
    return rest;
  };
}

const PARSERS: { [K in ProgrammeLens]: (raw: unknown) => Programme[K][number] | null } = {
  sessions: parser<Session>(['id', 'roomId', 'title', 'createdBy'], ['startsAt', 'endsAt', 'createdAt'], (r) =>
    (r.type === 'session' || r.type === 'keynote') &&
    Date.parse(r.endsAt as string) > Date.parse(r.startsAt as string) &&
    isOptBool(r.deleted) && isStrList(r.tags) && isStrList(r.speakers) && isStrList(r.livestreams)),
  rooms: parser<Room>(['id', 'name'], [], (r) => r.sortOrder === undefined || isNum(r.sortOrder)),
  tracks: parser<Track>(['id', 'name']),
  formats: parser<Format>(['id', 'name']),
  tags: parser<Tag>(['id', 'name']),
  breaks: parser<Break>(['id', 'label'], [], (r) => isNum(r.startMin) && isNum(r.endMin) && r.endMin > r.startMin),
  stars: parser<Star>(['id', 'sessionId', 'uid'], ['createdAt']),
  comments: withoutKind(parser<Comment>(['id', 'sessionId', 'body', 'createdBy'], ['createdAt'])),
  swaps: withNested(
    parser<SwapRequest>(['id', 'fromSessionId', 'targetSessionId', 'createdBy'], ['createdAt', 'expiresAt'], (r) =>
      isOutcome(r.outcome) && isSnapshot(r.snapshot) && (r.proposedAlt == null || isSlot(r.proposedAlt, false))),
  ),
  series: parser<Series>(['id'], [], (r) =>
    isRec(r.rule) && Array.isArray(r.rule.weekdays) && r.rule.weekdays.every((d) => Number.isInteger(d) && d >= 0 && d <= 6) &&
    isDate(r.rule.until) && isInterval(r.rule.intervalWeeks) &&
    (r.rule.exceptions === undefined || (Array.isArray(r.rule.exceptions) && r.rule.exceptions.every(isDate)))),
  resolutions: parser<AdminResolution>(['id', 'chosenSessionId', 'createdBy'], ['createdAt'], (r) =>
    Array.isArray(r.sessionIds) && r.sessionIds.every(isStr) && r.sessionIds.includes(r.chosenSessionId as string)),
};

/**
 * Typed programme from raw lens snapshots; malformed records are dropped.
 * With the hub `timezone`, live sessions off the half-hour grid are dropped too.
 */
export function buildProgramme(
  raw: Partial<Record<ProgrammeLens, unknown[]>>,
  opts: { timezone?: string } = {},
): Programme {
  const out = {} as Record<ProgrammeLens, unknown[]>;
  for (const lens of Object.keys(PROGRAMME_LENSES) as ProgrammeLens[]) {
    const parse = PARSERS[lens] as (raw: unknown) => unknown;
    out[lens] = (raw[lens] ?? []).map((r) => parse(r)).filter((r) => r !== null);
  }
  const programme = out as unknown as Programme;
  if (opts.timezone) {
    const tz = opts.timezone;
    // Deleted sessions stay, whatever their times, so swaps still see the deletion.
    programme.sessions = programme.sessions.filter((s) => s.deleted || isOnHalfHourGrid(s, tz));
  }
  return programme;
}

export const saveSession = (w: LensWriter, session: Session) => w.put(PROGRAMME_LENSES.sessions, session);

/** Soft delete: the record stays so swap and ownership rules see the deletion. */
export const deleteSession = (w: LensWriter, session: Session) =>
  w.put(PROGRAMME_LENSES.sessions, { ...session, deleted: true });

/**
 * One star per (session, person): the id is derived, so re-starring is
 * idempotent. Pass the canonical uid (`registry.resolve`). `:` never survives
 * `encodeURIComponent`, so the separator cannot collide.
 */
export function starId(sessionId: string, uid: string): string {
  return `star:${encodeURIComponent(sessionId)}:${encodeURIComponent(uid)}`;
}

export const starSession = (w: LensWriter, sessionId: string, uid: string, now: string) =>
  w.put(PROGRAMME_LENSES.stars, { id: starId(sessionId, uid), sessionId, uid, createdAt: now } satisfies Star);

export const unstarSession = (w: LensWriter, sessionId: string, uid: string) =>
  w.put(PROGRAMME_LENSES.stars, { id: starId(sessionId, uid), _deleted: true });

export const saveComment = (w: LensWriter, comment: Comment) => w.put(PROGRAMME_LENSES.comments, comment);

export const saveSwap = (w: LensWriter, swap: SwapRequest) => w.put(PROGRAMME_LENSES.swaps, swap);

export const saveResolution = (w: LensWriter, resolution: AdminResolution) =>
  w.put(PROGRAMME_LENSES.resolutions, resolution);

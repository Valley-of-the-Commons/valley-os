// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The programme's write actions (valley-os v2c). Each asks the core rule
// first (@holons/core/sessions), then writes through the holon writer; a
// refused action writes nothing. Dependencies are passed in so the actions
// are testable without a store or a relay.

import { addDays, toWallClock, wallClockToUtc } from "@holons/core/time";
import {
  PROGRAMME_LENSES,
  applySwap,
  buildSwapRequest,
  canEditSession,
  canPerform,
  canWriteSession,
  deleteSession as softDelete,
  expandSeries,
  saveComment,
  saveSession,
  saveSwap,
  sessionTimeErrors,
  starId,
  starSession,
  unstarSession,
  type CommentKind,
  type LensWriter,
  type Programme,
  type Room,
  type Session,
  type SessionTimeError,
  type SlotChoice,
  type SwapRequest,
  type WriteTier,
  decideSwap as decideSwapRule,
} from "@holons/core/sessions";

/** The admin-managed name lists, and the permission noun each uses. */
const NAMED = {
  rooms: "room",
  tracks: "track",
  formats: "format",
  tags: "tag",
} as const;
export type NamedKind = keyof typeof NAMED;

/** How long a swap request stays open (hours). */
export const SWAP_TTL_HOURS = 48;

export interface ActionContext {
  writer: LensWriter;
  /** The logged-in user's id as the kiosk knows it (bare Telegram id or key). */
  viewerUid: string | null;
  tier: WriteTier;
  /** The identity registry's resolve. */
  resolve: (id: string) => string;
  /** `settings.timezone`. */
  timezone: string;
  now: () => string;
  newId: () => string;
  programme: Programme;
}

export type ActionResult =
  | { ok: true; id?: string }
  | {
      ok: false;
      reason:
        | "not-allowed"
        | "times"
        | "invalid"
        | "slot-taken"
        | "write-failed"
        | "in-use";
      errors?: SessionTimeError[];
    };

export type SessionDraft = Pick<
  Session,
  "type" | "roomId" | "title" | "startsAt" | "endsAt"
> &
  Partial<
    Pick<
      Session,
      "description" | "trackId" | "formatId" | "tags" | "speakers" | "seriesId"
    >
  >;

const refused = (
  reason: "not-allowed" | "invalid" = "not-allowed",
): ActionResult => ({ ok: false, reason });
const written = (ok: boolean, id?: string): ActionResult =>
  ok ? { ok: true, id } : { ok: false, reason: "write-failed" };

export function programmeActions(ctx: ActionContext) {
  const me = ctx.viewerUid ? ctx.resolve(ctx.viewerUid) : null;
  const owns = (s: Session | undefined) =>
    Boolean(me && s && ctx.resolve(s.createdBy) === me);
  const session = (id: string) =>
    ctx.programme.sessions.find((s) => s.id === id);
  const timeCheck = (
    s: Pick<Session, "startsAt" | "endsAt">,
  ): ActionResult | null => {
    const errors = sessionTimeErrors(s, ctx.timezone);
    return errors.length ? { ok: false, reason: "times", errors } : null;
  };

  return {
    /**
     * Create a session, or with `repeatWeeklyUntil` (a hub-local date) a weekly
     * series: the series record plus one session per week on the same weekday
     * and wall-clock time, linked by `seriesId`. Nothing is written unless
     * every occurrence passes the rules.
     */
    async createSession(
      draft: SessionDraft,
      opts: { repeatWeeklyUntil?: string } = {},
    ): Promise<ActionResult> {
      if (!me) return refused();
      const until = opts.repeatWeeklyUntil;
      const seriesId = until ? ctx.newId() : undefined;
      const first: Session = {
        ...draft,
        ...(seriesId ? { seriesId } : {}),
        id: ctx.newId(),
        createdBy: me,
        createdAt: ctx.now(),
      };
      const bad = timeCheck(first);
      if (bad) return bad;
      if (!canWriteSession(ctx.tier, "create", first, me, ctx.resolve))
        return refused();
      if (!until || !seriesId)
        return written(await saveSession(ctx.writer, first), first.id);

      const start = toWallClock(Date.parse(first.startsAt), ctx.timezone);
      if (until < start.date) return refused("invalid");
      const rule = { weekdays: [start.weekday], intervalWeeks: 1, until };
      const windowEnd = new Date(
        wallClockToUtc(addDays(until, 1), 0, ctx.timezone),
      ).toISOString();
      const occurrences = expandSeries(
        rule,
        first,
        { start: first.startsAt, end: windowEnd },
        ctx.timezone,
      );
      const sessions = occurrences.map((o, i) =>
        i === 0 ? first : { ...first, ...o, id: ctx.newId() },
      );
      for (const s of sessions) {
        if (
          timeCheck(s) ||
          !canWriteSession(ctx.tier, "create", s, me, ctx.resolve)
        )
          return refused("invalid");
      }
      if (
        !(await ctx.writer.put(PROGRAMME_LENSES.series, { id: seriesId, rule }))
      )
        return written(false);
      for (const s of sessions) {
        if (!(await saveSession(ctx.writer, s))) return written(false);
      }
      return { ok: true, id: first.id };
    },

    async editSession(
      before: Session,
      patch: Partial<SessionDraft>,
    ): Promise<ActionResult> {
      const after: Session = { ...before, ...patch };
      const bad = timeCheck(after);
      if (bad) return bad;
      if (!canEditSession(ctx.tier, before, after, me, ctx.resolve))
        return refused();
      return written(await saveSession(ctx.writer, after), after.id);
    },

    async deleteSession(target: Session): Promise<ActionResult> {
      if (!canWriteSession(ctx.tier, "delete", target, me, ctx.resolve))
        return refused();
      return written(await softDelete(ctx.writer, target), target.id);
    },

    async toggleStar(sessionId: string): Promise<ActionResult> {
      if (!me || !canPerform(ctx.tier, "star")) return refused();
      const id = starId(sessionId, me);
      const starred = ctx.programme.stars.some((s) => s.id === id);
      return written(
        await (starred
          ? unstarSession(ctx.writer, sessionId, me)
          : starSession(ctx.writer, sessionId, me, ctx.now())),
      );
    },

    async addComment(
      sessionId: string,
      kind: CommentKind,
      body: string,
      url: string | null = null,
    ): Promise<ActionResult> {
      if (!me || !canPerform(ctx.tier, "comment")) return refused();
      const text = body.trim();
      if (!text) return refused("invalid");
      const id = ctx.newId();
      return written(
        await saveComment(ctx.writer, {
          id,
          sessionId,
          kind,
          body: text,
          url,
          createdBy: me,
          createdAt: ctx.now(),
        }),
        id,
      );
    },

    async requestSwap(
      fromSessionId: string,
      targetSessionId: string,
      proposedAlt: SlotChoice | null,
    ): Promise<ActionResult> {
      const from = session(fromSessionId);
      const target = session(targetSessionId);
      if (
        !me ||
        ctx.tier === "logged-out" ||
        !from ||
        !target ||
        !owns(from) ||
        owns(target)
      )
        return refused();
      if (proposedAlt) {
        const bad = timeCheck(proposedAlt);
        if (bad) return bad;
      }
      const swap = buildSwapRequest({
        id: ctx.newId(),
        from,
        target,
        proposedAlt,
        createdBy: me,
        now: ctx.now(),
        ttlHours: SWAP_TTL_HOURS,
      });
      return written(await saveSwap(ctx.writer, swap), swap.id);
    },

    async acceptSwap(swap: SwapRequest): Promise<ActionResult> {
      const p = ctx.programme;
      const result = applySwap(
        me,
        swap,
        p.sessions,
        p.swaps,
        ctx.now(),
        ctx.timezone,
        ctx.resolve,
      );
      if (!result.ok)
        return result.reason === "slot-taken"
          ? { ok: false, reason: "slot-taken" }
          : refused();
      for (const moved of result.updates) {
        if (!(await ctx.writer.put(PROGRAMME_LENSES.sessions, moved)))
          return written(false);
      }
      return written(
        await saveSwap(ctx.writer, { ...swap, outcome: result.outcome }),
        swap.id,
      );
    },

    async decideSwap(
      swap: SwapRequest,
      type: "declined" | "withdrawn",
    ): Promise<ActionResult> {
      const p = ctx.programme;
      const decision = decideSwapRule(
        me,
        type,
        swap,
        p.sessions,
        p.swaps,
        ctx.now(),
        ctx.resolve,
        ctx.timezone,
      );
      if (!decision.ok) return refused();
      return written(
        await saveSwap(ctx.writer, { ...swap, outcome: decision.outcome }),
        swap.id,
      );
    },

    /** Remove a room, track, format or tag (admin only). A room live sessions use stays. */
    async deleteNamed(kind: NamedKind, id: string): Promise<ActionResult> {
      if (!canPerform(ctx.tier, `edit-${NAMED[kind]}`)) return refused();
      if (
        kind === "rooms" &&
        ctx.programme.sessions.some((x) => !x.deleted && x.roomId === id)
      )
        return { ok: false, reason: "in-use" };
      return written(
        await ctx.writer.put(PROGRAMME_LENSES[kind], { id, _deleted: true }),
        id,
      );
    },

    /** Move a room, track or format one place up (-1) or down (+1) (admin only). */
    async moveNamed(
      kind: Exclude<NamedKind, "tags">,
      id: string,
      step: -1 | 1,
    ): Promise<ActionResult> {
      if (!canPerform(ctx.tier, `edit-${NAMED[kind]}`)) return refused();
      const list = [
        ...(ctx.programme[kind] as Array<{
          id: string;
          name: string;
          sortOrder: number;
        }>),
      ].sort(
        (a, b) =>
          (a.sortOrder ?? 0) - (b.sortOrder ?? 0) ||
          a.name.localeCompare(b.name),
      );
      const i = list.findIndex((x) => x.id === id);
      const j = i + step;
      if (i < 0 || j < 0 || j >= list.length) return refused("invalid");
      // Renumber the whole list so ties can never stall a move, then swap.
      const ordered = list.map((x, k) => ({ ...x, sortOrder: k }));
      [ordered[i].sortOrder, ordered[j].sortOrder] = [j, i];
      for (const x of [ordered[i], ordered[j]]) {
        if (!(await ctx.writer.put(PROGRAMME_LENSES[kind], x)))
          return written(false);
      }
      return { ok: true, id };
    },

    /** Add or rename a room, track, format or tag (admin only). */
    async saveNamed(
      kind: NamedKind,
      input: { id?: string; name: string },
    ): Promise<ActionResult> {
      const list = ctx.programme[kind] as Array<{
        id: string;
        name: string;
        sortOrder?: number;
      }>;
      const existing = input.id
        ? list.find((r) => r.id === input.id)
        : undefined;
      const singular = NAMED[kind];
      if (
        !canPerform(
          ctx.tier,
          existing ? `edit-${singular}` : `create-${singular}`,
        )
      )
        return refused();
      const name = input.name.trim();
      if (!name) return refused("invalid");
      const ordered = kind !== "tags";
      const nextOrder = Math.max(-1, ...list.map((r) => r.sortOrder ?? 0)) + 1;
      const record = existing
        ? { ...existing, name }
        : {
            id: ctx.newId(),
            name,
            ...(ordered ? { sortOrder: nextOrder } : {}),
          };
      return written(
        await ctx.writer.put(PROGRAMME_LENSES[kind], record),
        record.id,
      );
    },
  };
}

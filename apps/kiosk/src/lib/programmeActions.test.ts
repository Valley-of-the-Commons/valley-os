// SPDX-License-Identifier: AGPL-3.0-or-later
//
// valley-os v2c: the programme's write actions. Each checks the core rule,
// then writes through the holon writer; nothing is written when a rule says no.

import { describe, expect, it } from "vitest";
import {
  PROGRAMME_LENSES,
  buildSwapRequest,
  starId,
  type Programme,
  type Session,
} from "@holons/core/sessions";
import { programmeActions, type ActionContext } from "./programmeActions";

function fakeWriter() {
  const puts: Array<{ lens: string; data: Record<string, unknown> }> = [];
  return {
    puts,
    writer: {
      put: async (lens: string, data: unknown) => (
        puts.push({ lens, data: data as Record<string, unknown> }),
        true
      ),
    },
  };
}
const empty: Programme = {
  sessions: [],
  rooms: [],
  tracks: [],
  formats: [],
  tags: [],
  breaks: [],
  stars: [],
  comments: [],
  swaps: [],
  series: [],
  resolutions: [],
};
const NOW = "2026-09-25T10:00:00.000Z";
function ctx(
  extra: Partial<ActionContext> = {},
): ActionContext & { puts: ReturnType<typeof fakeWriter>["puts"] } {
  const f = fakeWriter();
  return {
    writer: f.writer,
    puts: f.puts,
    viewerUid: "5",
    tier: "logged-in",
    resolve: (id) => (/^\d+$/.test(id) ? `telegram:${id}` : id),
    timezone: "UTC",
    now: () => NOW,
    newId: () => "new-id",
    programme: empty,
    ...extra,
  };
}
const draft = {
  type: "session" as const,
  roomId: "hall",
  title: "Soil",
  startsAt: "2026-09-30T10:00:00.000Z",
  endsAt: "2026-09-30T11:00:00.000Z",
};

describe("createSession", () => {
  it("writes a session in the viewer's canonical name", async () => {
    const c = ctx();
    expect(await programmeActions(c).createSession(draft)).toEqual({
      ok: true,
      id: "new-id",
    });
    expect(c.puts).toEqual([
      {
        lens: PROGRAMME_LENSES.sessions,
        data: {
          ...draft,
          id: "new-id",
          createdBy: "telegram:5",
          createdAt: NOW,
        },
      },
    ]);
  });

  it("refuses off-grid times and writes nothing", async () => {
    const c = ctx();
    const r = await programmeActions(c).createSession({
      ...draft,
      startsAt: "2026-09-30T10:15:00.000Z",
    });
    expect(r).toEqual({
      ok: false,
      reason: "times",
      errors: ["start-off-grid"],
    });
    expect(c.puts).toEqual([]);
  });

  it("refuses a keynote from a resident, allows it from the admin", async () => {
    const resident = ctx();
    expect(
      (
        await programmeActions(resident).createSession({
          ...draft,
          type: "keynote",
        })
      ).ok,
    ).toBe(false);
    expect(resident.puts).toEqual([]);
    const admin = ctx({ tier: "admin", viewerUid: "99" });
    expect(
      (
        await programmeActions(admin).createSession({
          ...draft,
          type: "keynote",
        })
      ).ok,
    ).toBe(true);
  });

  it("refuses when logged out", async () => {
    const c = ctx({ tier: "logged-out", viewerUid: null });
    expect((await programmeActions(c).createSession(draft)).ok).toBe(false);
    expect(c.puts).toEqual([]);
  });
});

describe("createSession with a weekly repeat", () => {
  it("writes the series and one session per week until the end date, all linked", async () => {
    const ids = ["series-1", "s-a", "s-b", "s-c"];
    const c = ctx({ newId: () => ids.shift()! });
    const r = await programmeActions(c).createSession(draft, {
      repeatWeeklyUntil: "2026-10-14",
    });
    expect(r).toEqual({ ok: true, id: "s-a" });
    expect(
      c.puts.map((p) => [
        p.lens,
        p.data.id,
        p.data.startsAt ?? null,
        p.data.seriesId ?? null,
      ]),
    ).toEqual([
      [PROGRAMME_LENSES.series, "series-1", null, null],
      [
        PROGRAMME_LENSES.sessions,
        "s-a",
        "2026-09-30T10:00:00.000Z",
        "series-1",
      ],
      [
        PROGRAMME_LENSES.sessions,
        "s-b",
        "2026-10-07T10:00:00.000Z",
        "series-1",
      ],
      [
        PROGRAMME_LENSES.sessions,
        "s-c",
        "2026-10-14T10:00:00.000Z",
        "series-1",
      ],
    ]);
    expect(c.puts[0].data).toEqual({
      id: "series-1",
      rule: { weekdays: [3], intervalWeeks: 1, until: "2026-10-14" },
    });
  });

  it("an end date before the first session is refused", async () => {
    const c = ctx();
    expect(
      (
        await programmeActions(c).createSession(draft, {
          repeatWeeklyUntil: "2026-09-01",
        })
      ).ok,
    ).toBe(false);
    expect(c.puts).toEqual([]);
  });
});

describe("editSession and deleteSession", () => {
  const mine: Session = {
    ...draft,
    id: "s1",
    createdBy: "telegram:5",
    createdAt: NOW,
  };
  const theirs: Session = { ...mine, id: "s2", createdBy: "telegram:6" };

  it("edits my own session, keeping owner and type", async () => {
    const c = ctx();
    expect(
      (await programmeActions(c).editSession(mine, { title: "Soil 2" })).ok,
    ).toBe(true);
    expect(c.puts[0].data).toMatchObject({
      id: "s1",
      title: "Soil 2",
      createdBy: "telegram:5",
      type: "session",
    });
  });

  it("refuses editing someone else's session unless admin", async () => {
    const c = ctx();
    expect(
      (await programmeActions(c).editSession(theirs, { title: "x" })).ok,
    ).toBe(false);
    expect(
      (
        await programmeActions(
          ctx({ tier: "admin", viewerUid: "99" }),
        ).editSession(theirs, { title: "x" })
      ).ok,
    ).toBe(true);
  });

  it("soft-deletes my own session", async () => {
    const c = ctx();
    expect((await programmeActions(c).deleteSession(mine)).ok).toBe(true);
    expect(c.puts[0].data).toMatchObject({ id: "s1", deleted: true });
  });
});

describe("stars and comments", () => {
  it("toggles one star per person under the canonical uid", async () => {
    const c = ctx();
    await programmeActions(c).toggleStar("s1");
    expect(c.puts[0]).toMatchObject({
      lens: PROGRAMME_LENSES.stars,
      data: { id: starId("s1", "telegram:5"), uid: "telegram:5" },
    });
    const starred = ctx({
      programme: {
        ...empty,
        stars: [
          {
            id: starId("s1", "telegram:5"),
            sessionId: "s1",
            uid: "telegram:5",
            createdAt: NOW,
          },
        ],
      },
    });
    await programmeActions(starred).toggleStar("s1");
    expect(starred.puts[0].data).toEqual({
      id: starId("s1", "telegram:5"),
      _deleted: true,
    });
  });

  it("adds a public comment; a blank one is refused", async () => {
    const c = ctx();
    expect((await programmeActions(c).addComment("s1", "note", "  ")).ok).toBe(
      false,
    );
    expect(
      (await programmeActions(c).addComment("s1", "question", "Bring shoes?"))
        .ok,
    ).toBe(true);
    expect(c.puts).toEqual([
      {
        lens: PROGRAMME_LENSES.comments,
        data: {
          id: "new-id",
          sessionId: "s1",
          kind: "question",
          body: "Bring shoes?",
          url: null,
          createdBy: "telegram:5",
          createdAt: NOW,
        },
      },
    ]);
  });

  it("logged out cannot star or comment", async () => {
    const c = ctx({ tier: "logged-out", viewerUid: null });
    expect((await programmeActions(c).toggleStar("s1")).ok).toBe(false);
    expect((await programmeActions(c).addComment("s1", "note", "hi")).ok).toBe(
      false,
    );
    expect(c.puts).toEqual([]);
  });
});

describe("swaps", () => {
  const alice: Session = {
    ...draft,
    id: "alice",
    createdBy: "telegram:7",
    createdAt: NOW,
  };
  const bob: Session = {
    ...draft,
    id: "bob",
    roomId: "garden",
    startsAt: "2026-09-30T14:00:00.000Z",
    endsAt: "2026-09-30T15:00:00.000Z",
    createdBy: "telegram:5",
    createdAt: NOW,
  };
  const programme = { ...empty, sessions: [alice, bob] };
  const proposal = () =>
    buildSwapRequest({
      id: "sw",
      from: bob,
      target: alice,
      createdBy: "telegram:5",
      now: NOW,
      ttlHours: 48,
    });

  it("requests a swap from my own session, snapshotting both talks, expiring after the TTL", async () => {
    const c = ctx({ programme });
    expect(
      (await programmeActions(c).requestSwap("bob", "alice", null)).ok,
    ).toBe(true);
    expect(c.puts[0]).toEqual({
      lens: PROGRAMME_LENSES.swaps,
      data: buildSwapRequest({
        id: "new-id",
        from: bob,
        target: alice,
        createdBy: "telegram:5",
        now: NOW,
        ttlHours: 48,
      }),
    });
    expect(c.puts[0].data.expiresAt).toBe("2026-09-27T10:00:00.000Z");
  });

  it("cannot request a swap from someone else's session", async () => {
    const c = ctx({ programme, viewerUid: "8" });
    expect(
      (await programmeActions(c).requestSwap("bob", "alice", null)).ok,
    ).toBe(false);
    expect(c.puts).toEqual([]);
  });

  it("the holder's accept writes both moved sessions, then the outcome", async () => {
    const swap = proposal();
    const c = ctx({
      programme: { ...programme, swaps: [swap] },
      viewerUid: "7",
    });
    expect((await programmeActions(c).acceptSwap(swap)).ok).toBe(true);
    expect(c.puts.map((p) => [p.lens, p.data.id])).toEqual([
      [PROGRAMME_LENSES.sessions, "bob"],
      [PROGRAMME_LENSES.sessions, "alice"],
      [PROGRAMME_LENSES.swaps, "sw"],
    ]);
    expect(c.puts[2].data.outcome).toEqual({
      type: "accepted-apply",
      createdBy: "telegram:7",
      createdAt: NOW,
    });
  });

  it("the requester cannot accept their own proposal", async () => {
    const swap = proposal();
    const c = ctx({ programme: { ...programme, swaps: [swap] } });
    expect((await programmeActions(c).acceptSwap(swap)).ok).toBe(false);
    expect(c.puts).toEqual([]);
  });

  it("decline is the holder's, withdraw the requester's", async () => {
    const swap = proposal();
    const holder = ctx({
      programme: { ...programme, swaps: [swap] },
      viewerUid: "7",
    });
    expect(
      (await programmeActions(holder).decideSwap(swap, "declined")).ok,
    ).toBe(true);
    expect(
      (await programmeActions(holder).decideSwap(swap, "withdrawn")).ok,
    ).toBe(false);
    const requester = ctx({ programme: { ...programme, swaps: [swap] } });
    expect(
      (await programmeActions(requester).decideSwap(swap, "withdrawn")).ok,
    ).toBe(true);
    expect(
      (await programmeActions(requester).decideSwap(swap, "declined")).ok,
    ).toBe(false);
  });
});

describe("rooms (admin only)", () => {
  it("the admin adds a room at the end of the order", async () => {
    const c = ctx({
      tier: "admin",
      viewerUid: "99",
      programme: {
        ...empty,
        rooms: [{ id: "r1", name: "Hall", sortOrder: 0 }],
      },
    });
    expect(
      (await programmeActions(c).saveNamed("rooms", { name: "Garden" })).ok,
    ).toBe(true);
    expect(c.puts[0]).toEqual({
      lens: PROGRAMME_LENSES.rooms,
      data: { id: "new-id", name: "Garden", sortOrder: 1 },
    });
  });

  it("the admin renames a room; a blank name is refused", async () => {
    const c = ctx({
      tier: "admin",
      viewerUid: "99",
      programme: {
        ...empty,
        rooms: [{ id: "r1", name: "Hall", sortOrder: 0 }],
      },
    });
    expect(
      (await programmeActions(c).saveNamed("rooms", { id: "r1", name: "  " }))
        .ok,
    ).toBe(false);
    expect(
      (
        await programmeActions(c).saveNamed("rooms", {
          id: "r1",
          name: "Great hall",
        })
      ).ok,
    ).toBe(true);
    expect(c.puts[0].data).toEqual({
      id: "r1",
      name: "Great hall",
      sortOrder: 0,
    });
  });

  it("residents cannot manage rooms", async () => {
    const c = ctx();
    expect(
      (await programmeActions(c).saveNamed("rooms", { name: "Garden" })).ok,
    ).toBe(false);
    expect(c.puts).toEqual([]);
  });
});

describe("tracks, formats and tags (admin only)", () => {
  const admin = () =>
    ctx({
      tier: "admin",
      viewerUid: "99",
      programme: {
        ...empty,
        tracks: [{ id: "t1", name: "Soil", sortOrder: 0 }],
      },
    });

  it("the admin adds a track at the end of the order, a format, and a tag (tags have no order)", async () => {
    const c = admin();
    expect(
      (await programmeActions(c).saveNamed("tracks", { name: "Water" })).ok,
    ).toBe(true);
    expect(
      (await programmeActions(c).saveNamed("formats", { name: "Workshop" })).ok,
    ).toBe(true);
    expect(
      (await programmeActions(c).saveNamed("tags", { name: "kids" })).ok,
    ).toBe(true);
    expect(c.puts).toEqual([
      {
        lens: PROGRAMME_LENSES.tracks,
        data: { id: "new-id", name: "Water", sortOrder: 1 },
      },
      {
        lens: PROGRAMME_LENSES.formats,
        data: { id: "new-id", name: "Workshop", sortOrder: 0 },
      },
      { lens: PROGRAMME_LENSES.tags, data: { id: "new-id", name: "kids" } },
    ]);
  });

  it("renames keep the id and order", async () => {
    const c = admin();
    expect(
      (
        await programmeActions(c).saveNamed("tracks", {
          id: "t1",
          name: "Soil & compost",
        })
      ).ok,
    ).toBe(true);
    expect(c.puts[0].data).toEqual({
      id: "t1",
      name: "Soil & compost",
      sortOrder: 0,
    });
  });

  it("residents cannot manage them", async () => {
    const c = ctx();
    for (const kind of ["tracks", "formats", "tags"] as const) {
      expect(
        (await programmeActions(c).saveNamed(kind, { name: "x" })).ok,
      ).toBe(false);
    }
    expect(c.puts).toEqual([]);
  });
});

describe("deleting and reordering named lists (admin only)", () => {
  const rooms = [
    { id: "r1", name: "Hall", sortOrder: 0 },
    { id: "r2", name: "Garden", sortOrder: 1 },
    { id: "r3", name: "Lab", sortOrder: 2 },
  ];
  const inHall: Session = {
    ...draft,
    id: "s1",
    roomId: "r1",
    createdBy: "telegram:5",
    createdAt: NOW,
  };
  const admin = (extra: Partial<Programme> = {}) =>
    ctx({
      tier: "admin",
      viewerUid: "99",
      programme: { ...empty, rooms, ...extra },
    });

  it("deletes an unused room with a tombstone", async () => {
    const c = admin();
    expect((await programmeActions(c).deleteNamed("rooms", "r2")).ok).toBe(
      true,
    );
    expect(c.puts).toEqual([
      { lens: PROGRAMME_LENSES.rooms, data: { id: "r2", _deleted: true } },
    ]);
  });

  it("refuses to delete a room that live sessions use; a deleted session does not count", async () => {
    const busy = admin({ sessions: [inHall] });
    expect(await programmeActions(busy).deleteNamed("rooms", "r1")).toEqual({
      ok: false,
      reason: "in-use",
    });
    expect(busy.puts).toEqual([]);
    const freed = admin({ sessions: [{ ...inHall, deleted: true }] });
    expect((await programmeActions(freed).deleteNamed("rooms", "r1")).ok).toBe(
      true,
    );
  });

  it("deletes tracks, formats and tags freely", async () => {
    const c = ctx({
      tier: "admin",
      viewerUid: "99",
      programme: { ...empty, tags: [{ id: "g1", name: "kids" }] },
    });
    expect((await programmeActions(c).deleteNamed("tags", "g1")).ok).toBe(true);
  });

  it("moves an item up or down by swapping order with its neighbour", async () => {
    const c = admin();
    expect((await programmeActions(c).moveNamed("rooms", "r2", -1)).ok).toBe(
      true,
    );
    expect(c.puts.map((p) => p.data)).toEqual([
      { id: "r2", name: "Garden", sortOrder: 0 },
      { id: "r1", name: "Hall", sortOrder: 1 },
    ]);
    const edge = admin();
    expect((await programmeActions(edge).moveNamed("rooms", "r1", -1)).ok).toBe(
      false,
    );
    expect(edge.puts).toEqual([]);
  });

  it("residents can do neither", async () => {
    const c = ctx({ programme: { ...empty, rooms } });
    expect((await programmeActions(c).deleteNamed("rooms", "r2")).ok).toBe(
      false,
    );
    expect((await programmeActions(c).moveNamed("rooms", "r2", -1)).ok).toBe(
      false,
    );
    expect(c.puts).toEqual([]);
  });
});

// SPDX-License-Identifier: AGPL-3.0-or-later
//
// valley-os v2c: the programme grid's view model (AC-c2, AC-c3, AC-c9).

import { describe, expect, it } from "vitest";
import {
  computeOwnership,
  type Room,
  type Session,
} from "@holons/core/sessions";
import {
  assignLanes,
  buildGrid,
  type GridInput,
  type ShiftItem,
} from "./programmeGrid";

const TZ = "Europe/Rome"; // UTC+2 in September
const rooms: Room[] = [
  { id: "hall", name: "Main hall", sortOrder: 1 },
  { id: "garden", name: "Garden", sortOrder: 0 },
];
function session(
  id: string,
  roomId: string,
  startsAt: string,
  endsAt: string,
  extra: Partial<Session> = {},
): Session {
  return {
    id,
    type: "session",
    roomId,
    title: id,
    startsAt,
    endsAt,
    createdBy: "telegram:1",
    createdAt: "2026-09-01T00:00:00.000Z",
    ...extra,
  };
}
const shift = (
  id: string,
  start: string,
  end: string,
  extra: Partial<ShiftItem> = {},
): ShiftItem => ({
  id,
  title: id,
  start: Date.parse(start),
  end: Date.parse(end),
  mine: false,
  full: false,
  taken: 0,
  ...extra,
});

function input(extra: Partial<GridInput> = {}): GridInput {
  const sessions = extra.sessions ?? [];
  return {
    view: "day",
    date: "2026-09-30",
    timezone: TZ,
    sessions,
    rooms,
    clusters: computeOwnership(sessions, [], () => false).clusters,
    starCounts: new Map(),
    myStars: new Set(),
    viewerUid: null,
    resolve: (id) => id,
    shifts: [],
    layers: { keynotes: true, sessions: true, shifts: true },
    breaks: [],
    ...extra,
  };
}

describe("assignLanes", () => {
  const item = (id: string, start: number, end: number) => ({ id, start, end });
  it("gives non-overlapping items one lane", () => {
    const l = assignLanes([item("a", 0, 60), item("b", 60, 120)]);
    expect(l.get("a")).toEqual({ lane: 0, lanes: 1 });
    expect(l.get("b")).toEqual({ lane: 0, lanes: 1 });
  });
  it("splits a chain into two lanes, reusing a freed lane", () => {
    const l = assignLanes([
      item("a", 0, 60),
      item("b", 30, 90),
      item("c", 60, 120),
    ]);
    expect(l.get("a")).toEqual({ lane: 0, lanes: 2 });
    expect(l.get("b")).toEqual({ lane: 1, lanes: 2 });
    expect(l.get("c")).toEqual({ lane: 0, lanes: 2 });
  });
  it("gives three mutually overlapping items three lanes, in a stable order", () => {
    const l = assignLanes([
      item("c", 0, 60),
      item("a", 0, 60),
      item("b", 0, 60),
    ]);
    expect([l.get("a")!.lane, l.get("b")!.lane, l.get("c")!.lane]).toEqual([
      0, 1, 2,
    ]);
    expect(l.get("a")!.lanes).toBe(3);
  });
});

describe("buildGrid: Day view", () => {
  it("has one column per room in sort order, then the shifts column", () => {
    const g = buildGrid(input());
    expect(g.columns.map((c) => c.key)).toEqual([
      "room:garden",
      "room:hall",
      "shifts",
    ]);
  });

  it("places a session in its room at hub-local minutes", () => {
    const s = session(
      "talk",
      "hall",
      "2026-09-30T08:00:00.000Z",
      "2026-09-30T09:30:00.000Z",
    ); // 10:00-11:30 Rome
    const card = buildGrid(input({ sessions: [s] })).cards.find(
      (c) => c.id === "talk",
    )!;
    expect(card).toMatchObject({
      column: "room:hall",
      startMin: 600,
      endMin: 690,
      lane: 0,
      lanes: 1,
      kind: "session",
    });
  });

  it("shows only sessions on that hub-local day, and never deleted ones", () => {
    const today = session(
      "today",
      "hall",
      "2026-09-29T22:30:00.000Z",
      "2026-09-29T23:30:00.000Z",
    ); // 00:30 on the 30th in Rome
    const yesterday = session(
      "yesterday",
      "hall",
      "2026-09-29T20:00:00.000Z",
      "2026-09-29T21:00:00.000Z",
    );
    const gone = session(
      "gone",
      "hall",
      "2026-09-30T08:00:00.000Z",
      "2026-09-30T09:00:00.000Z",
      { deleted: true },
    );
    expect(
      buildGrid(input({ sessions: [today, yesterday, gone] })).cards.map(
        (c) => c.id,
      ),
    ).toEqual(["today"]);
  });

  it("splits overlapping sessions in one room into sub-columns and flags the clash", () => {
    const a = session(
      "a",
      "hall",
      "2026-09-30T08:00:00.000Z",
      "2026-09-30T09:00:00.000Z",
    );
    const b = session(
      "b",
      "hall",
      "2026-09-30T08:30:00.000Z",
      "2026-09-30T09:30:00.000Z",
    );
    const cards = buildGrid(input({ sessions: [a, b] })).cards;
    expect(cards.map((c) => [c.id, c.lane, c.lanes, c.contested])).toEqual([
      ["a", 0, 2, true],
      ["b", 1, 2, true],
    ]);
  });

  it("puts shift cards in the shifts column with their states", () => {
    const g = buildGrid(
      input({
        shifts: [
          shift(
            "kitchen",
            "2026-09-30T06:00:00.000Z",
            "2026-09-30T08:00:00.000Z",
            { mine: true, full: true, taken: 3 },
          ),
        ],
      }),
    );
    expect(g.cards[0]).toMatchObject({
      kind: "shift",
      column: "shifts",
      startMin: 480,
      endMin: 600,
      mine: true,
      full: true,
      taken: 3,
    });
  });

  it("widens the visible hours to fit early and late cards", () => {
    const early = session(
      "early",
      "hall",
      "2026-09-30T04:00:00.000Z",
      "2026-09-30T05:00:00.000Z",
    ); // 06:00 Rome
    const late = session(
      "late",
      "hall",
      "2026-09-30T21:00:00.000Z",
      "2026-09-30T21:30:00.000Z",
    ); // 23:00-23:30
    const g = buildGrid(input({ sessions: [early, late] }));
    expect([g.startMin, g.endMin]).toEqual([360, 1440]);
    expect([buildGrid(input()).startMin, buildGrid(input()).endMin]).toEqual([
      480, 1320,
    ]);
  });
});

describe("buildGrid: Week view", () => {
  it("has seven day columns, Monday to Sunday, around the date", () => {
    const g = buildGrid(input({ view: "week" }));
    expect(g.columns.map((c) => c.date)).toEqual([
      "2026-09-28",
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
    ]);
  });

  it("places sessions by day and splits same-day overlaps across rooms", () => {
    const a = session(
      "a",
      "hall",
      "2026-09-30T08:00:00.000Z",
      "2026-09-30T09:00:00.000Z",
    );
    const b = session(
      "b",
      "garden",
      "2026-09-30T08:30:00.000Z",
      "2026-09-30T09:30:00.000Z",
    );
    const cards = buildGrid(input({ view: "week", sessions: [a, b] })).cards;
    expect(
      cards.map((c) => [c.id, c.column, c.lane, c.lanes, c.contested]),
    ).toEqual([
      ["a", "day:2026-09-30", 0, 2, false],
      ["b", "day:2026-09-30", 1, 2, false],
    ]);
    expect(cards[0].roomName).toBe("Main hall");
  });
});

describe("layers, flags and star emphasis", () => {
  const talk = session(
    "talk",
    "hall",
    "2026-09-30T08:00:00.000Z",
    "2026-09-30T09:00:00.000Z",
    { createdBy: "telegram:5" },
  );
  const keynote = session(
    "key",
    "garden",
    "2026-09-30T08:00:00.000Z",
    "2026-09-30T09:00:00.000Z",
    { type: "keynote" },
  );
  const kitchen = shift(
    "kitchen",
    "2026-09-30T10:00:00.000Z",
    "2026-09-30T11:00:00.000Z",
  );

  it("each layer toggle hides its cards (and the shifts column)", () => {
    const all = { sessions: [talk, keynote], shifts: [kitchen] };
    const ids = (layers: GridInput["layers"]) =>
      buildGrid(input({ ...all, layers }))
        .cards.map((c) => c.id)
        .sort();
    expect(ids({ keynotes: true, sessions: true, shifts: true })).toEqual([
      "key",
      "kitchen",
      "talk",
    ]);
    expect(ids({ keynotes: false, sessions: true, shifts: true })).toEqual([
      "kitchen",
      "talk",
    ]);
    expect(ids({ keynotes: true, sessions: false, shifts: true })).toEqual([
      "key",
      "kitchen",
    ]);
    expect(ids({ keynotes: true, sessions: true, shifts: false })).toEqual([
      "key",
      "talk",
    ]);
    expect(
      buildGrid(
        input({
          ...all,
          layers: { keynotes: true, sessions: true, shifts: false },
        }),
      ).columns.map((c) => c.key),
    ).not.toContain("shifts");
  });

  it("marks mine through the registry and my stars", () => {
    const resolve = (id: string) => (id === "5" ? "telegram:5" : id);
    const card = buildGrid(
      input({
        sessions: [talk],
        viewerUid: "5",
        resolve,
        myStars: new Set(["talk"]),
      }),
    ).cards[0];
    expect(card).toMatchObject({ mine: true, starred: true });
  });

  it("emphasises a session at or above the star threshold without moving it", () => {
    const plain = buildGrid(input({ sessions: [talk] })).cards[0];
    const starred = buildGrid(
      input({ sessions: [talk], starCounts: new Map([["talk", 3]]) }),
    ).cards[0];
    expect(plain.emphasised).toBe(false);
    expect(starred).toMatchObject({ emphasised: true, stars: 3 });
    const geometry = (c: typeof plain) => [
      c.column,
      c.startMin,
      c.endMin,
      c.lane,
      c.lanes,
    ];
    expect(geometry(starred)).toEqual(geometry(plain));
    expect(
      buildGrid(
        input({
          sessions: [talk],
          starCounts: new Map([["talk", 2]]),
          emphasisThreshold: 2,
        }),
      ).cards[0].emphasised,
    ).toBe(true);
  });
});

describe("the all-day banner row (AC-c8)", () => {
  const lunch = {
    id: "lunch",
    label: "Lunch",
    startMin: 13 * 60,
    endMin: 14 * 60,
  };
  const openDay = {
    id: "open",
    label: "Open day",
    startMin: 10 * 60,
    endMin: 18 * 60,
    date: "2026-09-30",
  };

  it("lists each day's breaks: undated ones every day, dated ones on their day", () => {
    const day = buildGrid(input({ breaks: [lunch, openDay] }));
    expect(day.banners.map((b) => [b.date, b.label])).toEqual([
      ["2026-09-30", "Open day"],
      ["2026-09-30", "Lunch"],
    ]);
    const week = buildGrid(input({ view: "week", breaks: [lunch, openDay] }));
    expect(week.banners.filter((b) => b.label === "Lunch")).toHaveLength(7);
    expect(
      week.banners.filter((b) => b.label === "Open day").map((b) => b.date),
    ).toEqual(["2026-09-30"]);
  });

  it("is empty when there are no breaks", () => {
    expect(buildGrid(input()).banners).toEqual([]);
  });
});

describe("the Mine view", () => {
  const mineTalk = session(
    "mine",
    "hall",
    "2026-09-30T08:00:00.000Z",
    "2026-09-30T09:00:00.000Z",
    { createdBy: "telegram:5" },
  );
  const starredTalk = session(
    "starred",
    "garden",
    "2026-09-30T08:00:00.000Z",
    "2026-09-30T09:00:00.000Z",
  );
  const otherTalk = session(
    "other",
    "garden",
    "2026-09-30T10:00:00.000Z",
    "2026-09-30T11:00:00.000Z",
  );
  const myShift = shift(
    "my-shift",
    "2026-09-30T12:00:00.000Z",
    "2026-09-30T13:00:00.000Z",
    { mine: true },
  );
  const openShift = shift(
    "open-shift",
    "2026-09-30T14:00:00.000Z",
    "2026-09-30T15:00:00.000Z",
  );
  const all = {
    sessions: [mineTalk, starredTalk, otherTalk],
    shifts: [myShift, openShift],
    viewerUid: "5",
    resolve: (id: string) => (id === "5" ? "telegram:5" : id),
    myStars: new Set(["starred"]),
  };

  it("keeps only sessions I starred or run, and shifts I'm on", () => {
    const ids = buildGrid(input({ ...all, onlyMine: true }))
      .cards.map((c) => c.id)
      .sort();
    expect(ids).toEqual(["mine", "my-shift", "starred"]);
  });

  it("the All view keeps everything", () => {
    expect(buildGrid(input({ ...all, onlyMine: false })).cards).toHaveLength(5);
  });
});

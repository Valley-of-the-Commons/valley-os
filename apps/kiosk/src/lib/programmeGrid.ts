// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The programme grid's view model (valley-os v2c AC-c2/c3/c9): which columns
// the Day or Week view shows, and where each keynote, session and shift card
// sits. Pure. Meaning (ownership, contests, stars) comes from
// @holons/core/sessions; this module only lays it out. Star emphasis is a
// flag on the card and never changes its geometry.

import type {
  Break,
  ClusterResult,
  Room,
  Session,
} from "@holons/core/sessions";
import { addDays, toWallClock } from "@holons/core/time";

export type ProgrammeViewMode = "day" | "week";

/** A shift as the grid needs it; the kiosk derives it from its shift stores. */
export interface ShiftItem {
  id: string;
  title: string;
  /** Epoch ms. */
  start: number;
  end: number;
  mine: boolean;
  /** No places left. */
  full: boolean;
  /** People signed up. */
  taken: number;
}

export interface GridInput {
  view: ProgrammeViewMode;
  /** Hub-local date the view is anchored on, `YYYY-MM-DD`. */
  date: string;
  timezone: string;
  sessions: Session[];
  rooms: Room[];
  clusters: ClusterResult[];
  starCounts: Map<string, number>;
  /** Session ids the viewer starred. */
  myStars: Set<string>;
  viewerUid: string | null;
  resolve: (id: string) => string;
  shifts: ShiftItem[];
  layers: { keynotes: boolean; sessions: boolean; shifts: boolean };
  /** Stars at which a session is emphasised (default 3). */
  emphasisThreshold?: number;
  /** Hub-local breaks (lunch, open day …) for the all-day banner row. */
  breaks: Break[];
  /** The Mine view: only sessions the viewer starred or runs, and their shifts. */
  onlyMine?: boolean;
}

export interface GridBanner {
  key: string;
  date: string;
  label: string;
  startMin: number;
  endMin: number;
}

export interface GridColumn {
  key: string;
  kind: "room" | "day" | "shifts";
  /** The hub-local date the column shows. */
  date: string;
  roomId?: string;
  roomName?: string;
}

export interface GridCard {
  key: string;
  id: string;
  kind: "keynote" | "session" | "shift";
  column: string;
  date: string;
  /** Minutes since hub-local midnight. */
  startMin: number;
  endMin: number;
  /** Overlap sub-column and how many share the cluster. */
  lane: number;
  lanes: number;
  title: string;
  roomName?: string;
  stars: number;
  emphasised: boolean;
  contested: boolean;
  mine: boolean;
  starred: boolean;
  full: boolean;
  taken: number;
}

export interface GridModel {
  columns: GridColumn[];
  cards: GridCard[];
  /** Visible hour range, minutes since hub-local midnight. */
  startMin: number;
  endMin: number;
  /** The all-day banner row: each visible day's breaks, by time. */
  banners: GridBanner[];
}

export const DEFAULT_EMPHASIS_THRESHOLD = 3;
const DAY_START = 8 * 60;
const DAY_END = 22 * 60;
const MIDNIGHT = 24 * 60;

interface Span {
  id: string;
  start: number;
  end: number;
}

/**
 * Overlap sub-columns: items in one transitive overlap cluster share its lane
 * count; each takes the lowest lane free at its start. Order-independent.
 */
export function assignLanes(
  items: Span[],
): Map<string, { lane: number; lanes: number }> {
  const sorted = [...items].sort(
    (a, b) => a.start - b.start || a.end - b.end || (a.id < b.id ? -1 : 1),
  );
  const out = new Map<string, { lane: number; lanes: number }>();
  let cluster: string[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -Infinity;
  const close = () => {
    for (const id of cluster) out.get(id)!.lanes = laneEnds.length;
    cluster = [];
    laneEnds = [];
  };
  for (const it of sorted) {
    if (it.start >= clusterEnd) close();
    let lane = laneEnds.findIndex((end) => end <= it.start);
    if (lane === -1) lane = laneEnds.push(0) - 1;
    laneEnds[lane] = it.end;
    clusterEnd = Math.max(
      clusterEnd === -Infinity ? it.end : clusterEnd,
      it.end,
    );
    out.set(it.id, { lane, lanes: 0 });
    cluster.push(it.id);
  }
  close();
  return out;
}

/** Hub-local date and minute span of an interval, clipped to its start day. */
function place(startMs: number, endMs: number, tz: string) {
  const s = toWallClock(startMs, tz);
  const e = toWallClock(endMs, tz);
  return {
    date: s.date,
    startMin: s.minutes,
    endMin: e.date === s.date ? e.minutes : MIDNIGHT,
  };
}

/** The Monday of a hub-local calendar date's week. */
function mondayOf(date: string): string {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, -((weekday + 6) % 7));
}

export function buildGrid(input: GridInput): GridModel {
  const tz = input.timezone;
  const threshold = input.emphasisThreshold ?? DEFAULT_EMPHASIS_THRESHOLD;
  const rooms = [...input.rooms].sort(
    (a, b) =>
      (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name),
  );
  const roomName = new Map(rooms.map((r) => [r.id, r.name]));
  const days =
    input.view === "week"
      ? Array.from({ length: 7 }, (_, i) => addDays(mondayOf(input.date), i))
      : [input.date];
  const inView = new Set(days);

  const columns: GridColumn[] =
    input.view === "day"
      ? rooms.map((r) => ({
          key: `room:${r.id}`,
          kind: "room" as const,
          date: input.date,
          roomId: r.id,
          roomName: r.name,
        }))
      : days.map((d) => ({ key: `day:${d}`, kind: "day" as const, date: d }));
  if (input.view === "day" && input.layers.shifts)
    columns.push({ key: "shifts", kind: "shifts", date: input.date });

  const contested = new Set(
    input.clusters.filter((c) => c.contested).flatMap((c) => c.sessionIds),
  );
  const viewer = input.viewerUid ? input.resolve(input.viewerUid) : null;
  const columnFor = (date: string, roomKey: string) =>
    input.view === "day" ? roomKey : `day:${date}`;

  const cards: GridCard[] = [];
  for (const s of input.sessions) {
    if (s.deleted) continue;
    if (s.type === "keynote" ? !input.layers.keynotes : !input.layers.sessions)
      continue;
    const p = place(Date.parse(s.startsAt), Date.parse(s.endsAt), tz);
    if (!inView.has(p.date)) continue;
    if (input.view === "day" && !roomName.has(s.roomId)) continue;
    const stars = input.starCounts.get(s.id) ?? 0;
    cards.push({
      key: `session:${s.id}`,
      id: s.id,
      kind: s.type === "keynote" ? "keynote" : "session",
      column: columnFor(p.date, `room:${s.roomId}`),
      ...p,
      lane: 0,
      lanes: 1,
      title: s.title,
      roomName: roomName.get(s.roomId),
      stars,
      emphasised: stars >= threshold,
      contested: contested.has(s.id),
      mine: viewer != null && input.resolve(s.createdBy) === viewer,
      starred: input.myStars.has(s.id),
      full: false,
      taken: 0,
    });
  }
  if (input.layers.shifts) {
    for (const sh of input.shifts) {
      const p = place(sh.start, sh.end, tz);
      if (!inView.has(p.date)) continue;
      cards.push({
        key: `shift:${sh.id}`,
        id: sh.id,
        kind: "shift",
        column: columnFor(p.date, "shifts"),
        ...p,
        lane: 0,
        lanes: 1,
        title: sh.title,
        stars: 0,
        emphasised: false,
        contested: false,
        mine: sh.mine,
        starred: false,
        full: sh.full,
        taken: sh.taken,
      });
    }
  }

  if (input.onlyMine) {
    const keep = (c: GridCard) =>
      c.kind === "shift" ? c.mine : c.mine || c.starred;
    cards.splice(0, cards.length, ...cards.filter(keep));
  }
  const byColumn = new Map<string, GridCard[]>();
  for (const c of cards)
    byColumn.set(c.column, [...(byColumn.get(c.column) ?? []), c]);
  for (const group of byColumn.values()) {
    const lanes = assignLanes(
      group.map((c) => ({ id: c.key, start: c.startMin, end: c.endMin })),
    );
    for (const c of group) Object.assign(c, lanes.get(c.key));
  }
  cards.sort(
    (a, b) =>
      a.column.localeCompare(b.column) ||
      a.startMin - b.startMin ||
      a.lane - b.lane,
  );

  const earliest = Math.min(
    DAY_START,
    ...cards.map((c) => Math.floor(c.startMin / 60) * 60),
  );
  const latest = Math.max(
    DAY_END,
    ...cards.map((c) => Math.ceil(c.endMin / 60) * 60),
  );
  const banners = days.flatMap((date) =>
    input.breaks
      .filter((b) => b.date == null || b.date === date)
      .sort((a, b) => a.startMin - b.startMin || a.label.localeCompare(b.label))
      .map((b) => ({
        key: `${b.id}@${date}`,
        date,
        label: b.label,
        startMin: b.startMin,
        endMin: b.endMin,
      })),
  );
  return {
    columns,
    cards,
    startMin: earliest,
    endMin: Math.min(latest, MIDNIGHT),
    banners,
  };
}

// SPDX-License-Identifier: AGPL-3.0-or-later

export type SessionType = 'keynote' | 'session';
export type SwapOutcome = 'accepted-apply' | 'declined' | 'withdrawn';
export type WriteTier = 'admin' | 'logged-in' | 'logged-out';
export type CommentKind = 'note' | 'link' | 'question';

export interface Room {
  id: string;
  name: string;
  description?: string;
  capacity?: number | null;
  color?: string;
  sortOrder: number;
}

export interface Track {
  id: string;
  name: string;
  color?: string;
  sortOrder: number;
  description?: string;
  timeWindows?: Array<{ date: string; startMin: number; endMin: number }>;
}

export interface Format {
  id: string;
  name: string;
  color?: string;
  sortOrder: number;
}

export interface Tag {
  id: string;
  name: string;
  color?: string;
}

export interface Break {
  id: string;
  label: string;
  startMin: number;
  endMin: number;
  date?: string | null;
}

export interface Session {
  id: string;
  type: SessionType;
  roomId: string;
  title: string;
  description?: string;
  startsAt: string; // UTC ISO-8601
  endsAt: string;   // UTC ISO-8601
  trackId?: string | null;
  formatId?: string | null;
  tags?: string[];
  speakers?: string[];
  livestreams?: string[];
  seriesId?: string | null;
  createdBy: string;
  createdAt: string;
  deleted?: boolean;
}

export interface Star {
  /** Derived by `starId(sessionId, uid)`: one star per person per session. */
  id?: string;
  sessionId: string;
  uid: string;
  createdAt: string;
}

export interface Comment {
  id: string;
  sessionId: string;
  kind: CommentKind;
  body: string;
  url?: string | null;
  createdBy: string;
  createdAt: string;
}

/** Where a talk stood, and whose it was, when a swap was proposed. */
export interface SlotSnapshot {
  roomId: string;
  startsAt: string;
  endsAt: string;
  owner: string;
}

/** A complete alternative slot offered to the holder. */
export interface SlotChoice {
  roomId: string;
  startsAt: string;
  endsAt: string;
}

/**
 * A swap proposal: the requester's talk (from) asks for the holder's slot
 * (target). It is an offer about positions: `snapshot` records both talks as
 * they stood, and if either has moved since, the proposal is void.
 */
export interface SwapRequest {
  id: string;
  fromSessionId: string;
  targetSessionId: string;
  snapshot: { from: SlotSnapshot; target: SlotSnapshot };
  /** Where the holder's talk goes; null means the two talks trade places. */
  proposedAlt?: SlotChoice | null;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  /**
   * The terminal decision. Honoured only when `createdBy` is the right person:
   * the slot holder (target owner) for accepted-apply/declined, the requester
   * (from owner) for withdrawn.
   */
  outcome?: { type: SwapOutcome; createdBy: string; createdAt: string } | null;
}

export interface SeriesRule {
  weekdays: number[];
  intervalWeeks: number;
  until: string;
  exceptions?: string[];
}

export interface Series {
  id: string;
  rule: SeriesRule;
}

/**
 * An admin ruling on a clash: `chosenSessionId` holds the slot. It keeps
 * applying while the clash contains only the talks it ruled on
 * (`sessionIds`), whatever their times; a new talk joining reopens it.
 */
export interface AdminResolution {
  id: string;
  sessionIds: string[];
  chosenSessionId: string;
  createdBy: string;
  createdAt: string;
}

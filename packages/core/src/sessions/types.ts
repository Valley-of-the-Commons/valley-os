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

export interface SwapRequest {
  id: string;
  fromSessionId: string;
  targetSessionId: string;
  proposedAlt?: { roomId?: string; startsAt?: string; endsAt?: string } | null;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  outcome?: { type: SwapOutcome; createdAt: string } | null;
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

export interface CoordinatorAttestation {
  type: 'coordinator';
  coordinatorPubkey: string;
  attestationId: string;
}

export interface DualSignature {
  type: 'dual';
  signedByBoth: true;
}

export interface IdentityLink {
  providerId: string;
  canonicalUid: string;
  trustProof: CoordinatorAttestation | DualSignature;
}

export interface AdminResolution {
  id: string;
  slotKey: string;
  chosenSessionId: string;
  createdBy: string;
  createdAt: string;
}

// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The half-hour grid (owner decision 2026-09-25): sessions start and end only
// on the hour or the half hour, hub-local, so every session is a whole number
// of 30-minute blocks and clashes line up.

import { toWallClock } from '../time/index.js';
import type { Session } from './types.js';

export const GRID_MINUTES = 30;

export type SessionTimeError = 'start-off-grid' | 'end-off-grid' | 'too-short';

const onGrid = (iso: string, tz: string) => {
  const ms = Date.parse(iso);
  return ms % 60_000 === 0 && toWallClock(ms, tz).minutes % GRID_MINUTES === 0;
};

/** What is wrong with a session's times, if anything (for a create/edit form). */
export function sessionTimeErrors(session: Pick<Session, 'startsAt' | 'endsAt'>, timezone: string): SessionTimeError[] {
  const errors: SessionTimeError[] = [];
  if (!onGrid(session.startsAt, timezone)) errors.push('start-off-grid');
  if (!onGrid(session.endsAt, timezone)) errors.push('end-off-grid');
  if (Date.parse(session.endsAt) - Date.parse(session.startsAt) < GRID_MINUTES * 60_000) errors.push('too-short');
  return errors;
}

export function isOnHalfHourGrid(session: Pick<Session, 'startsAt' | 'endsAt'>, timezone: string): boolean {
  return sessionTimeErrors(session, timezone).length === 0;
}

// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Owner decisions of 2026-09-25: an admin ruling holds until a new talk joins
// the clash; an accepted swap moves both talks; sessions sit on the half-hour
// grid (start and end on :00 or :30, hub-local).

import { describe, expect, it } from 'vitest';
import { computeOwnership } from './ownership.js';
import { isOnHalfHourGrid, sessionTimeErrors } from './grid.js';
import { buildProgramme } from './persistence.js';
import type { AdminResolution, Session } from './types.js';

function session(id: string, startsAt: string, endsAt: string, extra: Partial<Session> = {}): Session {
  return { id, type: 'session', roomId: 'A', title: id, startsAt, endsAt, createdBy: `owner-${id}`, createdAt: '2026-09-01T08:00:00Z', ...extra };
}
const adminIs = (uid: string) => (createdBy: string) => createdBy === uid;

describe('an admin ruling holds until a new talk joins the clash', () => {
  const alice = session('alice', '2026-09-01T10:00:00Z', '2026-09-01T11:00:00Z');
  const bob = session('bob', '2026-09-01T10:30:00Z', '2026-09-01T11:30:00Z');
  const ruling: AdminResolution = { id: 'r', sessionIds: ['alice', 'bob'], chosenSessionId: 'alice', createdBy: 'admin', createdAt: '2026-09-01T09:00:00Z' };
  const owner = (sessions: Session[]) => computeOwnership(sessions, [ruling], adminIs('admin')).clusters.find((c) => c.sessionIds.includes('alice'))!;

  it('commits the chosen talk', () => {
    expect(owner([alice, bob]).owner).toBe('alice');
  });

  it('survives the losing talk editing its times', () => {
    const nudged = { ...bob, endsAt: '2026-09-01T12:00:00Z' };
    expect(owner([alice, nudged]).owner).toBe('alice');
  });

  it('reopens when a new talk joins the clash', () => {
    const carol = session('carol', '2026-09-01T10:30:00Z', '2026-09-01T11:00:00Z');
    const c = owner([alice, bob, carol]);
    expect(c.contested).toBe(true);
    expect(c.owner).toBeUndefined();
  });

  it('still holds when one of the ruled-on losers is deleted but a clash remains', () => {
    const carol = session('carol', '2026-09-01T10:00:00Z', '2026-09-01T10:30:00Z');
    const three: AdminResolution = { ...ruling, sessionIds: ['alice', 'bob', 'carol'] };
    const c = computeOwnership([alice, { ...bob, deleted: true }, carol], [three], adminIs('admin')).clusters[0];
    expect(c.owner).toBe('alice');
  });
});

describe('the half-hour grid', () => {
  it('accepts starts and ends on :00 and :30', () => {
    expect(isOnHalfHourGrid(session('s', '2026-09-01T14:00:00Z', '2026-09-01T15:30:00Z'), 'UTC')).toBe(true);
  });

  it('rejects any other minute, and seconds', () => {
    expect(isOnHalfHourGrid(session('s', '2026-09-01T14:15:00Z', '2026-09-01T15:00:00Z'), 'UTC')).toBe(false);
    expect(isOnHalfHourGrid(session('s', '2026-09-01T14:00:00Z', '2026-09-01T14:45:00Z'), 'UTC')).toBe(false);
    expect(isOnHalfHourGrid(session('s', '2026-09-01T14:00:30Z', '2026-09-01T15:00:00Z'), 'UTC')).toBe(false);
  });

  it('is judged in hub-local time', () => {
    // 14:00 UTC is 19:45 in Kathmandu (UTC+5:45).
    const s = session('s', '2026-09-01T14:00:00Z', '2026-09-01T15:00:00Z');
    expect(isOnHalfHourGrid(s, 'Asia/Kathmandu')).toBe(false);
    expect(isOnHalfHourGrid(s, 'Europe/Rome')).toBe(true);
  });

  it('explains what is wrong, for the create form', () => {
    expect(sessionTimeErrors(session('s', '2026-09-01T14:10:00Z', '2026-09-01T14:10:00Z'), 'UTC')).toEqual(['start-off-grid', 'end-off-grid', 'too-short']);
    expect(sessionTimeErrors(session('s', '2026-09-01T14:00:00Z', '2026-09-01T14:30:00Z'), 'UTC')).toEqual([]);
  });

  it('buildProgramme drops off-grid sessions for the hub time zone', () => {
    const p = buildProgramme(
      { sessions: [session('ok', '2026-09-01T14:00:00Z', '2026-09-01T15:00:00Z'), session('odd', '2026-09-01T14:20:00Z', '2026-09-01T15:00:00Z')] },
      { timezone: 'UTC' },
    );
    expect(p.sessions.map((s) => s.id)).toEqual(['ok']);
  });
});

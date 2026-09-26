// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Defects and surviving mutants from round-3 evaluation of v2b.

import { describe, expect, it } from 'vitest';
import { computeOwnership } from './ownership.js';
import { expandSeries } from './series.js';
import { canEditSession, canWriteSession } from './permissions.js';
import { buildProgramme } from './persistence.js';
import { wallClockToUtc } from '../time/index.js';
import type { Session } from './types.js';

function session(id: string, startsAt: string, endsAt: string, extra: Partial<Session> = {}): Session {
  return { id, type: 'session', roomId: 'A', title: id, startsAt, endsAt, createdBy: `owner-${id}`, createdAt: '2026-09-01T08:00:00.000Z', ...extra };
}
const alice = session('alice', '2026-09-01T10:00:00.000Z', '2026-09-01T11:00:00.000Z'); // holds the slot
const bob = session('bob', '2026-09-01T15:00:00.000Z', '2026-09-01T16:00:00.000Z', { roomId: 'B' }); // wants it
const now = '2026-09-01T09:00:00.000Z';

describe('AC-b1: adjacency in both input orders', () => {
  it('touching sessions never overlap, whichever arrives first', () => {
    const a = session('a', '2026-09-01T10:00:00Z', '2026-09-01T11:00:00Z');
    const b = session('b', '2026-09-01T11:00:00Z', '2026-09-01T12:00:00Z');
    for (const order of [[a, b], [b, a]]) {
      expect(computeOwnership(order, [], () => false).clusters.every((c) => !c.contested)).toBe(true);
    }
  });
});

describe('AC-b6: create and edit lock identity and type', () => {
  const resolve = (id: string) => (/^\d+$/.test(id) ? `telegram:${id}` : id);

  it('a resident creates sessions only in their own name', () => {
    const mine = session('n', alice.startsAt, alice.endsAt, { createdBy: 'telegram:5' });
    expect(canWriteSession('logged-in', 'create', mine, '5', resolve)).toBe(true);
    expect(canWriteSession('logged-in', 'create', { ...mine, createdBy: 'victim' }, '5', resolve)).toBe(false);
    expect(canWriteSession('logged-in', 'create', mine, null, resolve)).toBe(false);
  });

  it('a resident edit cannot change the owner or turn a talk into a keynote or back', () => {
    const before = session('n', alice.startsAt, alice.endsAt, { createdBy: 'telegram:5' });
    expect(canEditSession('logged-in', before, { ...before, title: 'new' }, '5', resolve)).toBe(true);
    expect(canEditSession('logged-in', before, { ...before, createdBy: 'telegram:6' }, '5', resolve)).toBe(false);
    expect(canEditSession('logged-in', before, { ...before, type: 'keynote' }, '5', resolve)).toBe(false);
    const keynote = { ...before, type: 'keynote' as const };
    expect(canEditSession('logged-in', keynote, { ...keynote, type: 'session' }, '5', resolve)).toBe(false);
    expect(canEditSession('admin', keynote, { ...keynote, type: 'session' }, '99', resolve)).toBe(true);
  });
});

describe('persistence: series and swaps from strangers cannot crash peers', () => {
  const rule = { weekdays: [2], intervalWeeks: 1, until: '2026-09-30' };
  it('rejects malformed exceptions, until, weekdays and fractional intervals', () => {
    const p = buildProgramme({ series: [
      { id: 'ex-num', rule: { ...rule, exceptions: 5 } },
      { id: 'ex-bad', rule: { ...rule, exceptions: ['2026-9-8'] } },
      { id: 'until-bad', rule: { ...rule, until: '2026-9-1' } },
      { id: 'wd-bad', rule: { ...rule, weekdays: [7] } },
      { id: 'frac', rule: { ...rule, intervalWeeks: 1.5 } },
      { id: 'ok', rule: { ...rule, exceptions: ['2026-09-08'] } },
    ] });
    expect(p.series.map((s) => s.id)).toEqual(['ok']);
    expect(() => expandSeries(p.series[0].rule, alice, { start: '2026-09-01T00:00:00Z', end: '2026-10-01T00:00:00Z' })).not.toThrow();
  });

  it('rejects a ruling whose chosen talk is not among the talks it ruled on', () => {
    const p = buildProgramme({ resolutions: [
      { id: 'bad', sessionIds: ['a', 'b'], chosenSessionId: 'c', createdBy: 'admin', createdAt: now },
      { id: 'ok', sessionIds: ['a', 'b'], chosenSessionId: 'a', createdBy: 'admin', createdAt: now },
    ] });
    expect(p.resolutions.map((r) => r.id)).toEqual(['ok']);
  });

  it('validates and canonicalises the offered alternative and the outcome time', () => {
    const snapshot = { from: { roomId: 'B', startsAt: bob.startsAt, endsAt: bob.endsAt, owner: 'owner-bob' }, target: { roomId: 'A', startsAt: alice.startsAt, endsAt: alice.endsAt, owner: 'owner-alice' } };
    const base = { id: 'w', fromSessionId: 'bob', targetSessionId: 'alice', createdBy: 'owner-bob', createdAt: now, expiresAt: '2026-09-02T09:00:00Z', snapshot };
    const p = buildProgramme({ swaps: [
      { ...base, id: 'alt-bad', proposedAlt: { startsAt: 'x', roomId: 7 } },
      { ...base, id: 'ok', proposedAlt: { roomId: 'C', startsAt: '2026-09-01T16:00:00+02:00', endsAt: '2026-09-01T17:00:00+02:00' },
        outcome: { type: 'declined', createdBy: 'owner-alice', createdAt: '2026-09-01T11:00:00+02:00' } },
    ] });
    expect(p.swaps.map((s) => s.id)).toEqual(['ok']);
    expect(p.swaps[0].proposedAlt).toEqual({ roomId: 'C', startsAt: '2026-09-01T14:00:00.000Z', endsAt: '2026-09-01T15:00:00.000Z' });
    expect(p.swaps[0].outcome?.createdAt).toBe('2026-09-01T09:00:00.000Z');
  });

  it('deleted must be a real boolean; tags and speakers must be lists', () => {
    const p = buildProgramme({ sessions: [
      { ...alice, id: 'strdel', deleted: 'false' },
      { ...alice, id: 'strtags', tags: 'a,b' },
      { ...alice, id: 'ok', tags: ['a'], speakers: ['x'] },
    ] });
    expect(p.sessions.map((s) => s.id)).toEqual(['ok']);
  });

  it('a soft-deleted session is kept even off the grid, so its swaps read as voided', () => {
    const p = buildProgramme({ sessions: [{ ...alice, id: 'gone', startsAt: '2026-09-01T10:10:00Z', deleted: true }] }, { timezone: 'UTC' });
    expect(p.sessions.map((s) => s.id)).toEqual(['gone']);
  });
});

describe('time: the DST second correction', () => {
  it('lands on the right instant right after a fall-back change', () => {
    // Rome falls back at 03:00 CEST on 2026-10-25; 04:00 local is 03:00Z.
    expect(wallClockToUtc('2026-10-25', 4 * 60, 'Europe/Rome')).toBe(Date.parse('2026-10-25T03:00:00Z'));
    // Spring-forward day 2026-03-29: 12:00 local is 10:00Z (CEST).
    expect(wallClockToUtc('2026-03-29', 12 * 60, 'Europe/Rome')).toBe(Date.parse('2026-03-29T10:00:00Z'));
  });
});

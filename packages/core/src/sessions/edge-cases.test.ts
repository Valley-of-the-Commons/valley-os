// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Edge cases found by adversarial evaluation of v2b, one block per AC.

import { describe, expect, it } from 'vitest';
import { computeOwnership } from './ownership.js';
import { expandSeries } from './series.js';
import { canPerform, canWriteSession, sessionAction, type Action } from './permissions.js';
import { buildProgramme, starId } from './persistence.js';
import type { AdminResolution, Session } from './types.js';

function session(id: string, startsAt: string, endsAt: string, extra: Partial<Session> = {}): Session {
  return { id, type: 'session', roomId: 'R', title: id, startsAt, endsAt, createdBy: 'u1', createdAt: '2026-09-01T08:00:00Z', ...extra };
}
const adminIs = (uid: string) => (createdBy: string) => createdBy === uid;
const none = () => false;

describe('AC-b1: instants compare by time, not text', () => {
  it('touching sessions in different ISO spellings do not overlap', () => {
    const a = session('a', '2026-09-01T10:00:00Z', '2026-09-01T11:00:00Z');
    const b = session('b', '2026-09-01T11:00:00.000Z', '2026-09-01T12:00:00.000Z');
    const { clusters } = computeOwnership([a, b], [], none);
    expect(clusters).toHaveLength(2);
    expect(clusters.every((c) => !c.contested)).toBe(true);
  });

  it('an offset spelling of the same instant overlaps', () => {
    const a = session('a', '2026-09-01T10:00:00Z', '2026-09-01T11:00:00Z');
    const b = session('b', '2026-09-01T12:00:00+02:00', '2026-09-01T13:00:00+02:00');
    expect(computeOwnership([a, b], [], none).clusters[0].contested).toBe(true);
  });

  it('output is identical for every arrival order of sessions and resolutions', () => {
    const s = [
      session('s1', '2026-09-01T10:00:00Z', '2026-09-01T11:00:00Z'),
      session('s2', '2026-09-01T10:30:00Z', '2026-09-01T11:30:00Z'),
      session('s3', '2026-09-01T14:00:00Z', '2026-09-01T15:00:00Z', { roomId: 'Q' }),
    ];
    const key = computeOwnership(s, [], none).clusters.find((c) => c.contested)!.slotKey;
    const r: AdminResolution[] = [
      { id: 'r1', sessionIds: ['s1', 's2'], chosenSessionId: 's2', createdBy: 'admin', createdAt: '2026-09-01T09:00:00Z' },
      { id: 'r2', sessionIds: ['s1', 's2'], chosenSessionId: 's1', createdBy: 'admin', createdAt: '2026-09-01T09:00:00Z' },
    ];
    const first = computeOwnership(s, r, adminIs('admin'));
    for (const [ss, rr] of [[[...s].reverse(), r], [[s[1], s[2], s[0]], [...r].reverse()]] as const) {
      expect(computeOwnership([...ss], [...rr], adminIs('admin'))).toEqual(first);
    }
  });

  it('a single session owns its slot; every cluster reports its slot key', () => {
    const { clusters } = computeOwnership([session('s1', '2026-09-01T10:00:00Z', '2026-09-01T11:00:00Z')], [], none);
    expect(clusters[0].owner).toBe('s1');
    expect(clusters[0].slotKey).toBe('R:2026-09-01T10:00:00.000Z:2026-09-01T11:00:00.000Z');
  });

  it('a contested slot has no owner until the admin resolves it', () => {
    const s = [session('s1', '2026-09-01T10:00:00Z', '2026-09-01T11:00:00Z'), session('s2', '2026-09-01T10:30:00Z', '2026-09-01T11:30:00Z')];
    const open = computeOwnership(s, [], none).clusters[0];
    expect(open.owner).toBeUndefined();
    const r: AdminResolution = { id: 'r', sessionIds: ['s1', 's2'], chosenSessionId: 's2', createdBy: 'admin', createdAt: '2026-09-01T09:00:00Z' };
    expect(computeOwnership(s, [r], adminIs('admin')).clusters[0].owner).toBe('s2');
  });
});

describe('AC-b2: admin resolution edge cases', () => {
  const s = [
    session('s1', '2026-09-01T10:00:00Z', '2026-09-01T11:00:00Z'),
    session('s2', '2026-09-01T10:30:00Z', '2026-09-01T11:30:00Z'),
    session('s3', '2026-09-01T10:45:00Z', '2026-09-01T11:15:00Z'),
  ];
  const key = computeOwnership(s, [], none).clusters[0].slotKey;

  it('a resolution naming a deleted session leaves a still-crowded slot contested', () => {
    const withDeleted = s.map((x) => (x.id === 's3' ? { ...x, deleted: true } : x));
    // s3's deletion does not change the extent: s1 + s2 still span 10:00-11:30.
    const r: AdminResolution = { id: 'r', sessionIds: ['s1', 's2', 's3'], chosenSessionId: 's3', createdBy: 'admin', createdAt: '2026-09-01T09:00:00Z' };
    const c = computeOwnership(withDeleted, [r], adminIs('admin')).clusters[0];
    expect(c.contested).toBe(true);
    expect(c.owner).toBeUndefined();
  });

  it('two admin resolutions at the same instant: the lexically smaller id wins', () => {
    const r: AdminResolution[] = [
      { id: 'rb', sessionIds: ['s1', 's2', 's3'], chosenSessionId: 's1', createdBy: 'admin', createdAt: '2026-09-01T09:00:00Z' },
      { id: 'ra', sessionIds: ['s1', 's2', 's3'], chosenSessionId: 's2', createdBy: 'admin', createdAt: '2026-09-01T09:00:00Z' },
    ];
    expect(computeOwnership(s, r, adminIs('admin')).clusters[0].owner).toBe('s2');
  });
});

describe('AC-b4: series edge cases', () => {
  const window = { start: '2026-09-01T00:00:00Z', end: '2026-10-01T00:00:00Z' };

  it('a session crossing midnight keeps its duration', () => {
    const occ = expandSeries(
      { weekdays: [2], intervalWeeks: 1, until: '2026-09-15' },
      { startsAt: '2026-09-01T23:00:00Z', endsAt: '2026-09-02T01:00:00Z', roomId: 'R' },
      window,
    );
    expect(occ.length).toBeGreaterThan(1);
    for (const o of occ) expect(Date.parse(o.endsAt) - Date.parse(o.startsAt)).toBe(2 * 3_600_000);
  });

  it('an interval below one week yields nothing instead of looping or throwing', () => {
    const base = { startsAt: '2026-09-01T10:00:00Z', endsAt: '2026-09-01T11:00:00Z', roomId: 'R' };
    expect(expandSeries({ weekdays: [2], intervalWeeks: 0, until: '2026-09-30' }, base, window)).toEqual([]);
    expect(expandSeries({ weekdays: [2], until: '2026-09-30' } as never, base, window)).toEqual([]);
  });

  it('the window end is exclusive', () => {
    const occ = expandSeries(
      { weekdays: [2], intervalWeeks: 1, until: '2026-09-30' },
      { startsAt: '2026-09-01T10:00:00Z', endsAt: '2026-09-01T11:00:00Z', roomId: 'R' },
      { start: '2026-09-01T00:00:00Z', end: '2026-09-08T10:00:00Z' },
    );
    expect(occ.map((o) => o.startsAt)).toEqual(['2026-09-01T10:00:00.000Z']);
  });

  it('repeats at the same hub-local time across a DST change', () => {
    // Tuesday 19:00 in Rome: CEST (UTC+2) on 20 Oct, CET (UTC+1) on 27 Oct.
    const occ = expandSeries(
      { weekdays: [2], intervalWeeks: 1, until: '2026-10-27' },
      { startsAt: '2026-10-20T17:00:00Z', endsAt: '2026-10-20T18:00:00Z', roomId: 'R' },
      { start: '2026-10-01T00:00:00Z', end: '2026-11-01T00:00:00Z' },
      'Europe/Rome',
    );
    expect(occ.map((o) => o.startsAt)).toEqual(['2026-10-20T17:00:00.000Z', '2026-10-27T18:00:00.000Z']);
  });

  it('weekdays and exceptions are hub-local dates', () => {
    // Monday 00:30 in Rome is Sunday 22:30 UTC.
    const occ = expandSeries(
      { weekdays: [1], intervalWeeks: 1, until: '2026-09-14', exceptions: ['2026-09-07'] },
      { startsAt: '2026-08-30T22:30:00Z', endsAt: '2026-08-30T23:30:00Z', roomId: 'R' },
      { start: '2026-08-01T00:00:00Z', end: '2026-10-01T00:00:00Z' },
      'Europe/Rome',
    );
    expect(occ.map((o) => o.startsAt)).toEqual(['2026-08-30T22:30:00.000Z', '2026-09-13T22:30:00.000Z']);
  });
});

describe('AC-b6: ownership through the registry, keynotes locked', () => {
  const resolve = (id: string) => (/^\d+$/.test(id) ? `telegram:${id}` : id);

  it('own means the same person, whichever id each side carries', () => {
    expect(canPerform('logged-in', 'edit-own-session', { actorUid: '5', recordOwnerUid: 'telegram:5', resolve })).toBe(true);
    expect(canPerform('logged-in', 'edit-own-session', { actorUid: '6', recordOwnerUid: 'telegram:5', resolve })).toBe(false);
  });

  it('maps a session write to the right action', () => {
    const keynote = { type: 'keynote' as const };
    const talk = { type: 'session' as const };
    expect(sessionAction('create', keynote, true)).toBe('create-keynote');
    expect(sessionAction('edit', keynote, true)).toBe('edit-keynote');
    expect(sessionAction('delete', keynote, true)).toBe('edit-keynote');
    expect(sessionAction('create', talk, true)).toBe('create-session');
    expect(sessionAction('edit', talk, true)).toBe('edit-own-session');
    expect(sessionAction('delete', talk, true)).toBe('delete-own-session');
    expect(sessionAction('edit', talk, false)).toBe('edit-any-session');
  });

  it('a resident cannot edit a keynote even one they created; the admin can', () => {
    const k = session('k', '2026-09-01T10:00:00Z', '2026-09-01T11:00:00Z', { type: 'keynote', createdBy: 'telegram:5' });
    expect(canWriteSession('logged-in', 'edit', k, '5', resolve)).toBe(false);
    expect(canWriteSession('admin', 'edit', k, '99', resolve)).toBe(true);
  });

  it('a resident edits their own session under either id, not someone else\'s', () => {
    const s = session('s', '2026-09-01T10:00:00Z', '2026-09-01T11:00:00Z', { createdBy: 'telegram:5' });
    expect(canWriteSession('logged-in', 'edit', s, '5', resolve)).toBe(true);
    expect(canWriteSession('logged-in', 'delete', s, '6', resolve)).toBe(false);
    expect(canWriteSession('admin', 'delete', s, '99', resolve)).toBe(true);
  });

  it('the admin tier denies actions it does not know', () => {
    expect(canPerform('admin', 'launch-rocket' as Action)).toBe(false);
  });
});

describe('persistence: untrusted records are validated and canonical', () => {
  const slot = { roomId: 'R', startsAt: '2026-09-01T10:00:00Z', endsAt: '2026-09-01T11:00:00Z' };
  const swap = { id: 'w', fromSessionId: 'a', targetSessionId: 'b', createdBy: 'u', createdAt: '2026-09-01T06:00:00Z', expiresAt: '2026-09-02T06:00:00Z',
    snapshot: { from: { ...slot, owner: 'u' }, target: { ...slot, roomId: 'Q', owner: 'v' } } };

  it('rejects a swap with an unknown outcome, keeps a valid one', () => {
    const p = buildProgramme({ swaps: [
      { ...swap, id: 'bad', outcome: { type: 'pwned', createdAt: '2026-09-01T07:00:00Z' } },
      { ...swap, id: 'ok', outcome: { type: 'declined', createdBy: 'u', createdAt: '2026-09-01T07:00:00Z' } },
      { ...swap, id: 'anon', outcome: { type: 'declined', createdAt: '2026-09-01T07:00:00Z' } },
      { ...swap, id: 'open', outcome: null },
    ] });
    expect(p.swaps.map((s) => s.id)).toEqual(['ok', 'open']);
  });

  it('rejects a series without a positive whole interval', () => {
    const rule = { weekdays: [2], until: '2026-09-30' };
    const p = buildProgramme({ series: [
      { id: 'zero', rule: { ...rule, intervalWeeks: 0 } },
      { id: 'missing', rule },
      { id: 'ok', rule: { ...rule, intervalWeeks: 1 } },
    ] });
    expect(p.series.map((s) => s.id)).toEqual(['ok']);
  });

  it('stores instants in one canonical UTC form', () => {
    const p = buildProgramme({ sessions: [session('s', '2026-10-01T12:00:00+02:00', '2026-10-01T13:00:00+02:00')] });
    expect(p.sessions[0].startsAt).toBe('2026-10-01T10:00:00.000Z');
    expect(p.sessions[0].endsAt).toBe('2026-10-01T11:00:00.000Z');
    expect(p.sessions[0].createdAt).toBe('2026-09-01T08:00:00.000Z');
  });

  it('star ids cannot collide across (session, person) pairs', () => {
    expect(starId('a-b', 'c')).not.toBe(starId('a', 'b-c'));
    expect(starId('a:b', 'c')).not.toBe(starId('a', 'b:c'));
  });
});

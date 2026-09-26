// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Round-4 evaluation: untrusted swap and series records, and the guards whose
// mutants survived.

import { describe, expect, it } from 'vitest';
import { expandSeries } from './series.js';
import { canEditSession, canWriteSession } from './permissions.js';
import { buildProgramme } from './persistence.js';
import { wallClockToUtc } from '../time/index.js';
import type { Session } from './types.js';

const NOW = '2026-09-01T09:00:00.000Z';
const slot = (roomId: string, startsAt: string, endsAt: string, owner?: string) => ({ roomId, startsAt, endsAt, ...(owner ? { owner } : {}) });
const swapRecord = (extra: Record<string, unknown> = {}) => ({
  id: 'w', fromSessionId: 'bob', targetSessionId: 'alice', createdBy: 'owner-bob', createdAt: NOW, expiresAt: '2026-09-02T09:00:00Z',
  snapshot: { from: slot('B', '2026-09-01T15:00:00Z', '2026-09-01T16:00:00Z', 'owner-bob'), target: slot('A', '2026-09-01T10:00:00Z', '2026-09-01T11:00:00Z', 'owner-alice') },
  ...extra,
});

describe('persistence: swap records', () => {
  it('requires a complete snapshot of both talks', () => {
    const p = buildProgramme({ swaps: [
      swapRecord({ id: 'none', snapshot: undefined }),
      swapRecord({ id: 'no-owner', snapshot: { from: slot('B', '2026-09-01T15:00:00Z', '2026-09-01T16:00:00Z'), target: slot('A', '2026-09-01T10:00:00Z', '2026-09-01T11:00:00Z', 'owner-alice') } }),
      swapRecord({ id: 'backwards', snapshot: { from: slot('B', '2026-09-01T16:00:00Z', '2026-09-01T15:00:00Z', 'owner-bob'), target: slot('A', '2026-09-01T10:00:00Z', '2026-09-01T11:00:00Z', 'owner-alice') } }),
      swapRecord({ id: 'ok' }),
    ] });
    expect(p.swaps.map((s) => s.id)).toEqual(['ok']);
  });

  it('accepts only a complete alternative and drops unknown fields', () => {
    const p = buildProgramme({ swaps: [
      swapRecord({ id: 'empty', proposedAlt: {} }),
      swapRecord({ id: 'room-only', proposedAlt: { roomId: 'C' } }),
      swapRecord({ id: 'ok', proposedAlt: { roomId: 'C', startsAt: '2026-09-01T16:00:00+02:00', endsAt: '2026-09-01T17:00:00+02:00', _evil: 1 } }),
    ] });
    expect(p.swaps.map((s) => s.id)).toEqual(['ok']);
    expect(p.swaps[0].proposedAlt).toEqual({ roomId: 'C', startsAt: '2026-09-01T14:00:00.000Z', endsAt: '2026-09-01T15:00:00.000Z' });
    expect(p.swaps[0].snapshot.from).toEqual({ roomId: 'B', startsAt: '2026-09-01T15:00:00.000Z', endsAt: '2026-09-01T16:00:00.000Z', owner: 'owner-bob' });
  });

  it('rejects an outcome with a bad time', () => {
    const p = buildProgramme({ swaps: [swapRecord({ outcome: { type: 'declined', createdBy: 'owner-alice', createdAt: 'soon' } })] });
    expect(p.swaps).toEqual([]);
  });
});

describe('persistence: session lists', () => {
  const base: Session = { id: 's', type: 'session', roomId: 'A', title: 's', startsAt: '2026-09-01T10:00:00Z', endsAt: '2026-09-01T11:00:00Z', createdBy: 'u', createdAt: NOW };
  it('speakers and livestreams must be lists of strings, like tags', () => {
    const p = buildProgramme({ sessions: [
      { ...base, id: 'spk-str', speakers: 'Ada' },
      { ...base, id: 'live-str', livestreams: 'http://x' },
      { ...base, id: 'tag-num', tags: [1] },
      { ...base, id: 'ok', speakers: ['Ada'], livestreams: ['http://x'], tags: ['soil'] },
    ] });
    expect(p.sessions.map((s) => s.id)).toEqual(['ok']);
  });
});

describe('series from strangers cannot crash or freeze peers', () => {
  const window = { start: '2026-09-01T00:00:00Z', end: '2026-10-01T00:00:00Z' };
  const talk = { startsAt: '2026-09-01T10:00:00Z', endsAt: '2026-09-01T11:00:00Z', roomId: 'A' };

  it('rejects intervals beyond 52 weeks and impossible dates', () => {
    const rule = { weekdays: [2], intervalWeeks: 1, until: '2026-09-30' };
    const p = buildProgramme({ series: [
      { id: 'huge', rule: { ...rule, intervalWeeks: 1e9 } },
      { id: 'feb31', rule: { ...rule, until: '2026-02-31' } },
      { id: 'ex-feb31', rule: { ...rule, exceptions: ['2026-02-31'] } },
      { id: 'ok', rule: { ...rule, intervalWeeks: 52 } },
    ] });
    expect(p.series.map((s) => s.id)).toEqual(['ok']);
    expect(expandSeries({ ...rule, intervalWeeks: 1e9 }, talk, window)).toEqual([]);
  });

  it('a base far in the past expands quickly and correctly', () => {
    const ancient = { startsAt: '1000-09-01T10:00:00Z', endsAt: '1000-09-01T11:00:00Z', roomId: 'A' };
    const started = performance.now();
    const occ = expandSeries({ weekdays: [0, 1, 2, 3, 4, 5, 6], intervalWeeks: 1, until: '2026-09-30' }, ancient, window, 'Europe/Rome');
    expect(performance.now() - started).toBeLessThan(200);
    expect(occ).toHaveLength(30);
    expect(occ.map((o) => o.startsAt.slice(0, 10))[0]).toBe('2026-09-01');
    expect(new Set(occ.map((o) => o.startsAt.slice(11)))).toHaveProperty('size', 1); // one wall-clock time throughout
  });

  it('skipping cycles keeps a bi-weekly rhythm aligned to the base week', () => {
    const occ = expandSeries({ weekdays: [2], intervalWeeks: 2, until: '2026-12-31' }, { ...talk, startsAt: '2026-01-06T10:00:00Z', endsAt: '2026-01-06T11:00:00Z' }, window);
    // 2026-01-06 is a Tuesday; every other Tuesday from there lands on 09-01, 09-15, 09-29.
    expect(occ.map((o) => o.startsAt.slice(0, 10))).toEqual(['2026-09-01', '2026-09-15', '2026-09-29']);
  });
});

describe('permission guards', () => {
  const resolve = (id: string) => (/^\d+$/.test(id) ? `telegram:${id}` : id);
  const theirs: Session = { id: 's', type: 'session', roomId: 'A', title: 's', startsAt: '2026-09-01T10:00:00Z', endsAt: '2026-09-01T11:00:00Z', createdBy: 'telegram:6', createdAt: NOW };

  it('a resident cannot edit someone else\'s talk through canEditSession', () => {
    expect(canEditSession('logged-in', theirs, { ...theirs, title: 'mine now' }, '5', resolve)).toBe(false);
  });

  it('no actor, no write, whatever the tier', () => {
    expect(canWriteSession('admin', 'edit', theirs, null, resolve)).toBe(false);
    expect(canWriteSession('admin', 'create', theirs, undefined, resolve)).toBe(false);
  });

  it('the owner lock resolves ids: the same person under another id is not a change', () => {
    const mine = { ...theirs, createdBy: 'telegram:5' };
    expect(canEditSession('logged-in', mine, { ...mine, createdBy: '5' }, '5', resolve)).toBe(true);
  });

  it('the admin may create a session in someone else\'s name (e.g. an import)', () => {
    expect(canWriteSession('admin', 'create', theirs, '99', resolve)).toBe(true);
  });
});

describe('time: the fall-back hour', () => {
  it('01:30 on the day Rome falls back is 23:30 UTC the evening before', () => {
    expect(wallClockToUtc('2026-10-25', 90, 'Europe/Rome')).toBe(Date.parse('2026-10-24T23:30:00Z'));
  });
});

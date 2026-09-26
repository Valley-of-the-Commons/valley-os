// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  PROGRAMME_LENSES,
  buildProgramme,
  deleteSession,
  saveSession,
  starId,
  starSession,
  unstarSession,
  type LensWriter,
} from './persistence.js';
import type { Session } from './types.js';

function fakeWriter() {
  const puts: Array<{ lens: string; data: Record<string, unknown> }> = [];
  const writer: LensWriter = {
    put: async (lens, data) => {
      puts.push({ lens, data: data as Record<string, unknown> });
      return true;
    },
  };
  return { writer, puts };
}

const session: Session = {
  id: 's1',
  type: 'session',
  roomId: 'r1',
  title: 'Soil workshop',
  startsAt: '2026-10-01T10:00:00.000Z',
  endsAt: '2026-10-01T11:00:00.000Z',
  createdBy: 'telegram:5',
  createdAt: '2026-09-25T09:00:00.000Z',
};

describe('buildProgramme', () => {
  it('keeps valid records and drops malformed public data', () => {
    const p = buildProgramme({
      sessions: [session, { id: 'bad', title: 'no times' }, null, 'junk'],
      rooms: [{ id: 'r1', name: 'Main hall', sortOrder: 0 }, { name: 'no id' }],
      stars: [{ id: starId('s1', 'telegram:5'), sessionId: 's1', uid: 'telegram:5', createdAt: '2026-09-25T10:00:00.000Z' }, { sessionId: 's1' }],
    });
    expect(p.sessions.map((s) => s.id)).toEqual(['s1']);
    expect(p.rooms.map((r) => r.id)).toEqual(['r1']);
    expect(p.stars).toHaveLength(1);
    expect(p.tracks).toEqual([]);
    expect(p.resolutions).toEqual([]);
  });

  it('drops a session whose end is not after its start', () => {
    const p = buildProgramme({ sessions: [{ ...session, endsAt: session.startsAt }] });
    expect(p.sessions).toEqual([]);
  });

  it('drops a session with an unknown type', () => {
    const p = buildProgramme({ sessions: [{ ...session, type: 'party' }] });
    expect(p.sessions).toEqual([]);
  });

  it('strips transport fields but keeps the soft-delete flag', () => {
    const p = buildProgramme({ sessions: [{ ...session, deleted: true, _holon: 'h', _federation: { origin: 'x' } }] });
    expect(p.sessions[0]).toEqual({ ...session, deleted: true });
  });
});

describe('writers', () => {
  it('saveSession writes to the sessions lens', async () => {
    const { writer, puts } = fakeWriter();
    expect(await saveSession(writer, session)).toBe(true);
    expect(puts).toEqual([{ lens: PROGRAMME_LENSES.sessions, data: session }]);
  });

  it('deleteSession soft-deletes so swaps can see the deletion', async () => {
    const { writer, puts } = fakeWriter();
    await deleteSession(writer, session);
    expect(puts[0].data).toEqual({ ...session, deleted: true });
  });

  it('one star per person: the star id is deterministic, so starring twice is idempotent', async () => {
    const { writer, puts } = fakeWriter();
    await starSession(writer, 's1', 'telegram:5', '2026-09-25T10:00:00.000Z');
    await starSession(writer, 's1', 'telegram:5', '2026-09-25T10:05:00.000Z');
    expect(puts[0].data.id).toBe(puts[1].data.id);
    expect(puts[0]).toEqual({
      lens: PROGRAMME_LENSES.stars,
      data: { id: starId('s1', 'telegram:5'), sessionId: 's1', uid: 'telegram:5', createdAt: '2026-09-25T10:00:00.000Z' },
    });
  });

  it('unstar writes a tombstone for the same star id', async () => {
    const { writer, puts } = fakeWriter();
    await unstarSession(writer, 's1', 'telegram:5');
    expect(puts[0]).toEqual({ lens: PROGRAMME_LENSES.stars, data: { id: starId('s1', 'telegram:5'), _deleted: true } });
  });

  it('star ids differ per session and per person', () => {
    expect(starId('s1', 'telegram:5')).not.toBe(starId('s2', 'telegram:5'));
    expect(starId('s1', 'telegram:5')).not.toBe(starId('s1', 'telegram:6'));
  });
});

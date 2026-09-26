// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Session, WriteTier } from './types.js';

export type Action =
  | 'create-keynote'
  | 'edit-keynote'
  | 'create-room'
  | 'edit-room'
  | 'create-track'
  | 'edit-track'
  | 'create-format'
  | 'edit-format'
  | 'create-tag'
  | 'edit-tag'
  | 'create-break'
  | 'edit-break'
  | 'resolve-contest'
  | 'import'
  | 'create-session'
  | 'edit-own-session'
  | 'delete-own-session'
  | 'edit-any-session'
  | 'star'
  | 'comment';

const ADMIN_ONLY: Set<Action> = new Set([
  'create-keynote',
  'edit-keynote',
  'create-room',
  'edit-room',
  'create-track',
  'edit-track',
  'create-format',
  'edit-format',
  'create-tag',
  'edit-tag',
  'create-break',
  'edit-break',
  'resolve-contest',
  'import',
  'edit-any-session',
]);

const LOGGED_IN_ACTIONS: Set<Action> = new Set([
  'create-session',
  'edit-own-session',
  'delete-own-session',
  'star',
  'comment',
]);

const ALL_ACTIONS: Set<Action> = new Set([...ADMIN_ONLY, ...LOGGED_IN_ACTIONS]);

export interface PermissionContext {
  actorUid?: string;
  recordOwnerUid?: string;
  /**
   * The registry's `resolve`. "Own" means the same person, so both ids are
   * resolved before comparing; without it they are compared as given.
   */
  resolve?: (id: string) => string;
}

/** Whether a tier may perform an action (AC-b6). Admins may do every known action. */
export function canPerform(tier: WriteTier, action: Action, context: PermissionContext = {}): boolean {
  if (tier === 'logged-out') return false;
  if (tier === 'admin') return ALL_ACTIONS.has(action);
  if (!LOGGED_IN_ACTIONS.has(action)) return false;

  if (action === 'edit-own-session' || action === 'delete-own-session') {
    const { actorUid, recordOwnerUid, resolve = (id: string) => id } = context;
    return actorUid != null && recordOwnerUid != null && resolve(actorUid) === resolve(recordOwnerUid);
  }
  return true;
}

export type SessionOp = 'create' | 'edit' | 'delete';

/** The action a write to this session is: keynotes are admin-locked whoever owns them. */
export function sessionAction(op: SessionOp, session: Pick<Session, 'type'>, own: boolean): Action {
  if (session.type === 'keynote') return op === 'create' ? 'create-keynote' : 'edit-keynote';
  if (op === 'create') return 'create-session';
  if (!own) return 'edit-any-session';
  return op === 'edit' ? 'edit-own-session' : 'delete-own-session';
}

/**
 * Whether `actorUid` at `tier` may create, edit or delete `session`. A
 * non-admin creates only in their own name. For an edit, prefer
 * `canEditSession`, which also sees the edited record.
 */
export function canWriteSession(
  tier: WriteTier,
  op: SessionOp,
  session: Pick<Session, 'type' | 'createdBy'>,
  actorUid: string | null | undefined,
  resolve: (id: string) => string = (id) => id,
): boolean {
  if (!actorUid) return false;
  const own = resolve(actorUid) === resolve(session.createdBy);
  if (op === 'create' && tier !== 'admin' && !own) return false;
  return canPerform(tier, sessionAction(op, session, own), {
    actorUid,
    recordOwnerUid: session.createdBy,
    resolve,
  });
}

/**
 * Whether an edit from `before` to `after` is allowed: the write check on the
 * stored record, and for non-admins the owner and the type stay as they were
 * (a resident cannot hand a talk to someone else or turn it into a keynote).
 */
export function canEditSession(
  tier: WriteTier,
  before: Pick<Session, 'type' | 'createdBy'>,
  after: Pick<Session, 'type' | 'createdBy'>,
  actorUid: string | null | undefined,
  resolve: (id: string) => string = (id) => id,
): boolean {
  if (!canWriteSession(tier, 'edit', before, actorUid, resolve)) return false;
  if (tier === 'admin') return canWriteSession(tier, 'edit', after, actorUid, resolve);
  return after.type === before.type && resolve(after.createdBy) === resolve(before.createdBy);
}

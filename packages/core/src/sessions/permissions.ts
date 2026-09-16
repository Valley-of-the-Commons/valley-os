// SPDX-License-Identifier: AGPL-3.0-or-later

import type { WriteTier } from './types.js';

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

export function canPerform(
  tier: WriteTier,
  action: Action,
  context?: { actorUid?: string; recordOwnerUid?: string },
): boolean {
  if (tier === 'logged-out') return false;

  if (tier === 'admin') return true;

  // logged-in tier
  if (!LOGGED_IN_ACTIONS.has(action)) return false;

  // edit-own-session and delete-own-session require actor to be the record owner.
  if (action === 'edit-own-session' || action === 'delete-own-session') {
    const { actorUid, recordOwnerUid } = context ?? {};
    return actorUid != null && actorUid === recordOwnerUid;
  }

  return true;
}

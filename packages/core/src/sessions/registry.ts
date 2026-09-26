// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Canonical-uid registry (AC-b7). One person can act under several ids: a
// bare Telegram id (the kiosk's actingAs), its `telegram:<id>` identifier, and
// any Nostr key linked to it. Every session ownership, star, comment, swap and
// admin check compares ids through `resolve`, so all of those name one person.
//
// A link is honoured only with a trust proof:
//   - a kind-31926 attestation authored by the configured coordinator
//     (the same directory the shifts layer reads), or
//   - a dual-signed link: each key signs an event naming the other.
// Event signatures on relay data are verified by Holosphere on ingestion; the
// registry additionally refuses attestations from any other provider, so a
// stranger cannot claim someone else's identity.

import { verifyEvent, type Event, type EventTemplate } from 'nostr-tools/pure';
import { attestationIdentityMap, telegramIdentifier, type IdentityAttestation } from '../shifts/index.js';

/** Nostr kind carrying one half of a dual-signed identity link. */
export const IDENTITY_LINK_KIND = 30078;
const LINK_PREFIX = 'identity-link:';

export interface DualLinkProof {
  a: Event;
  b: Event;
}

export interface RegistryOptions {
  /** Parsed kind-31926 attestations (e.g. `attestationsFrom(directory)`). */
  attestations?: IdentityAttestation[];
  /** Only this provider's attestations are trusted; none when unset. */
  coordinatorPubkey?: string;
  dualLinks?: DualLinkProof[];
}

export interface Registry {
  /** The canonical uid for any id this person acts under; itself when unlinked. */
  resolve(id: string): string;
}

const HEX64 = /^[0-9a-f]{64}$/i;
const EVM_ADDRESS = /^0x[0-9a-f]{40}$/i;
const isTelegramUid = (uid: string) => uid.startsWith('telegram:');

/** Normalise an id without consulting any link. */
function normalise(id: string): string {
  const t = String(id).trim();
  if (/^\d+$/.test(t)) return telegramIdentifier(t);
  if (HEX64.test(t)) return t.toLowerCase();
  if (EVM_ADDRESS.test(t)) return t.toLowerCase();
  return t;
}

/** The unsigned event a key signs to link itself to `otherPubkey`. */
export function dualLinkTemplate(otherPubkey: string, now = Math.floor(Date.now() / 1000)): EventTemplate {
  return {
    kind: IDENTITY_LINK_KIND,
    created_at: now,
    tags: [['d', `${LINK_PREFIX}${otherPubkey.toLowerCase()}`]],
    content: '',
  };
}

const linkedTo = (ev: Event) => ev.tags.find((t) => t[0] === 'd')?.[1]?.slice(LINK_PREFIX.length);

/** Both halves genuinely signed, by two different keys, each naming the other. */
export function verifyDualLink({ a, b }: DualLinkProof): boolean {
  if (!a || !b || a.kind !== IDENTITY_LINK_KIND || b.kind !== IDENTITY_LINK_KIND) return false;
  if (a.pubkey === b.pubkey) return false;
  if (linkedTo(a) !== b.pubkey || linkedTo(b) !== a.pubkey) return false;
  return verifyFresh(a) && verifyFresh(b);
}

/**
 * nostr-tools caches a "verified" flag on event objects it has signed or
 * checked; verify a plain copy so a tampered object cannot inherit it.
 */
const verifyFresh = (ev: Event) => verifyEvent(JSON.parse(JSON.stringify(ev)) as Event);

export function buildRegistry(opts: RegistryOptions): Registry {
  const coordinator = opts.coordinatorPubkey?.toLowerCase();
  const trusted = coordinator
    ? (opts.attestations ?? []).filter((a) => a.provider.toLowerCase() === coordinator)
    : [];
  const byKey = new Map<string, string>(attestationIdentityMap(trusted, { coordinatorPubkey: coordinator }));

  // Fold verified dual links in a fixed order so every peer gets the same map.
  const links = (opts.dualLinks ?? [])
    .filter(verifyDualLink)
    .map(({ a, b }) => [a.pubkey, b.pubkey].sort() as [string, string])
    .sort((p, q) => (p.join() < q.join() ? -1 : 1));
  const current = (pk: string) => byKey.get(pk) ?? pk;
  for (const [x, y] of links) {
    const cx = current(x);
    const cy = current(y);
    if (cx === cy) continue;
    // Never merge two different attested people.
    if (isTelegramUid(cx) && isTelegramUid(cy)) continue;
    const target = isTelegramUid(cx) ? cx : isTelegramUid(cy) ? cy : cx < cy ? cx : cy;
    for (const pk of [x, y]) if (!byKey.has(pk)) byKey.set(pk, pk);
    for (const [pk, uid] of byKey) if (uid === cx || uid === cy) byKey.set(pk, target);
  }

  return {
    resolve(id) {
      const n = normalise(id);
      return byKey.get(n) ?? n;
    },
  };
}

/**
 * Whether `actorId` is the hub admin. `settingsAdmin` is `settings.admin`
 * (a bare Telegram id today); both sides resolve through the registry so a
 * key-login admin also matches. An unset admin makes nobody admin.
 */
export function isAdmin(registry: Registry, actorId: string, settingsAdmin: string): boolean {
  if (!String(settingsAdmin ?? '').trim() || !String(actorId ?? '').trim()) return false;
  return registry.resolve(actorId) === registry.resolve(settingsAdmin);
}

// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { attestationIdentityMap, type IdentityAttestation } from '../shifts/index.js';
import { buildRegistry, dualLinkTemplate, isAdmin, verifyDualLink } from './registry.js';

const coordinator = 'c'.repeat(64);
const stranger = 'e'.repeat(64);
const adminKey = 'a'.repeat(64);
const residentKey = 'b'.repeat(64);

function attestation(provider: string, telegramId: string, pubkeys: string[], createdAt = 1): IdentityAttestation {
  return {
    provider,
    identifier: `telegram:${telegramId}`,
    platform: 'telegram',
    platformId: telegramId,
    pubkeys,
    createdAt,
    id: `${provider.slice(0, 4)}-${telegramId}-${createdAt}`,
  };
}

function keypair() {
  const sk = generateSecretKey();
  return { sk, pk: getPublicKey(sk) };
}

function dualLink(x = keypair(), y = keypair()) {
  return {
    x,
    y,
    proof: {
      a: finalizeEvent(dualLinkTemplate(y.pk, 100), x.sk),
      b: finalizeEvent(dualLinkTemplate(x.pk, 100), y.sk),
    },
  };
}

describe('registry: AC-b7', () => {
  it('an unlinked id resolves to itself, in canonical form', () => {
    const r = buildRegistry({});
    expect(r.resolve('telegram:5')).toBe('telegram:5');
    expect(r.resolve('5')).toBe('telegram:5'); // kiosk actingAs() gives the bare Telegram id
    expect(r.resolve(residentKey.toUpperCase())).toBe(residentKey);
    expect(r.resolve('0xAbC0000000000000000000000000000000000001')).toBe('0xabc0000000000000000000000000000000000001');
  });

  it('a coordinator attestation links every attested key to the Telegram identity', () => {
    const r = buildRegistry({
      coordinatorPubkey: coordinator,
      attestations: [attestation(coordinator, '42', [residentKey])],
    });
    expect(r.resolve(residentKey)).toBe('telegram:42');
    expect(r.resolve('42')).toBe('telegram:42');
  });

  it('a FORGED link (attestation by a non-coordinator provider) does not take effect', () => {
    const r = buildRegistry({
      coordinatorPubkey: coordinator,
      attestations: [attestation(stranger, '99', [residentKey])],
    });
    expect(r.resolve(residentKey)).toBe(residentKey);
  });

  it('without a configured coordinator no attestation is trusted', () => {
    const r = buildRegistry({ attestations: [attestation(coordinator, '42', [residentKey])] });
    expect(r.resolve(residentKey)).toBe(residentKey);
  });

  it('ingests 31926 attestations so shifts-mine and sessions-mine agree', () => {
    const atts = [
      attestation(coordinator, '42', [residentKey], 1),
      attestation(coordinator, '99', [adminKey], 2),
    ];
    const shifts = attestationIdentityMap(atts, { coordinatorPubkey: coordinator });
    const r = buildRegistry({ coordinatorPubkey: coordinator, attestations: atts });
    for (const pk of [residentKey, adminKey]) expect(r.resolve(pk)).toBe(shifts.get(pk));
  });

  it('a dual-signed link makes both keys one person', () => {
    const { x, y, proof } = dualLink();
    expect(verifyDualLink(proof)).toBe(true);
    const r = buildRegistry({ dualLinks: [proof] });
    expect(r.resolve(x.pk)).toBe(r.resolve(y.pk));
  });

  it('a dual link joins an attested Telegram identity when one side is attested', () => {
    const { x, y, proof } = dualLink();
    const r = buildRegistry({
      coordinatorPubkey: coordinator,
      attestations: [attestation(coordinator, '42', [x.pk])],
      dualLinks: [proof],
    });
    expect(r.resolve(y.pk)).toBe('telegram:42');
  });

  it('a dual link missing one genuine signature is rejected', () => {
    const { x, y, proof } = dualLink();
    const impostor = keypair();
    // b claims to be y but is signed by someone else.
    const forged = { a: proof.a, b: { ...finalizeEvent(dualLinkTemplate(x.pk, 100), impostor.sk), pubkey: y.pk } };
    expect(verifyDualLink(forged)).toBe(false);
    const r = buildRegistry({ dualLinks: [forged] });
    expect(r.resolve(x.pk)).not.toBe(r.resolve(y.pk));
  });

  it('a dual link whose halves name different keys is rejected', () => {
    const x = keypair();
    const y = keypair();
    const z = keypair();
    const proof = {
      a: finalizeEvent(dualLinkTemplate(z.pk, 100), x.sk),
      b: finalizeEvent(dualLinkTemplate(x.pk, 100), y.sk),
    };
    expect(verifyDualLink(proof)).toBe(false);
  });
});

describe('isAdmin: AC-b2/b7', () => {
  const registry = buildRegistry({
    coordinatorPubkey: coordinator,
    attestations: [attestation(coordinator, '99', [adminKey]), attestation(stranger, '99', [residentKey])],
  });

  it('matches the admin by bare Telegram id, canonical id, or an attested key', () => {
    expect(isAdmin(registry, '99', '99')).toBe(true);
    expect(isAdmin(registry, 'telegram:99', '99')).toBe(true);
    expect(isAdmin(registry, adminKey, '99')).toBe(true);
  });

  it('a forged link does not grant admin', () => {
    expect(isAdmin(registry, residentKey, '99')).toBe(false);
  });

  it('nobody is admin when settings.admin is unset', () => {
    expect(isAdmin(registry, '', '')).toBe(false);
    expect(isAdmin(registry, '99', '')).toBe(false);
  });

  it('a non-admin is not admin', () => {
    expect(isAdmin(registry, '77', '99')).toBe(false);
  });
});

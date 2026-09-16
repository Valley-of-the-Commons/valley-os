// SPDX-License-Identifier: AGPL-3.0-or-later

export interface RegistryLink {
  providerId: string;
  canonicalUid: string;
}

/**
 * Resolve a provider id to a canonical uid.
 * If no link exists, the input id is returned unchanged.
 */
export function resolveUid(links: RegistryLink[], providerId: string): string {
  const link = links.find((l) => l.providerId === providerId);
  return link ? link.canonicalUid : providerId;
}

/**
 * Convert coordinator-attested kind-31926 attestations into RegistryLinks.
 *
 * Each attestation maps a telegram identifier to a set of pubkeys.
 * For each pubkey in the attestation: create a link { providerId: pubkey, canonicalUid: identifier }.
 * Also create a self-link: { providerId: identifier, canonicalUid: identifier }.
 *
 * Trust note: the caller is responsible for ensuring attestations were
 * coordinator-signed before ingesting them. This function only performs
 * the mechanical conversion — it does NOT accept arbitrary manually-crafted links.
 */
export function ingestAttestations(
  attestations: Array<{ identifier: string; pubkeys: string[] }>,
): RegistryLink[] {
  const links: RegistryLink[] = [];
  for (const att of attestations) {
    // Self-link so the telegram identifier resolves to itself.
    links.push({ providerId: att.identifier, canonicalUid: att.identifier });
    for (const pubkey of att.pubkeys) {
      links.push({ providerId: pubkey, canonicalUid: att.identifier });
    }
  }
  return links;
}

/**
 * Determine if an actor (already resolved through the registry) is the admin.
 *
 * settingsAdmin is the raw value from settings (e.g. a telegram id). It is
 * resolved through the registry before comparison so that a pubkey-based
 * actorUid can match a telegram-id-based settings.admin.
 */
export function isAdmin(
  actorUid: string,
  settingsAdmin: string,
  links: RegistryLink[],
): boolean {
  const resolvedAdmin = resolveUid(links, settingsAdmin);
  return actorUid === resolvedAdmin;
}

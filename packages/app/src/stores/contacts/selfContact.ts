import type { ContactEntry } from "../../document-types/contact/contactDocumentModel";

const SELF_CONTACT_ID_PREFIX = "self_contact_v1_";

export interface EnsureSelfContactInput {
  readonly deferRemoteSync?: boolean | null | undefined;
  readonly encapsulationPublicKey?: string | null | undefined;
  readonly localId?: string | null | undefined;
  readonly userId?: string | null | undefined;
}

export interface ResolvedSelfContactIdentity {
  readonly encapsulationPublicKey: string | null;
  readonly localId: string | null;
  readonly userId: string | null;
}

function normalizeOptionalString(
  value: string | null | undefined,
): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

export function getSelfContactLocalId(signingFingerprint: string): string {
  return `${SELF_CONTACT_ID_PREFIX}${signingFingerprint.trim()}`;
}

export function isCurrentSelfContactLocalId(
  localId: string,
  signingFingerprint: string | null | undefined,
): boolean {
  return Boolean(
    signingFingerprint && localId === getSelfContactLocalId(signingFingerprint),
  );
}

export function findPrimarySelfContact(
  entriesById: ReadonlyMap<string, ContactEntry>,
  identity: ResolvedSelfContactIdentity,
): ContactEntry | null {
  // A writable self entry with this userId under a non-deterministic id is the
  // recovered cross-device identity. It outranks the creation fallback even if
  // that fallback was already promoted with the same userId while remote
  // hydration was in flight. Unrelated and read-only entries cannot displace a
  // self contact that this device can maintain.
  if (identity.userId) {
    for (const entry of entriesById.values()) {
      if (
        entry.userId === identity.userId &&
        entry.isSelf &&
        entry.canWrite !== false &&
        (!identity.localId || entry.id !== identity.localId)
      ) {
        return entry;
      }
    }
  }

  if (identity.localId) {
    const localContact = entriesById.get(identity.localId) ?? null;
    if (localContact) {
      return localContact;
    }
  }

  // Preserve the existing promotion behavior when no deterministic fallback
  // exists, but never select a shared/read-only contact for a write operation.
  if (identity.userId) {
    for (const entry of entriesById.values()) {
      if (entry.userId === identity.userId && entry.canWrite !== false) {
        return entry;
      }
    }
  }

  return null;
}

export function isSelfContactCurrent(
  entry: ContactEntry | null,
  identity: ResolvedSelfContactIdentity,
): boolean {
  return (
    entry?.isSelf === true &&
    entry.userId === identity.userId &&
    entry.encapsulationPublicKey === identity.encapsulationPublicKey
  );
}

export function resolveSelfContactId(
  existingContact: ContactEntry | null,
  identity: ResolvedSelfContactIdentity,
): string | null {
  return existingContact?.id ?? identity.localId ?? identity.userId;
}

export function toResolvedSelfContactIdentity(
  input: EnsureSelfContactInput,
  fallback?: {
    readonly encapsulationPublicKey: string;
    readonly userId: string;
  },
): ResolvedSelfContactIdentity | null {
  const identity = {
    encapsulationPublicKey: normalizeOptionalString(
      fallback?.encapsulationPublicKey ?? input.encapsulationPublicKey,
    ),
    localId: normalizeOptionalString(input.localId),
    userId: normalizeOptionalString(fallback?.userId ?? input.userId),
  };

  return identity.localId || identity.userId ? identity : null;
}

export function shouldRemoveDuplicateSelfContact(
  entry: ContactEntry,
  primaryContactId: string,
  identity: ResolvedSelfContactIdentity,
): boolean {
  if (entry.id === primaryContactId || !entry.isSelf) {
    return false;
  }

  if (entry.firstName || entry.lastName || entry.nickname) {
    return false;
  }

  const userMatches =
    entry.userId === null ||
    (identity.userId !== null && entry.userId === identity.userId);
  const encapsulationKeyMatches =
    entry.encapsulationPublicKey === null ||
    (identity.encapsulationPublicKey !== null &&
      entry.encapsulationPublicKey === identity.encapsulationPublicKey);

  return userMatches && encapsulationKeyMatches;
}

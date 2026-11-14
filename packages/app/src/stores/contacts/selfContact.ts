import type { ContactEntry } from "../../document-types/contact/contactDocumentModel";

const SELF_CONTACT_ID_PREFIX = "self_contact_v1_";

export interface EnsureSelfContactInput {
  readonly deferRemoteSync?: boolean | null | undefined;
  readonly encapsulationPublicKey?: string | null | undefined;
  /** When supplied, must be the current signing identity's canonical local id. */
  readonly localId?: string | null | undefined;
  readonly userId?: string | null | undefined;
}

export interface ResolvedSelfContactIdentity {
  readonly documentId: string;
  readonly encapsulationPublicKey: string | null;
  readonly localId: string;
  readonly userId: string | null;
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

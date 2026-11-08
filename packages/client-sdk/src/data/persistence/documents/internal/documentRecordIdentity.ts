import type { DocumentRecord } from "../records";
import type { StoredDocumentRecord } from "../types";

export function sameNullableDocumentValue(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  return (left ?? null) === (right ?? null);
}

/** The local row, remote document, recovery target, access epoch, and keys. */
function sameDocumentTargetAndKeys(
  current: DocumentRecord,
  expected: DocumentRecord,
): boolean {
  return (
    current.id === expected.id &&
    current.documentId === expected.documentId &&
    sameNullableDocumentValue(
      current.recoveryDocumentId,
      expected.recoveryDocumentId,
    ) &&
    current.accessEpoch === expected.accessEpoch &&
    sameNullableDocumentValue(
      current.contentKeyBundle,
      expected.contentKeyBundle,
    ) &&
    sameNullableDocumentValue(
      current.documentKekTargets,
      expected.documentKekTargets,
    ) &&
    sameNullableDocumentValue(
      current.documentManifestBundle,
      expected.documentManifestBundle,
    )
  );
}

export function sameCanonicalDocumentSecurityIdentity(
  current: DocumentRecord,
  expected: DocumentRecord,
): boolean {
  return (
    sameDocumentTargetAndKeys(current, expected) &&
    sameNullableDocumentValue(
      current.accessStateHash,
      expected.accessStateHash,
    ) &&
    (current.effectiveAccessLevel ?? null) ===
      (expected.effectiveAccessLevel ?? null)
  );
}

export function sameDocumentSecurityIdentity(
  current: StoredDocumentRecord,
  expected: StoredDocumentRecord,
): boolean {
  return (
    sameCanonicalDocumentSecurityIdentity(current, expected) &&
    current.containerId === expected.containerId
  );
}

/**
 * The identity a server acknowledgement must still match before its queued
 * updates settle: the same local row and placement, remote document, recovery
 * target, access epoch, and key material. Access state (`accessStateHash`,
 * `effectiveAccessLevel`) is left out on purpose. Discovery and membership
 * refreshes rewrite it without changing the document the server stored the
 * updates in, so a refresh that lands while a sync response is being
 * persisted must not leave acknowledged updates queued: the next pass would
 * resend their ids, hit an id conflict, and re-key them into duplicates.
 */
export function sameDocumentSettlementIdentity(
  current: StoredDocumentRecord,
  expected: StoredDocumentRecord,
): boolean {
  return (
    sameDocumentTargetAndKeys(current, expected) &&
    current.containerId === expected.containerId
  );
}

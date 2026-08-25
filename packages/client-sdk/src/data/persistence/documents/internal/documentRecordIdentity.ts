import type { DocumentRecord } from "../../../sqlite/documentPersistence";
import type { StoredDocumentRecord } from "../types";

export function sameNullableDocumentValue(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  return (left ?? null) === (right ?? null);
}

export function sameCanonicalDocumentSecurityIdentity(
  current: DocumentRecord,
  expected: DocumentRecord,
): boolean {
  return (
    current.id === expected.id &&
    current.documentId === expected.documentId &&
    current.accessEpoch === expected.accessEpoch &&
    sameNullableDocumentValue(
      current.accessStateHash,
      expected.accessStateHash,
    ) &&
    (current.effectiveAccessLevel ?? null) ===
      (expected.effectiveAccessLevel ?? null) &&
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

export function sameDocumentSecurityIdentity(
  current: StoredDocumentRecord,
  expected: StoredDocumentRecord,
): boolean {
  return (
    sameCanonicalDocumentSecurityIdentity(current, expected) &&
    current.containerId === expected.containerId
  );
}

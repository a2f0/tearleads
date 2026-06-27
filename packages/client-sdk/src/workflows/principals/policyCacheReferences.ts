import type { ReferencedPrincipalStateResponse } from "@tearleads/validators/response";

function getReferencedPrincipalStateKey(
  reference: ReferencedPrincipalStateResponse,
): string {
  return [
    reference.principalType,
    reference.principalId,
    reference.version,
    reference.keyEpoch,
    reference.stateHash,
    reference.keyFingerprint,
  ].join(":");
}

export function dedupeReferencedPrincipalStates(
  references: ReadonlyArray<ReferencedPrincipalStateResponse>,
): ReferencedPrincipalStateResponse[] {
  const referencesByState = new Map<string, ReferencedPrincipalStateResponse>();

  for (const reference of references) {
    referencesByState.set(getReferencedPrincipalStateKey(reference), reference);
  }

  return Array.from(referencesByState.values());
}

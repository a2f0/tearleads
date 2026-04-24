import type { ReferencedPrincipalStateResponse } from "@tearleads/validators/response";
import type { StoredPrincipalState } from "./principalStateStore";

interface ReferencedPrincipalContainer {
  referencedPrincipals: ReferencedPrincipalStateResponse[];
}

export function toReferencedPrincipalState(
  state: Pick<
    StoredPrincipalState,
    "principalId" | "principalType" | "version" | "keyEpoch" | "stateHash"
  >,
): ReferencedPrincipalStateResponse {
  return {
    principalType: state.principalType,
    principalId: state.principalId,
    version: state.version,
    keyEpoch: state.keyEpoch,
    stateHash: state.stateHash,
  };
}

function principalReferenceKey(
  reference: Pick<
    ReferencedPrincipalStateResponse,
    "principalType" | "principalId"
  >,
): string {
  return `${reference.principalType}:${reference.principalId}`;
}

function sortReferencedPrincipals(
  references: ReferencedPrincipalStateResponse[],
): ReferencedPrincipalStateResponse[] {
  return references.sort((left, right) => {
    if (left.principalType !== right.principalType) {
      return left.principalType.localeCompare(right.principalType);
    }

    return left.principalId.localeCompare(right.principalId);
  });
}

export function mergeReferencedPrincipals(
  containers: ReadonlyArray<ReferencedPrincipalContainer>,
): ReferencedPrincipalStateResponse[] {
  const referencesByKey = new Map<string, ReferencedPrincipalStateResponse>();

  for (const container of containers) {
    for (const reference of container.referencedPrincipals) {
      referencesByKey.set(principalReferenceKey(reference), reference);
    }
  }

  return sortReferencedPrincipals(Array.from(referencesByKey.values()));
}

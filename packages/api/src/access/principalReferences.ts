import type { ManagedRecipientPrincipalType } from "@tearleads/crypto";
import type { ReferencedPrincipalStateResponse } from "@tearleads/validators/response";
import { type DatabaseExecutor, db } from "../adapters/postgres";
import { uniqueSortedStrings } from "../utils/array";
import {
  getCurrentPrincipalStates,
  type StoredPrincipalState,
} from "./principalStateStore";

interface PrincipalGrantReference {
  principalId: string;
  principalType: string;
}

interface ReferencedPrincipalContainer {
  referencedPrincipals: ReferencedPrincipalStateResponse[];
}

function isManagedPrincipalType(
  value: string,
): value is ManagedRecipientPrincipalType {
  return value === "group" || value === "organization";
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

export async function listReferencedPrincipalStatesForGrants(
  grants: ReadonlyArray<PrincipalGrantReference>,
  executor: DatabaseExecutor = db,
): Promise<ReferencedPrincipalStateResponse[]> {
  const principalIdsByType = new Map<ManagedRecipientPrincipalType, string[]>([
    ["group", []],
    ["organization", []],
  ]);

  for (const grant of grants) {
    if (!isManagedPrincipalType(grant.principalType)) {
      continue;
    }

    principalIdsByType.get(grant.principalType)?.push(grant.principalId);
  }

  const currentStatesByType = await Promise.all(
    Array.from(principalIdsByType.entries()).map(
      async ([principalType, principalIds]) =>
        getCurrentPrincipalStates(
          principalType,
          uniqueSortedStrings(principalIds),
          executor,
        ),
    ),
  );

  const references = Array.from(currentStatesByType.values()).flatMap(
    (states) => Array.from(states.values()).map(toReferencedPrincipalState),
  );

  return sortReferencedPrincipals(references);
}

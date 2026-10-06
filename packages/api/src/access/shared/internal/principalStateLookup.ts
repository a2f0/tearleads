import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { principalStates } from "@tearleads/api-shared/schema";
import { and, eq, inArray } from "drizzle-orm";
import { uniqueSortedStrings } from "../../../utils/array";
import {
  type PrincipalStateReference,
  principalStateReferenceKey,
  principalStateSelect,
  type StoredPrincipalState,
  toStoredPrincipalState,
} from "./principalStateRecords";

export async function getPrincipalStatesForReferences(
  references: readonly Pick<
    PrincipalStateReference,
    "principalType" | "principalId" | "stateHash"
  >[],
  executor: DatabaseSession,
): Promise<Map<string, StoredPrincipalState>> {
  const statesByReference = new Map<string, StoredPrincipalState>();
  const uniqueReferences = new Map(
    references.map((reference) => [
      principalStateReferenceKey(reference),
      reference,
    ]),
  );

  for (const principalType of [
    ...new Set(
      Array.from(uniqueReferences.values()).map(
        (reference) => reference.principalType,
      ),
    ),
  ]) {
    const referencesForType = Array.from(uniqueReferences.values()).filter(
      (reference) => reference.principalType === principalType,
    );
    const principalIds = uniqueSortedStrings(
      referencesForType.map((reference) => reference.principalId),
    );
    const stateHashes = uniqueSortedStrings(
      referencesForType.map((reference) => reference.stateHash),
    );
    const requestedKeys = new Set(
      referencesForType.map(principalStateReferenceKey),
    );

    if (principalIds.length === 0 || stateHashes.length === 0) {
      continue;
    }

    const rows = await executor
      .select(principalStateSelect)
      .from(principalStates)
      .where(
        and(
          eq(principalStates.principalType, principalType),
          inArray(principalStates.principalId, principalIds),
          inArray(principalStates.stateHash, stateHashes),
        ),
      );

    for (const row of rows) {
      const state = toStoredPrincipalState(row);
      const key = principalStateReferenceKey(state);
      if (requestedKeys.has(key)) {
        statesByReference.set(key, state);
      }
    }
  }

  return statesByReference;
}

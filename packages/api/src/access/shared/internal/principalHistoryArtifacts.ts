import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  principalContainerGrantProjection,
  principalMembershipProjection,
} from "@tearleads/api-shared/schema";
import { and, inArray } from "drizzle-orm";
import {
  principalContainerGrantSelect,
  principalProjectionMemberSelect,
  principalStateReferenceKey,
  type StoredPrincipalState,
  type StoredPrincipalStateChainEntry,
  toStoredPrincipalContainerGrant,
  toStoredProjectionMember,
} from "./principalStateRecords";

// Bound SQL parameter counts without issuing a query for each policy version.
export const PRINCIPAL_HISTORY_BATCH_SIZE = 100;

export async function loadPrincipalHistoryArtifacts(
  executor: DatabaseSession,
  states: readonly StoredPrincipalState[],
) {
  const history = new Map<string, StoredPrincipalStateChainEntry>(
    states.map((state) => [
      principalStateReferenceKey(state),
      { state, projection: [], grants: [] },
    ]),
  );
  for (
    let start = 0;
    start < states.length;
    start += PRINCIPAL_HISTORY_BATCH_SIZE
  ) {
    const batch = states.slice(start, start + PRINCIPAL_HISTORY_BATCH_SIZE);
    const hashes = batch.map((state) => state.stateHash);
    const principalIds = [...new Set(batch.map((state) => state.principalId))];
    const principalTypes = [
      ...new Set(batch.map((state) => state.principalType)),
    ];
    const members = await executor
      .select(principalProjectionMemberSelect)
      .from(principalMembershipProjection)
      .where(
        and(
          inArray(principalMembershipProjection.principalType, principalTypes),
          inArray(principalMembershipProjection.principalId, principalIds),
          inArray(principalMembershipProjection.stateHash, hashes),
        ),
      )
      .orderBy(principalMembershipProjection.userId);
    const grants = await executor
      .select(principalContainerGrantSelect)
      .from(principalContainerGrantProjection)
      .where(
        and(
          inArray(
            principalContainerGrantProjection.principalType,
            principalTypes,
          ),
          inArray(principalContainerGrantProjection.principalId, principalIds),
          inArray(principalContainerGrantProjection.stateHash, hashes),
        ),
      )
      .orderBy(principalContainerGrantProjection.containerId);
    for (const member of members) {
      const entry = history.get(principalStateReferenceKey(member));
      if (entry?.state.principalId === member.principalId)
        entry.projection.push(toStoredProjectionMember(member));
    }
    for (const grant of grants) {
      const entry = history.get(principalStateReferenceKey(grant));
      if (entry?.state.principalId === grant.principalId)
        entry.grants.push(toStoredPrincipalContainerGrant(grant));
    }
  }
  return [...history.values()];
}

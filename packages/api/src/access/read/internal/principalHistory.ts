import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  principalContainerGrantProjection,
  principalMembershipProjection,
  principalStatePayloads,
  principalStates,
} from "@tearleads/api-shared/schema";
import { and, asc, eq, inArray, lte, or } from "drizzle-orm";
import {
  principalContainerGrantSelect,
  principalProjectionMemberSelect,
  principalStatePayloadSelect,
  principalStateSelect,
  type StoredPrincipalState,
  type StoredPrincipalStateChainEntry,
  toStoredPrincipalContainerGrant,
  toStoredPrincipalState,
  toStoredProjectionMember,
} from "../../shared/internal/principalStateRecords";

// Bound SQL parameter counts without issuing a query for each policy version.
const HISTORY_BATCH_SIZE = 100;

export async function listOrganizationHistoryPayloads(
  executor: DatabaseSession,
  organizationId: string,
  stateHash: string,
) {
  const scope = and(
    eq(principalStates.principalType, "organization"),
    eq(principalStates.principalId, organizationId),
  );
  const [target] = await executor
    .select({ version: principalStates.version })
    .from(principalStates)
    .where(and(scope, eq(principalStates.stateHash, stateHash)))
    .limit(1);
  if (!target) return null;
  return executor
    .select(principalStatePayloadSelect)
    .from(principalStatePayloads)
    .innerJoin(
      principalStates,
      and(
        eq(principalStates.principalType, principalStatePayloads.principalType),
        eq(principalStates.principalId, principalStatePayloads.principalId),
        eq(principalStates.stateHash, principalStatePayloads.stateHash),
      ),
    )
    .where(and(scope, lte(principalStates.version, target.version)))
    .orderBy(asc(principalStates.version));
}

async function loadHistoryArtifacts(
  executor: DatabaseSession,
  states: readonly StoredPrincipalState[],
) {
  const history = new Map<string, StoredPrincipalStateChainEntry>(
    states.map((state) => [
      state.stateHash,
      { state, projection: [], grants: [] },
    ]),
  );
  for (let start = 0; start < states.length; start += HISTORY_BATCH_SIZE) {
    const hashes = states
      .slice(start, start + HISTORY_BATCH_SIZE)
      .map((s) => s.stateHash);
    const members = await executor
      .select(principalProjectionMemberSelect)
      .from(principalMembershipProjection)
      .where(
        and(
          eq(principalMembershipProjection.principalType, "group"),
          inArray(principalMembershipProjection.stateHash, hashes),
        ),
      )
      .orderBy(principalMembershipProjection.userId);
    const grants = await executor
      .select(principalContainerGrantSelect)
      .from(principalContainerGrantProjection)
      .where(
        and(
          eq(principalContainerGrantProjection.principalType, "group"),
          inArray(principalContainerGrantProjection.stateHash, hashes),
        ),
      )
      .orderBy(principalContainerGrantProjection.containerId);
    for (const member of members) {
      const entry = history.get(member.stateHash);
      if (entry?.state.principalId === member.principalId)
        entry.projection.push(toStoredProjectionMember(member));
    }
    for (const grant of grants) {
      const entry = history.get(grant.stateHash);
      if (entry?.state.principalId === grant.principalId)
        entry.grants.push(toStoredPrincipalContainerGrant(grant));
    }
  }
  return [...history.values()];
}

export async function listGroupHistoryThroughHeads(
  executor: DatabaseSession,
  heads: readonly { principalId: string; version: number }[],
) {
  const states: StoredPrincipalState[] = [];
  for (let start = 0; start < heads.length; start += HISTORY_BATCH_SIZE) {
    const batch = heads.slice(start, start + HISTORY_BATCH_SIZE);
    const rows = await executor
      .select(principalStateSelect)
      .from(principalStates)
      .where(
        and(
          eq(principalStates.principalType, "group"),
          or(
            ...batch.map((head) =>
              and(
                eq(principalStates.principalId, head.principalId),
                lte(principalStates.version, head.version),
              ),
            ),
          ),
        ),
      )
      .orderBy(asc(principalStates.principalId), asc(principalStates.version));
    states.push(...rows.map(toStoredPrincipalState));
  }
  return loadHistoryArtifacts(executor, states);
}

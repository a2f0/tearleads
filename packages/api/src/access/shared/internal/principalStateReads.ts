import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  principalMembershipProjection,
  principalStatePayloads,
  principalStates,
} from "@tearleads/api-shared/schema";
import type { ManagedRecipientPrincipalType } from "@tearleads/crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { uniqueSortedStrings } from "../../../utils/array";
import { listProjectionMembersForState } from "./principalProjectionStore";
import {
  principalProjectionMemberSelect,
  principalStatePayloadSelect,
  principalStateProjectionKey,
  principalStateSelect,
  type StoredPrincipalProjectionMember,
  type StoredPrincipalState,
  type StoredPrincipalStatePayload,
  toStoredPrincipalState,
  toStoredProjectionMember,
} from "./principalStateRecords";
import {
  memoizedCurrentPrincipalState,
  rememberCurrentPrincipalState,
} from "./principalTransactionMemo";

export async function getPrincipalStateByVersion(
  principalType: ManagedRecipientPrincipalType,
  principalId: string,
  version: number,
  executor: DatabaseSession,
): Promise<StoredPrincipalState | null> {
  const [row] = await executor
    .select(principalStateSelect)
    .from(principalStates)
    .where(
      and(
        eq(principalStates.principalType, principalType),
        eq(principalStates.principalId, principalId),
        eq(principalStates.version, version),
      ),
    )
    .limit(1);

  if (!row) {
    return null;
  }

  return toStoredPrincipalState(row);
}

export async function getPrincipalStatePayloadForState(
  principalType: ManagedRecipientPrincipalType,
  principalId: string,
  stateHash: string,
  executor: DatabaseSession,
): Promise<StoredPrincipalStatePayload | null> {
  const [row] = await executor
    .select(principalStatePayloadSelect)
    .from(principalStatePayloads)
    .where(
      and(
        eq(principalStatePayloads.principalType, principalType),
        eq(principalStatePayloads.principalId, principalId),
        eq(principalStatePayloads.stateHash, stateHash),
      ),
    )
    .limit(1);

  return row ?? null;
}

export async function listPrincipalProjectionMembersForStates(
  principalType: ManagedRecipientPrincipalType,
  states: readonly Pick<StoredPrincipalState, "principalId" | "stateHash">[],
  executor: DatabaseSession,
): Promise<Map<string, StoredPrincipalProjectionMember[]>> {
  const uniquePrincipalIds = uniqueSortedStrings(
    states.map((state) => state.principalId),
  );
  const uniqueStateHashes = uniqueSortedStrings(
    states.map((state) => state.stateHash),
  );
  const requestedKeys = new Set(states.map(principalStateProjectionKey));
  const projectionByState = new Map<
    string,
    StoredPrincipalProjectionMember[]
  >();

  for (const key of requestedKeys) {
    projectionByState.set(key, []);
  }

  if (uniquePrincipalIds.length === 0 || uniqueStateHashes.length === 0) {
    return projectionByState;
  }

  const rows = await executor
    .select(principalProjectionMemberSelect)
    .from(principalMembershipProjection)
    .where(
      and(
        eq(principalMembershipProjection.principalType, principalType),
        inArray(principalMembershipProjection.principalId, uniquePrincipalIds),
        inArray(principalMembershipProjection.stateHash, uniqueStateHashes),
      ),
    )
    .orderBy(
      principalMembershipProjection.principalId,
      principalMembershipProjection.userId,
    );

  for (const row of rows.map(toStoredProjectionMember)) {
    const key = principalStateProjectionKey(row);
    const projection = projectionByState.get(key);

    if (projection) {
      projection.push(row);
    }
  }

  return projectionByState;
}

/**
 * The principal's latest state. Inside a transaction that holds the
 * principal's mutation lock, the first read is kept until the transaction
 * writes principal states again.
 */
export async function getCurrentPrincipalState(
  principalType: ManagedRecipientPrincipalType,
  principalId: string,
  executor: DatabaseSession,
): Promise<StoredPrincipalState | null> {
  const memoized = memoizedCurrentPrincipalState(
    executor,
    principalType,
    principalId,
  );
  if (memoized !== undefined) return memoized;
  const [row] = await executor
    .select(principalStateSelect)
    .from(principalStates)
    .where(
      and(
        eq(principalStates.principalType, principalType),
        eq(principalStates.principalId, principalId),
      ),
    )
    .orderBy(desc(principalStates.version))
    .limit(1);

  const state = row ? toStoredPrincipalState(row) : null;
  rememberCurrentPrincipalState(executor, principalType, principalId, state);
  return state;
}

export async function listCurrentPrincipalProjectionMembers(
  principalType: ManagedRecipientPrincipalType,
  principalId: string,
  executor: DatabaseSession,
): Promise<StoredPrincipalProjectionMember[]> {
  const currentState = await getCurrentPrincipalState(
    principalType,
    principalId,
    executor,
  );

  if (!currentState) {
    return [];
  }

  return listProjectionMembersForState(
    principalType,
    principalId,
    currentState.stateHash,
    executor,
  );
}

import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  principalStatePayloads,
  principalStates,
} from "@tearleads/api-shared/schema";
import { and, asc, eq, lte, or } from "drizzle-orm";
import {
  loadPrincipalHistoryArtifacts,
  PRINCIPAL_HISTORY_BATCH_SIZE,
} from "../../shared/internal/principalHistoryArtifacts";
import {
  principalStatePayloadSelect,
  principalStateSelect,
  type StoredPrincipalState,
  toStoredPrincipalState,
} from "../../shared/internal/principalStateRecords";

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

export async function listGroupHistoryThroughHeads(
  executor: DatabaseSession,
  heads: readonly { principalId: string; version: number }[],
) {
  const states: StoredPrincipalState[] = [];
  for (
    let start = 0;
    start < heads.length;
    start += PRINCIPAL_HISTORY_BATCH_SIZE
  ) {
    const batch = heads.slice(start, start + PRINCIPAL_HISTORY_BATCH_SIZE);
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
    for (const row of rows) states.push(toStoredPrincipalState(row));
  }
  return loadPrincipalHistoryArtifacts(executor, states);
}

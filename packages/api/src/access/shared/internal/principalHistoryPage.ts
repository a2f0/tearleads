import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { principalStates } from "@tearleads/api-shared/schema";
import type { ManagedRecipientPrincipalType } from "@tearleads/crypto";
import { and, asc, eq, gt, inArray, lte } from "drizzle-orm";
import { beginPrincipalHistoryVerification } from "../../../utils/principalHistoryWork";
import {
  loadPrincipalHistoryArtifacts,
  PRINCIPAL_HISTORY_BATCH_SIZE,
} from "./principalHistoryArtifacts";
import {
  principalStateSelect,
  readStoredPrincipalContainerGrants,
  type StoredPrincipalStateChainEntry,
  toStoredPrincipalState,
} from "./principalStateRecords";

/**
 * Read one range by version, with an inclusive head fixed by the caller.
 * These are unverified rows: callers must verify continuity and the exact head.
 * The row limit bounds history depth per read, not the size of one policy.
 * A cursor at or beyond the head is complete and returns no rows.
 */
export async function readPrincipalHistoryPage(
  executor: DatabaseSession,
  input: {
    readonly principalType: ManagedRecipientPrincipalType;
    readonly principalId: string;
    readonly afterVersion: number;
    readonly throughVersion: number;
  },
) {
  if (
    !Number.isSafeInteger(input.afterVersion) ||
    input.afterVersion < 0 ||
    !Number.isSafeInteger(input.throughVersion) ||
    input.throughVersion < 1
  )
    throw new Error("Invalid principal history range");
  if (input.afterVersion >= input.throughVersion) return [];
  beginPrincipalHistoryVerification();
  const rows = await executor
    .select({
      ...principalStateSelect,
      containerGrants: principalStates.containerGrants,
    })
    .from(principalStates)
    .where(
      and(
        eq(principalStates.principalType, input.principalType),
        eq(principalStates.principalId, input.principalId),
        gt(principalStates.version, input.afterVersion),
        lte(principalStates.version, input.throughVersion),
      ),
    )
    .orderBy(asc(principalStates.version))
    .limit(PRINCIPAL_HISTORY_BATCH_SIZE);
  return loadPrincipalHistoryArtifacts(
    executor,
    rows.map(({ containerGrants, ...row }) => ({
      state: toStoredPrincipalState(row),
      grants: readStoredPrincipalContainerGrants(containerGrants),
    })),
  );
}

/**
 * Read the entries at exactly these versions, in one state select and the
 * batched artifact loader. The caller bounds the set (a selection carries at
 * most 128 citations). Rows are unverified, and a missing version is simply
 * absent from the result: the caller decides where to raise it.
 */
export async function readPrincipalHistoryEntriesAtVersions(
  executor: DatabaseSession,
  input: {
    readonly principalType: ManagedRecipientPrincipalType;
    readonly principalId: string;
    readonly versions: readonly number[];
  },
) {
  if (
    input.versions.some(
      (version) => !Number.isSafeInteger(version) || version < 1,
    )
  )
    throw new Error("Invalid principal history version");
  const versions = [...new Set(input.versions)];
  if (versions.length === 0) return [];
  beginPrincipalHistoryVerification();
  const rows = await executor
    .select({
      ...principalStateSelect,
      containerGrants: principalStates.containerGrants,
    })
    .from(principalStates)
    .where(
      and(
        eq(principalStates.principalType, input.principalType),
        eq(principalStates.principalId, input.principalId),
        inArray(principalStates.version, versions),
      ),
    )
    .orderBy(asc(principalStates.version));
  return loadPrincipalHistoryArtifacts(
    executor,
    rows.map(({ containerGrants, ...row }) => ({
      state: toStoredPrincipalState(row),
      grants: readStoredPrincipalContainerGrants(containerGrants),
    })),
  );
}

/** Collect a complete prefix using bounded storage reads. */
export async function listPrincipalStateHistory(
  head: {
    readonly principalType: ManagedRecipientPrincipalType;
    readonly principalId: string;
    readonly version: number;
  },
  executor: DatabaseSession,
): Promise<StoredPrincipalStateChainEntry[]> {
  beginPrincipalHistoryVerification();
  const history: StoredPrincipalStateChainEntry[] = [];
  let afterVersion = 0;
  while (afterVersion < head.version) {
    const page = await readPrincipalHistoryPage(executor, {
      principalType: head.principalType,
      principalId: head.principalId,
      afterVersion,
      throughVersion: head.version,
    });
    if (page.length === 0)
      throw new Error("Stored principal history is incomplete");
    for (const entry of page) {
      if (entry.state.version !== afterVersion + 1)
        throw new Error("Stored principal history is incomplete");
      afterVersion = entry.state.version;
    }
    history.push(...page);
  }
  return history;
}

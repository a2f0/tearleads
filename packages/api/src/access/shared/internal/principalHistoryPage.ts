import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { principalStates } from "@tearleads/api-shared/schema";
import type { ManagedRecipientPrincipalType } from "@tearleads/crypto";
import { and, asc, eq, gt, lte } from "drizzle-orm";
import { beginPrincipalHistoryVerification } from "../../../utils/principalHistoryWork";
import {
  loadPrincipalHistoryArtifacts,
  PRINCIPAL_HISTORY_BATCH_SIZE,
} from "./principalHistoryArtifacts";
import {
  principalStateSelect,
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
    .select(principalStateSelect)
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
    rows.map(toStoredPrincipalState),
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
    const last = page.at(-1);
    if (!last) break;
    history.push(...page);
    afterVersion = last.state.version;
  }
  return history;
}

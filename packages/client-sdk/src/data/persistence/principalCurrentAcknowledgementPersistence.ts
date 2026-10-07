import {
  KeyingVerificationError,
  type VerifiedPrincipalPolicyCurrent,
  verifyPrincipalPolicyCheckpoint,
} from "@tearleads/crypto";
import { eq } from "drizzle-orm";
import { assertProjectionVerificationCurrent } from "../keyingProjectionVerification/types";
import { principalHistoryPrefixes } from "../sqlite/principalHistoryEvidenceSchema";
import { principalHistoryStages } from "../sqlite/principalHistoryStageSchema";
import {
  keyingCheckpointTables,
  principalPolicyTables,
} from "../sqlite/schema";
import {
  type ClientSQLiteTransactionScope,
  getClientSQLitePersistenceRuntime,
} from "../sqlite/sqlitePersistenceRuntime";
import { type ExecSql, ensureSqlTables } from "../sqlite/sqlSchema";
import {
  loadStoredPrincipalPolicyCheckpoint,
  principalPolicyKey,
  upsertPrincipalPolicyCheckpointInTransaction,
} from "./keyingCheckpointPersistence";
import { storePrincipalGrantRetirements } from "./principalGrantRetirementPersistence";
import {
  type PrincipalHistoryEvidencePage,
  writePrincipalHistoryEvidencePage,
} from "./principalHistoryEvidencePersistence";
import type { PrincipalHistoryPrefix } from "./principalHistoryPrefixPersistence";
import type { PrincipalHistoryStage } from "./principalHistoryStagePersistence";

/** Owned output of authenticated prefix extension and exact receipt verification. */
export interface AcknowledgedPrincipalCurrentPublication {
  readonly policy: VerifiedPrincipalPolicyCurrent;
  readonly prefix: PrincipalHistoryPrefix;
  readonly previousPrefixProgress: string;
  readonly stage: PrincipalHistoryStage;
  readonly evidence: PrincipalHistoryEvidencePage;
}

export interface AcknowledgedPrincipalCurrentRetirement {
  readonly principalId: string;
  readonly principalType: VerifiedPrincipalPolicyCurrent["principalType"];
  readonly containerIds: readonly string[];
}

function assertPublicationScope(
  entries: readonly AcknowledgedPrincipalCurrentPublication[],
  organizationId: string,
) {
  const seen = new Set<string>();
  for (const entry of entries) {
    const key = principalPolicyKey(entry.policy);
    if (seen.has(key))
      throw new KeyingVerificationError(
        "duplicate_entry",
        "Acknowledged current batch repeats a principal",
      );
    seen.add(key);
    if (
      entry.prefix.organizationId !== organizationId ||
      entry.stage.organizationId !== organizationId ||
      entry.evidence.organizationId !== organizationId ||
      entry.prefix.scopeId !== entry.evidence.scopeId ||
      entry.prefix.version !== entry.policy.version ||
      entry.stage.afterVersion !== entry.policy.version - 1 ||
      !entry.stage.complete ||
      entry.stage.currentJson !== entry.prefix.currentJson
    )
      throw new KeyingVerificationError(
        "object_mismatch",
        "Acknowledged current publication is outside its scope",
      );
  }
}

async function validatePublication(
  tx: ClientSQLiteTransactionScope,
  entry: AcknowledgedPrincipalCurrentPublication,
) {
  const checkpoint = await loadStoredPrincipalPolicyCheckpoint(
    tx,
    entry.policy,
  );
  verifyPrincipalPolicyCheckpoint({
    chain: entry.policy.retainedHistory,
    currentState: entry.policy.state,
    localCheckpoint: checkpoint,
  });
  if (!checkpoint || entry.policy.version > checkpoint.version + 1)
    throw new KeyingVerificationError(
      "stale_predecessor",
      "Acknowledged current policy must directly extend its durable checkpoint",
    );
  const [prefix] = await tx
    .select()
    .from(principalHistoryPrefixes)
    .where(eq(principalHistoryPrefixes.scopeId, entry.prefix.scopeId))
    .limit(1);
  if (
    prefix?.progress !== entry.previousPrefixProgress &&
    prefix?.progress !== entry.prefix.progress
  )
    throw new KeyingVerificationError(
      "stale_predecessor",
      "Authenticated principal prefix changed before acknowledgement",
    );
}

/** Store current artifacts and resumable progress in the same transaction as their pins. */
export async function persistAcknowledgedPrincipalCurrents(input: {
  readonly execSql: ExecSql;
  readonly organizationId: string;
  readonly entries: readonly AcknowledgedPrincipalCurrentPublication[];
  readonly retirements?:
    | readonly AcknowledgedPrincipalCurrentRetirement[]
    | undefined;
  readonly stillCurrent: () => boolean;
}): Promise<void> {
  const entries = structuredClone(input.entries);
  const retirements = structuredClone(input.retirements ?? []);
  const organizationId = input.organizationId;
  const stillCurrent = input.stillCurrent;
  assertPublicationScope(entries, organizationId);
  assertProjectionVerificationCurrent(stillCurrent);
  await ensureSqlTables(input.execSql, [
    ...principalPolicyTables,
    ...keyingCheckpointTables,
  ]);
  const runtime = getClientSQLitePersistenceRuntime(input.execSql);
  const stored = await runtime.guardedTransaction(
    async (tx) => {
      for (const entry of entries) await validatePublication(tx, entry);
      for (const retirement of retirements) {
        const policy = entries.find(
          (entry) =>
            entry.policy.principalId === retirement.principalId &&
            entry.policy.principalType === retirement.principalType,
        )?.policy;
        if (!policy)
          throw new KeyingVerificationError(
            "object_mismatch",
            "Retirement must accompany its acknowledged principal",
          );
        await storePrincipalGrantRetirements(
          tx,
          { ...retirement, policy, organizationId },
          entries.map((entry) => entry.policy),
          organizationId,
        );
      }
      for (const entry of entries) {
        await writePrincipalHistoryEvidencePage(tx, entry.evidence);
        await tx
          .insert(principalHistoryStages)
          .values(entry.stage)
          .onConflictDoUpdate({
            target: principalHistoryStages.id,
            set: entry.stage,
          })
          .run();
        await tx
          .insert(principalHistoryPrefixes)
          .values(entry.prefix)
          .onConflictDoUpdate({
            target: principalHistoryPrefixes.scopeId,
            set: entry.prefix,
          })
          .run();
        await upsertPrincipalPolicyCheckpointInTransaction(
          tx,
          entry.policy.checkpoint,
          new Date().toISOString(),
          organizationId,
        );
      }
    },
    stillCurrent,
    { behavior: "immediate" },
  );
  assertProjectionVerificationCurrent(() => stored.committed);
}

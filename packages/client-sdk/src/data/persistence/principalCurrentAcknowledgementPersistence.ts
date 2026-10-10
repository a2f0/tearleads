import {
  KeyingVerificationError,
  type PrincipalPolicyCheckpoint,
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
import { reclaimPrincipalHistoryNodes } from "./principalHistoryNodeRetention";
import type { PrincipalHistoryPrefix } from "./principalHistoryPrefixPersistence";
import { retainPrincipalHistoryRoot } from "./principalHistoryRootOwnership";
import type { PrincipalHistoryStage } from "./principalHistoryStagePersistence";
import {
  reclaimCompletedPrincipalHistoryStages,
  recordPrincipalHistoryStageScope,
} from "./principalHistoryStageRetention";
import { archivePrincipalHistoryKeyEnvelopes } from "./principalKeyEnvelopeArchivePersistence";

/** Owned output of authenticated prefix extension and exact receipt verification. */
export interface AcknowledgedPrincipalCurrentPublication {
  readonly policy: VerifiedPrincipalPolicyCurrent;
  readonly prefix: PrincipalHistoryPrefix;
  readonly previousPrefixProgress: string | null;
  readonly stage: PrincipalHistoryStage;
  readonly predecessorStage: PrincipalHistoryStage | null;
  readonly predecessorIndexRootHash: string | null;
  readonly evidence: PrincipalHistoryEvidencePage;
}

export interface ReconciledPrincipalCurrentPublication
  extends AcknowledgedPrincipalCurrentPublication {
  readonly preservePrefix: boolean;
  readonly observedPrefixProgress: string | null;
  readonly observedCheckpoint: PrincipalPolicyCheckpoint | null;
  readonly retainedPrefix: PrincipalHistoryPrefix;
  readonly checkpointPolicy: VerifiedPrincipalPolicyCurrent;
}

/** A local writer won the CAS; retry the same authenticated receipt without HTTP. */
export class PrincipalAcknowledgementChangedError extends Error {
  constructor() {
    super(
      "Authenticated principal progress changed during acknowledgement; retry retention",
    );
    this.name = "PrincipalAcknowledgementChangedError";
  }
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
      (entry.predecessorStage === null) !==
        (entry.predecessorIndexRootHash === null) ||
      entry.stage.organizationId !== organizationId ||
      (entry.predecessorStage
        ? entry.predecessorStage.organizationId !== organizationId ||
          !entry.predecessorStage.complete ||
          entry.predecessorStage.afterVersion !== entry.policy.version - 2
        : entry.policy.principalType !== "group" ||
          entry.policy.version !== 1 ||
          entry.policy.state.prevStateHash !== null ||
          entry.previousPrefixProgress !== null) ||
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
  entry: ReconciledPrincipalCurrentPublication,
) {
  const checkpoint = await loadStoredPrincipalPolicyCheckpoint(
    tx,
    entry.policy,
  );
  if (
    checkpoint?.version !== entry.observedCheckpoint?.version ||
    checkpoint?.stateHash !== entry.observedCheckpoint?.stateHash
  )
    throw new PrincipalAcknowledgementChangedError();
  verifyPrincipalPolicyCheckpoint({
    chain: entry.checkpointPolicy.retainedHistory,
    currentState: entry.checkpointPolicy.state,
    localCheckpoint: checkpoint,
  });
  if (
    (!checkpoint && entry.policy.version !== 1) ||
    (checkpoint && entry.policy.version > checkpoint.version + 1)
  )
    throw new KeyingVerificationError(
      "stale_predecessor",
      "Acknowledged current policy must directly extend its durable checkpoint",
    );
  const [prefix] = await tx
    .select()
    .from(principalHistoryPrefixes)
    .where(eq(principalHistoryPrefixes.scopeId, entry.prefix.scopeId))
    .limit(1);
  if ((prefix?.progress ?? null) !== entry.observedPrefixProgress)
    throw new PrincipalAcknowledgementChangedError();
}

async function archiveAcknowledgedStageKeys(
  tx: ClientSQLiteTransactionScope,
  entry: AcknowledgedPrincipalCurrentPublication,
) {
  for (const stage of [entry.predecessorStage, entry.stage]) {
    if (!stage) continue;
    await recordPrincipalHistoryStageScope(tx, {
      id: stage.id,
      afterVersion: stage.afterVersion,
      complete: stage.complete,
      organizationId: entry.prefix.organizationId,
      scopeId: entry.prefix.scopeId,
    });
    await archivePrincipalHistoryKeyEnvelopes(tx, {
      ...stage,
      version: stage.afterVersion + 1,
    });
  }
}

async function retainPredecessorStage(
  tx: ClientSQLiteTransactionScope,
  entry: AcknowledgedPrincipalCurrentPublication,
) {
  // Preserve a prefix-only predecessor without replacing an existing completion.
  if (!entry.predecessorStage || !entry.predecessorIndexRootHash) return;
  const inserted = await tx
    .insert(principalHistoryStages)
    .values(entry.predecessorStage)
    .onConflictDoUpdate({
      target: principalHistoryStages.id,
      set: entry.predecessorStage,
      setWhere: eq(principalHistoryStages.complete, false),
    })
    .returning({ id: principalHistoryStages.id });
  if (inserted.length > 0)
    await retainPrincipalHistoryRoot(tx, {
      id: `stage:${entry.predecessorStage.id}`,
      scopeId: entry.prefix.scopeId,
      organizationId: entry.prefix.organizationId,
      rootHash: entry.predecessorIndexRootHash,
    });
}

/** Store current artifacts and resumable progress in the same transaction as their pins. */
export async function persistAcknowledgedPrincipalCurrents(input: {
  readonly execSql: ExecSql;
  readonly organizationId: string;
  readonly entries: readonly ReconciledPrincipalCurrentPublication[];
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
        await retainPredecessorStage(tx, entry);
        // A fully authenticated publication supersedes an in-flight stage for
        // this exact head. Its other writer fails its progress CAS and resumes.
        await tx
          .insert(principalHistoryStages)
          .values(entry.stage)
          .onConflictDoUpdate({
            target: principalHistoryStages.id,
            set: entry.stage,
          })
          .run();
        await archiveAcknowledgedStageKeys(tx, entry);
        if (!entry.preservePrefix)
          await tx
            .insert(principalHistoryPrefixes)
            .values(entry.prefix)
            .onConflictDoUpdate({
              target: principalHistoryPrefixes.scopeId,
              set: entry.prefix,
            })
            .run();
        await retainPrincipalHistoryRoot(tx, {
          id: `stage:${entry.stage.id}`,
          scopeId: entry.prefix.scopeId,
          organizationId,
          rootHash: entry.evidence.indexRootHash,
        });
        if (!entry.preservePrefix)
          await retainPrincipalHistoryRoot(tx, {
            id: `prefix:${entry.prefix.scopeId}`,
            scopeId: entry.prefix.scopeId,
            organizationId,
            rootHash: entry.evidence.indexRootHash,
          });
        await reclaimCompletedPrincipalHistoryStages(tx, entry.retainedPrefix);
        await reclaimPrincipalHistoryNodes(tx, entry.retainedPrefix);
        if (
          !entry.observedCheckpoint ||
          entry.observedCheckpoint.version < entry.policy.version
        )
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

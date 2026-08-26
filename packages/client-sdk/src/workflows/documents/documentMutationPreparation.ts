import { mergeVersionVectors, satisfiesVersionVector } from "@symcrypt/loro";
import { canWriteEffectiveAccessLevel } from "../../data/accessLevel";
import {
  type DocumentSyncPullContinuation,
  documentSyncPullContinuationsEqual,
} from "../../data/documents/shared/syncPagination";
import type {
  DocumentsPersistence,
  StoredDocumentRecord,
} from "../../data/persistence/documents/documentsPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { mergePersistedDocumentHistory } from "./historyContent";

export interface ExpectedDocumentSyncState {
  pullContinuation: DocumentSyncPullContinuation | null;
  record: StoredDocumentRecord;
}

export interface PrepareDocumentMutationInput {
  currentDoc: Parameters<typeof mergePersistedDocumentHistory>[0]["doc"];
  currentRecord: StoredDocumentRecord | null;
  expectedSyncState?: ExpectedDocumentSyncState | undefined;
  historyCheckpoint?:
    | {
        coveredTailIds: readonly string[];
        endVersionVector: string;
        pruneCoveredLocalState: boolean;
        snapshot: string;
      }
    | undefined;
  historyUpdateOrigin?: "local" | "remote" | undefined;
  historyUpdates?: readonly string[] | undefined;
  localId: string;
  persistence: DocumentsPersistence;
}

function sameNullableDocumentValue(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  return (left ?? null) === (right ?? null);
}

export function documentSyncSecurityContextMatches(
  current: StoredDocumentRecord | null,
  expected: StoredDocumentRecord,
): boolean {
  return (
    current !== null &&
    current.id === expected.id &&
    current.documentId === expected.documentId &&
    current.containerId === expected.containerId &&
    current.accessEpoch === expected.accessEpoch &&
    sameNullableDocumentValue(
      current.accessStateHash,
      expected.accessStateHash,
    ) &&
    (current.effectiveAccessLevel ?? null) ===
      (expected.effectiveAccessLevel ?? null) &&
    sameNullableDocumentValue(
      current.contentKeyBundle,
      expected.contentKeyBundle,
    ) &&
    sameNullableDocumentValue(
      current.documentKekTargets,
      expected.documentKekTargets,
    ) &&
    sameNullableDocumentValue(
      current.documentManifestBundle,
      expected.documentManifestBundle,
    )
  );
}

function patchSpecifiesContainer(
  patch: Partial<StoredDocumentRecord>,
): boolean {
  return Object.hasOwn(patch, "containerId");
}

function documentSyncStateDiffers(
  current: StoredDocumentRecord,
  cached: StoredDocumentRecord,
): boolean {
  return (
    !sameNullableDocumentValue(current.lastCommitLsn, cached.lastCommitLsn) ||
    current.snapshotEndVersion !== cached.snapshotEndVersion ||
    !sameNullableDocumentValue(
      current.pendingBaseVersion,
      cached.pendingBaseVersion,
    ) ||
    !documentSyncPullContinuationsEqual(
      current.pullContinuation,
      cached.pullContinuation,
    ) ||
    Boolean(current.pullContinuationRecoveryRequired) !==
      Boolean(cached.pullContinuationRecoveryRequired)
  );
}

function mergeMutationFrontiers(
  patch: Partial<StoredDocumentRecord>,
  durableRecord: StoredDocumentRecord,
): Partial<StoredDocumentRecord> {
  const nextPatch = { ...patch };
  if (patch.snapshotEndVersion !== undefined) {
    nextPatch.snapshotEndVersion = mergeVersionVectors([
      durableRecord.snapshotEndVersion,
      patch.snapshotEndVersion,
    ]);
  }
  if (
    patch.pendingBaseVersion !== undefined &&
    patch.pendingBaseVersion !== null &&
    durableRecord.pendingBaseVersion
  ) {
    nextPatch.pendingBaseVersion = mergeVersionVectors([
      durableRecord.pendingBaseVersion,
      patch.pendingBaseVersion,
    ]);
  }
  return nextPatch;
}

function ordinarySaveNeedsHistoryRebase(
  input: PrepareDocumentMutationInput,
  durableRecord: StoredDocumentRecord | null,
): boolean {
  if (
    input.expectedSyncState !== undefined ||
    durableRecord === null ||
    input.currentRecord === null
  ) {
    return false;
  }
  const cachedPendingBase = input.currentRecord.pendingBaseVersion;
  const durableCoversCachedPendingBase =
    !cachedPendingBase ||
    (durableRecord.pendingBaseVersion !== null &&
      durableRecord.pendingBaseVersion !== undefined &&
      satisfiesVersionVector(
        durableRecord.pendingBaseVersion,
        cachedPendingBase,
      ));
  return (
    durableRecord.id === input.currentRecord.id &&
    durableRecord.documentId === input.currentRecord.documentId &&
    satisfiesVersionVector(
      durableRecord.snapshotEndVersion,
      input.currentRecord.snapshotEndVersion,
    ) &&
    durableCoversCachedPendingBase &&
    documentSyncStateDiffers(durableRecord, input.currentRecord)
  );
}

function ordinarySaveIdentityWasReplaced(
  input: PrepareDocumentMutationInput,
  durableRecord: StoredDocumentRecord | null,
): boolean {
  return (
    input.expectedSyncState === undefined &&
    input.currentRecord !== null &&
    durableRecord !== null &&
    (durableRecord.id !== input.currentRecord.id ||
      durableRecord.documentId !== input.currentRecord.documentId)
  );
}

function ordinarySaveWriteAccessWasRevoked(
  input: PrepareDocumentMutationInput,
  durableRecord: StoredDocumentRecord | null,
): boolean {
  return (
    input.expectedSyncState === undefined &&
    input.currentRecord !== null &&
    durableRecord !== null &&
    canWriteEffectiveAccessLevel(input.currentRecord.effectiveAccessLevel) &&
    !canWriteEffectiveAccessLevel(durableRecord.effectiveAccessLevel)
  );
}

function recoveryGenerationWasSuperseded(
  input: PrepareDocumentMutationInput,
  durableRecord: StoredDocumentRecord | null,
): boolean {
  return (
    input.currentRecord !== null &&
    durableRecord !== null &&
    (input.currentRecord.recoveryGeneration ?? 0) !==
      (durableRecord.recoveryGeneration ?? 0)
  );
}

function resolveSyncSettlementState(
  current: StoredDocumentRecord | null,
  expected: ExpectedDocumentSyncState | undefined,
): { pullContinuationSuperseded: boolean; securityContextMatches: boolean } {
  if (!expected) {
    return { pullContinuationSuperseded: false, securityContextMatches: true };
  }
  const securityContextMatches = documentSyncSecurityContextMatches(
    current,
    expected.record,
  );
  const contentFrontiersMatch =
    sameNullableDocumentValue(
      current?.lastCommitLsn,
      expected.record.lastCommitLsn,
    ) &&
    current?.snapshotEndVersion === expected.record.snapshotEndVersion &&
    sameNullableDocumentValue(
      current?.pendingBaseVersion,
      expected.record.pendingBaseVersion,
    );
  const recoveryStateMatches =
    Boolean(current?.pullContinuationRecoveryRequired) ===
      Boolean(expected.record.pullContinuationRecoveryRequired) &&
    (current?.recoveryGeneration ?? 0) ===
      (expected.record.recoveryGeneration ?? 0);
  return {
    pullContinuationSuperseded:
      !securityContextMatches ||
      !contentFrontiersMatch ||
      !recoveryStateMatches ||
      !documentSyncPullContinuationsEqual(
        current?.pullContinuation,
        expected.pullContinuation,
      ),
    securityContextMatches,
  };
}

export async function prepareDocumentMutation(
  input: PrepareDocumentMutationInput,
  execSql: ExecSql,
  patch: Partial<StoredDocumentRecord>,
) {
  const durableCurrentRecord = await input.persistence.loadDocument(
    execSql,
    input.localId,
  );
  const creationSuperseded =
    input.currentRecord === null && durableCurrentRecord !== null;
  const mutationCurrentRecord = durableCurrentRecord ?? input.currentRecord;
  const identityWasReplaced = ordinarySaveIdentityWasReplaced(
    input,
    durableCurrentRecord,
  );
  const writeAccessWasRevoked = ordinarySaveWriteAccessWasRevoked(
    input,
    durableCurrentRecord,
  );
  const recoveryWasSuperseded = recoveryGenerationWasSuperseded(
    input,
    durableCurrentRecord,
  );
  const { pullContinuationSuperseded, securityContextMatches } =
    creationSuperseded || identityWasReplaced || writeAccessWasRevoked
      ? { pullContinuationSuperseded: true, securityContextMatches: false }
      : recoveryWasSuperseded
        ? { pullContinuationSuperseded: true, securityContextMatches: true }
        : resolveSyncSettlementState(
            mutationCurrentRecord,
            input.expectedSyncState,
          );
  const ordinarySaveNeedsRebase = ordinarySaveNeedsHistoryRebase(
    input,
    durableCurrentRecord,
  );

  if (ordinarySaveNeedsRebase && securityContextMatches) {
    await mergePersistedDocumentHistory({
      doc: input.currentDoc,
      execSql,
      localId: input.localId,
      persistence: input.persistence,
    });
  }
  const mutationPatch = pullContinuationSuperseded
    ? {}
    : ordinarySaveNeedsRebase && durableCurrentRecord
      ? mergeMutationFrontiers(patch, durableCurrentRecord)
      : patch;
  const authoritativeContainer = patchSpecifiesContainer(mutationPatch)
    ? undefined
    : await input.persistence.loadDocumentContainer(execSql, input.localId);
  return {
    creationSuperseded,
    mutationCurrentRecord,
    pullContinuationSuperseded,
    resolvedPatch:
      authoritativeContainer === undefined
        ? mutationPatch
        : { ...mutationPatch, containerId: authoritativeContainer.containerId },
    securityContextMatches,
  };
}

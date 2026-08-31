import { base64ToBytes } from "@symcrypt/encoding";
import { importUpdates } from "@symcrypt/loro";
import {
  type DocumentSyncPullContinuation,
  documentSyncPullContinuationsEqual,
} from "../../data/documents/shared/syncPagination";
import type { ContainerContentsPersistence } from "../../data/persistence/container-contents/containerContentsPersistence";
import { runSerializedSqlMutation } from "../../data/sqlite/sqlSchema";
import { currentMetadataPullContinuation } from "./metadataPersistence";
import type { ContainerMetadataState } from "./metadataTypes";
import type { ContainerContentsWorkflowSqlRuntime } from "./runtime";

function metadataInvalidationStateMatches(input: {
  accessEpoch: number;
  continuation: DocumentSyncPullContinuation;
  documentId: string;
  durableRecord: NonNullable<
    Awaited<
      ReturnType<ContainerContentsPersistence["loadContainerMetadataRecord"]>
    >
  >;
  metadataState: ContainerMetadataState;
}): boolean {
  const {
    accessEpoch,
    continuation,
    documentId,
    durableRecord,
    metadataState,
  } = input;
  return (
    metadataState.record.documentId === documentId &&
    metadataState.record.accessEpoch === accessEpoch &&
    durableRecord.documentId === documentId &&
    durableRecord.accessEpoch === accessEpoch &&
    (durableRecord.accessStateHash ?? null) ===
      (metadataState.record.accessStateHash ?? null) &&
    (durableRecord.contentKeyBundle ?? null) ===
      (metadataState.record.contentKeyBundle ?? null) &&
    (durableRecord.documentKekTargets ?? null) ===
      (metadataState.record.documentKekTargets ?? null) &&
    (durableRecord.documentManifestBundle ?? null) ===
      (metadataState.record.documentManifestBundle ?? null) &&
    documentSyncPullContinuationsEqual(
      currentMetadataPullContinuation(metadataState),
      continuation,
    )
  );
}

export async function invalidateContainerMetadataPullContinuation(input: {
  continuation: DocumentSyncPullContinuation;
  isCurrent?: (() => boolean) | undefined;
  metadataState: ContainerMetadataState;
  persistence: ContainerContentsPersistence;
  runtime: ContainerContentsWorkflowSqlRuntime;
}): Promise<void> {
  const { continuation, metadataState, runtime } = input;
  if (input.isCurrent?.() === false) return;
  const { accessEpoch, documentId } = metadataState.record;
  if (!documentId) return;

  await runSerializedSqlMutation(
    runtime.infra.execSql,
    async (lockedExecSql) => {
      const durableRecord =
        await input.persistence.invalidateMetadataPullContinuation(
          lockedExecSql,
          {
            accessEpoch,
            accessStateHash: metadataState.record.accessStateHash ?? null,
            continuation,
            containerId: metadataState.container.id,
            contentKeyBundle: metadataState.record.contentKeyBundle ?? null,
            documentId,
            documentKekTargets: metadataState.record.documentKekTargets ?? null,
            documentManifestBundle:
              metadataState.record.documentManifestBundle ?? null,
            lastCommitLsn: metadataState.record.lastCommitLsn ?? null,
          },
        );
      if (
        input.isCurrent?.() === false ||
        !durableRecord ||
        !metadataInvalidationStateMatches({
          accessEpoch,
          continuation,
          documentId,
          durableRecord,
          metadataState,
        })
      ) {
        return;
      }
      if (durableRecord.metadataUpdates) {
        importUpdates(metadataState.doc, [
          base64ToBytes(durableRecord.metadataUpdates),
        ]);
      }
      const {
        pullContinuation: _stalePullContinuation,
        pullContinuationRecoveryRequired: _staleRecoveryMarker,
        ...liveRecord
      } = metadataState.record;
      metadataState.record = { ...liveRecord, ...durableRecord };
      metadataState.pullContinuation = durableRecord.pullContinuation ?? null;
    },
  );
}

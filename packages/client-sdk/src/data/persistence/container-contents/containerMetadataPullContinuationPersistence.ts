import { invalidateDocumentSyncPullContinuation } from "../../sqlite/documentPersistence";
import { getClientSQLitePersistenceRuntime } from "../../sqlite/sqlitePersistenceRuntime";
import { runSerializedSqlMutation } from "../../sqlite/sqlSchema";
import type { ContainerContentsPersistence } from "./containerContentsPersistenceTypes";
import { selectContainerMetadataRecord } from "./containerMetadataRows";
import { CONTAINER_METADATA_APP_KIND } from "./dormantContainerMetadata";

type MetadataPullContinuationPersistence = Pick<
  ContainerContentsPersistence,
  "invalidateMetadataPullContinuation"
>;

export const containerMetadataPullContinuationPersistence: MetadataPullContinuationPersistence =
  {
    async invalidateMetadataPullContinuation(execSql, input) {
      return runSerializedSqlMutation(execSql, async (lockedExecSql) =>
        getClientSQLitePersistenceRuntime(lockedExecSql).transaction(
          async () => {
            await invalidateDocumentSyncPullContinuation(lockedExecSql, {
              accessEpoch: input.accessEpoch,
              accessStateHash: input.accessStateHash,
              appKind: CONTAINER_METADATA_APP_KIND,
              continuation: input.continuation,
              contentKeyBundle: input.contentKeyBundle,
              documentId: input.documentId,
              documentKekTargets: input.documentKekTargets,
              documentManifestBundle: input.documentManifestBundle,
              lastCommitLsn: input.lastCommitLsn,
              localId: input.containerId,
            });
            return selectContainerMetadataRecord(
              lockedExecSql,
              input.containerId,
            );
          },
        ),
      );
    },
  };

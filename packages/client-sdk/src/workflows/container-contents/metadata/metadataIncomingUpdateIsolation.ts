import type { SyncRemoteDocumentResult } from "../../../data/documents/shared/sync/documentSyncTypes";
import { importDecryptedDocumentSyncUpdates } from "../../../data/documents/shared/sync/documentSyncUpdateImport";
import type { DocumentSyncUpdateIsolationError } from "../../../data/documents/shared/sync/documentSyncUpdateIsolation";
import { CONTAINER_METADATA_APP_KIND } from "../../../data/persistence/container-contents/containerContentsPersistence";
import { DocumentRecordRepository } from "../../../data/persistence/documents/records";
import { getClientSQLitePersistenceRuntime } from "../../../data/sqlite/sqlitePersistenceRuntime";
import {
  type ExecSql,
  runSerializedSqlMutation,
} from "../../../data/sqlite/sqlSchema";
import {
  judgeDocumentSyncImports,
  recordUncursoredDocumentSyncVerdicts,
} from "../../documents/sync/processedCursor";
import { reportDocumentSyncQuarantine } from "../../documents/sync/reportDocumentSyncQuarantine";
import type { WorkflowRuntimeUtilInput } from "../../shared/runtimeInput";
import type { ContainerMetadataState } from "./metadataTypes";

export async function recordCurrentMetadataSyncFailure(input: {
  execSql: ExecSql;
  failure: {
    readonly attemptedAt: string;
    readonly message: string;
    readonly status: number | null;
  };
  isCurrent?: (() => boolean) | undefined;
  metadataScope: { appKind: string; localId: string };
}): Promise<void> {
  await runSerializedSqlMutation(input.execSql, async (lockedExecSql) => {
    await getClientSQLitePersistenceRuntime(lockedExecSql).guardedTransaction(
      async () => {
        if (input.isCurrent?.() === false) return;
        await new DocumentRecordRepository(
          lockedExecSql,
        ).recordDocumentSyncFailure(input.metadataScope, input.failure);
      },
      () => input.isCurrent?.() !== false,
    );
  });
}

/**
 * Records and reports a metadata pass's voids once its state is saved. A
 * page a later save superseded was never settled, so its follow-up judges it
 * again and nothing is recorded. Metadata keeps no processed cursor, so its
 * voids are served and judged again on every pull; each is reported only
 * when first recorded. The rows only spare later passes an import, so a
 * failure to record them is logged rather than failing a pass whose state is
 * already saved.
 */
export async function recordContainerMetadataVoids(
  pass: {
    readonly isCurrent: () => boolean;
    readonly runtime: {
      readonly infra: { readonly execSql: ExecSql };
      readonly util: {
        readonly logError?: WorkflowRuntimeUtilInput["logError"] | undefined;
      };
    };
  },
  persisted: {
    readonly pullContinuationSuperseded?: boolean | undefined;
    readonly record: { readonly id: string };
  },
  synced: SyncRemoteDocumentResult,
): Promise<void> {
  if (persisted.pullContinuationSuperseded === true) return;
  const localId = persisted.record.id;
  const { logError } = pass.runtime.util;
  try {
    await recordUncursoredDocumentSyncVerdicts({
      execSql: pass.runtime.infra.execSql,
      isCurrent: pass.isCurrent,
      logError,
      scope: { appKind: CONTAINER_METADATA_APP_KIND, localId },
      synced,
    });
  } catch (error) {
    await Promise.resolve()
      .then(() =>
        logError?.("Container metadata: verdicts not recorded", error),
      )
      .catch(() => undefined);
  }
}

export function applyIncomingContainerMetadataUpdates(
  currentDocument: ContainerMetadataState["doc"],
  result: Pick<SyncRemoteDocumentResult, "decryptedUpdates">,
): void {
  importDecryptedDocumentSyncUpdates(currentDocument, result.decryptedUpdates);
}

export function metadataIncomingUpdateIsolation(input: {
  currentDocument: ContainerMetadataState["doc"];
  execSql: ExecSql;
  isCurrent?: (() => boolean) | undefined;
  logError?: WorkflowRuntimeUtilInput["logError"] | undefined;
  metadataScope: { appKind: string; localId: string };
}) {
  return {
    onIncomingUpdateIsolationFailure: async (
      failure: DocumentSyncUpdateIsolationError,
    ) => {
      await recordCurrentMetadataSyncFailure({
        ...input,
        failure: {
          attemptedAt: new Date().toISOString(),
          message: failure.message,
          status: null,
        },
      });
      if (input.isCurrent?.() === false) return;
      reportDocumentSyncQuarantine(
        input.currentDocument,
        input.logError,
        failure,
      );
    },
    validateIncomingUpdates: (
      result: Pick<
        SyncRemoteDocumentResult,
        "contentKeyFingerprintsByEpoch" | "decryptedUpdates" | "response"
      >,
    ) =>
      judgeDocumentSyncImports({
        currentDocument: input.currentDocument,
        execSql: input.execSql,
        result,
        scope: input.metadataScope,
      }),
  };
}

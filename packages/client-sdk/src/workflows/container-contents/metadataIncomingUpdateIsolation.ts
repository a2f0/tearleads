import {
  importDecryptedDocumentSyncUpdates,
  validateDocumentSyncUpdateImports,
} from "../../data/documents/shared/documentSyncUpdateIsolation";
import type { SyncRemoteDocumentResult } from "../../data/documents/shared/types";
import { recordDocumentSyncFailure } from "../../data/sqlite/documentPersistence";
import {
  type ExecSql,
  runSerializedSqlMutation,
} from "../../data/sqlite/sqlSchema";
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
    if (input.isCurrent?.() === false) return;
    await recordDocumentSyncFailure(
      lockedExecSql,
      input.metadataScope,
      input.failure,
    );
  });
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
  metadataScope: { appKind: string; localId: string };
}) {
  return {
    onIncomingUpdateIsolationFailure: async (failure: {
      readonly message: string;
    }) => {
      await recordCurrentMetadataSyncFailure({
        ...input,
        failure: {
          attemptedAt: new Date().toISOString(),
          message: failure.message,
          status: null,
        },
      });
    },
    validateIncomingUpdates: (
      result: Pick<SyncRemoteDocumentResult, "decryptedUpdates" | "response">,
    ) =>
      validateDocumentSyncUpdateImports({
        currentDocument: input.currentDocument,
        decryptedUpdates: result.decryptedUpdates,
        responseUpdates: result.response.updates,
      }),
  };
}

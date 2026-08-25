import {
  importDecryptedDocumentSyncUpdates,
  validateDocumentSyncUpdateImports,
} from "../../data/documents/shared/documentSyncUpdateIsolation";
import type { SyncRemoteDocumentResult } from "../../data/documents/shared/types";
import { recordDocumentSyncFailure } from "../../data/sqlite/documentPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import type { ContainerMetadataState } from "./metadataTypes";

export function applyIncomingContainerMetadataUpdates(
  currentDocument: ContainerMetadataState["doc"],
  result: Pick<SyncRemoteDocumentResult, "decryptedUpdates">,
): void {
  importDecryptedDocumentSyncUpdates(currentDocument, result.decryptedUpdates);
}

export function metadataIncomingUpdateIsolation(input: {
  currentDocument: ContainerMetadataState["doc"];
  execSql: ExecSql;
  metadataScope: { appKind: string; localId: string };
}) {
  return {
    onIncomingUpdateIsolationFailure: (failure: { readonly message: string }) =>
      recordDocumentSyncFailure(input.execSql, input.metadataScope, {
        attemptedAt: new Date().toISOString(),
        message: failure.message,
        status: null,
      }),
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

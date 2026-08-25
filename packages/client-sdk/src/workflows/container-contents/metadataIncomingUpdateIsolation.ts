import type { SyncRemoteDocumentResult } from "../../data/documents/shared/types";
import { recordDocumentSyncFailure } from "../../data/sqlite/documentPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { validateDocumentSyncUpdateImports } from "../documents";
import type { ContainerMetadataState } from "./metadataTypes";

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

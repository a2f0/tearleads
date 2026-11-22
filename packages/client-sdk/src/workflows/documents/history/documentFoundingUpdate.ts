import { createReadOnlyDocument, importUpdates } from "@tearleads/loro";
import { readSeedTag } from "../../../data/documents/documentContent";
import { readWriteHeader } from "../../../data/documents/shared/readers";
import { validateDocumentSyncUpdateImports } from "../../../data/documents/shared/sync/documentSyncImportVerdicts";
import { processLoroRuntimeFailures } from "../../../data/documents/shared/sync/loroRuntimeFailureLedger";
import { resolveDocumentCreateAuthor } from "../author";
import { defaultDocumentsPersistence } from "../persistence";
import { createDocumentProjectionUserKeyResolver } from "../projectionKeys";
import { RemoteDocumentService } from "../remote/remoteDocumentService";
import type { DocumentsWorkflowRuntime } from "../runtime";
import { createDocumentWriterPublicKeyResolver } from "../writerKeys";
import {
  type DocumentHistoryView,
  readDocumentHistoryView,
} from "./documentHistory";

/** The first update the server committed for a document, replayed alone. */
export interface DocumentFoundingUpdate {
  /** The document as that update alone left it. */
  readonly content: DocumentHistoryView;
  /** The seed fingerprint that update wrote, if any. */
  readonly seedTag: string | undefined;
  /** The user whose signature on that update this device verified. */
  readonly writerUserId: string;
}

/**
 * Read a synced document's founding update: the first update in the server's
 * commit order, which a seeded create commits in its own transaction. Later
 * edits cannot change it, so it shows what the document was created with even
 * after another device rewrites the same fields. One raw-history page is
 * pulled, verified like any sync page, and replayed in a scratch document;
 * nothing is persisted or applied to an open store.
 *
 * Resolves to null when there is no founding update to read: the document has
 * no remote record or updates, the device is offline or lacks keys, the scope
 * changed, or the first committed update is a rotation baseline.
 */
export async function readDocumentFoundingUpdate(input: {
  readonly localId: string;
  readonly runtime: DocumentsWorkflowRuntime;
  readonly stillCurrent: () => boolean;
}): Promise<DocumentFoundingUpdate | null> {
  const { runtime, stillCurrent } = input;
  const { execSql } = runtime.infra;
  const record = await defaultDocumentsPersistence.loadDocument(
    execSql,
    input.localId,
  );
  const author = resolveDocumentCreateAuthor(runtime);
  const keys = runtime.crypto.encapsulationKeyPair;
  if (
    !record?.documentId ||
    !author ||
    !keys ||
    !runtime.state.online ||
    !stillCurrent()
  )
    return null;
  const scratch = createReadOnlyDocument();
  try {
    const synced = await new RemoteDocumentService({
      api: runtime.apiClient,
      encapsulationSecretKey: keys.secretKey,
      execSql,
      isRemoteSyncBlocked: runtime.util.isRemoteSyncBlocked,
    }).syncRemoteDocument({
      author,
      documentId: record.documentId,
      historyMode: "raw",
      localVersionVector: null,
      minLsn: record.lastCommitLsn ?? undefined,
      pendingUpdates: [],
      persistedState: record,
      resolveProjectionUserKey:
        createDocumentProjectionUserKeyResolver(runtime),
      resolveWriterPublicKey: createDocumentWriterPublicKeyResolver({
        logPrefix: "Documents",
        runtime,
        writerKeyLabel: "writer key",
      }),
      stillCurrent,
      // Only the first update is replayed, so only it must import alone. A
      // founding view records no runtime attempts.
      validateIncomingUpdates: ({ decryptedUpdates, response }) =>
        validateDocumentSyncUpdateImports({
          currentDocument: scratch,
          decryptedUpdates: decryptedUpdates.slice(0, 1),
          responseUpdates: response.updates.slice(0, 1),
          runtimeLedger: processLoroRuntimeFailures.unrecorded(),
        }),
      warmReferencedPrincipalPolicies: runtime.principalPolicies.createWarmer(),
    });
    const first = synced?.response.updates[0];
    const update = synced?.decryptedUpdates[0];
    if (
      !first ||
      update?.id !== first.id ||
      update.checkpointKind !== undefined ||
      !stillCurrent()
    )
      return null;
    importUpdates(scratch, [update.updateData]);
    return {
      content: readDocumentHistoryView(
        scratch,
        runtime.infra.documentProjectors,
      ),
      seedTag: readSeedTag(scratch),
      writerUserId: readWriteHeader(
        first.writeHeader,
        "Document founding update write header",
      ).writerUserId,
    };
  } finally {
    scratch.free();
  }
}

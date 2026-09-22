import type { TestUser } from "@tearleads/bob-and-alice";
import {
  syncRemoteDocument,
  validateDocumentSyncUpdateImports,
} from "@tearleads/client-sdk";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  createDocument,
  encodeVersionVector,
  exportFullHistorySnapshot,
  exportUpdatesSince,
  getTextValue,
  getUpdateVersionVectors,
  importUpdates,
} from "@tearleads/loro";
import type { DocumentSyncRequest } from "@tearleads/validators/request";
import { createAncestorSdkContext } from "./ancestorSdkRepair";
import { writerResolver } from "./coldSdkRematerialization";

/**
 * One cold device belonging to a writer, holding a single queued edit it can
 * attempt repeatedly: the first attempt may park behind an ancestor repair the
 * writer cannot perform, and a later one on the same device must succeed.
 */
export async function createLeafWriterAncestorEdit(input: {
  documentId: string;
  organizationId: string;
  /** Anyone else granted along the path, whose wraps the writer verifies. */
  otherGrantees?: readonly TestUser[];
  owner: TestUser;
  writer: TestUser;
}) {
  const context = await createAncestorSdkContext(
    input.writer,
    input.organizationId,
    input.owner,
    ...(input.otherGrantees ?? []),
  );
  const document = await createDocument(`leaf-edit-${crypto.randomUUID()}`);
  const abandoned: string[] = [];
  const requests: DocumentSyncRequest[] = [];
  const standaloneRepairs: string[] = [];
  const terminalCodes: Array<string | undefined> = [];
  // The SDK prefers the status-bearing rekey, so that is the call to observe.
  const rekeyResult = context.common.apiClient.rekeyContainerResult?.bind(
    context.common.apiClient,
  );
  if (!rekeyResult) throw new Error("Expected a status-bearing rekey");
  context.common.apiClient.rekeyContainerResult = (id, request) => {
    standaloneRepairs.push(id);
    return rekeyResult(id, request);
  };
  const submit = context.common.apiClient.syncDocument.bind(
    context.common.apiClient,
  );
  context.common.apiClient.syncDocument = (id, request) => {
    requests.push(request);
    return submit(id, request);
  };
  const syncInput = {
    ...context.common,
    documentId: input.documentId,
    localVersionVector: null,
    onSyncAbandoned: (reason: string) => {
      abandoned.push(reason);
    },
    onTerminalSubmitFailure: (failure: { code?: string | undefined }) => {
      terminalCodes.push(failure.code);
    },
    resolveWriterPublicKey: async (reference: {
      writerSigningKeyFingerprint: string;
      writerUserId: string;
    }) =>
      (await writerResolver(input.owner)(reference)) ??
      writerResolver(input.writer)(reference),
    validateIncomingUpdates: (({ decryptedUpdates, response }) =>
      validateDocumentSyncUpdateImports({
        currentDocument: document,
        decryptedUpdates,
        responseUpdates: response.updates,
      })) satisfies Parameters<
      typeof syncRemoteDocument
    >[0]["validateIncomingUpdates"],
  };
  const read = await syncRemoteDocument(syncInput);
  if (!read) throw new Error("Expected cold ancestor recovery read");
  importUpdates(
    document,
    read.decryptedUpdates.map((update) => update.updateData),
  );
  const recoveredText = getTextValue(document);
  const before = encodeVersionVector(document);
  document.getText("text").update(`${recoveredText}; edited after rotation`);
  const updateData = exportUpdatesSince(document, before);
  const vectors = getUpdateVersionVectors(updateData);
  const updateId = crypto.randomUUID();
  return {
    abandoned,
    /** Null when the pass abandoned and left the edit queued. */
    attemptWrite: async (): Promise<{
      settledPendingUpdateIds: readonly string[];
    } | null> => {
      const written = await syncRemoteDocument({
        ...syncInput,
        buildRotationSnapshot: async () => exportFullHistorySnapshot(document),
        pendingUpdates: [
          {
            id: updateId,
            partialEndVersionVector: vectors.partialEndVersionVector,
            partialStartVersionVector: vectors.partialStartVersionVector,
            updateData: bytesToBase64(updateData),
          },
        ],
      });
      return written
        ? { settledPendingUpdateIds: written.settledPendingUpdateIds }
        : null;
    },
    close: context.close,
    recoveredText,
    requests,
    standaloneRepairs,
    terminalCodes,
    updateId,
  };
}

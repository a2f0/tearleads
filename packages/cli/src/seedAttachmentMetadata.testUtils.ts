import { expect } from "bun:test";
import {
  addDocumentAttachments,
  type DocumentAttachment,
  type DocumentStore,
  defaultDocumentsPersistence,
  RemoteDocumentService,
  resolveDocumentCreateAuthor,
  type Tearleads,
  validateDocumentSyncUpdateImports,
} from "@tearleads/client-sdk";
import {
  createDocument,
  encodeVersionVector,
  exportUpdatesSince,
  getUpdateVersionVectors,
  importSnapshot,
} from "@tearleads/loro";

/** Publish a content-only edit so the active binding generation stays fixed. */
export async function restoreAttachmentMetadata(
  sdk: Tearleads,
  store: DocumentStore,
  attachment: DocumentAttachment,
) {
  const runtime = sdk.documents.workflowRuntime();
  const { documentId } = store.getSnapshot();
  const author = resolveDocumentCreateAuthor(runtime);
  if (!documentId || !author) throw new Error("Missing document author");
  const doc = await createDocument(crypto.randomUUID());
  importSnapshot(doc, await store.assertCanRotateContentKey("prove"));
  const before = encodeVersionVector(doc);
  addDocumentAttachments(doc, [attachment]);
  const update = exportUpdatesSince(doc, before);
  const id = crypto.randomUUID();
  const localId = await sdk.documents.findLocalIdByDocumentId(documentId);
  const execSql = runtime.infra.execSql;
  if (!localId || !runtime.crypto.encapsulationKeyPair)
    throw new Error("Missing document keys");
  const result = await new RemoteDocumentService({
    api: runtime.apiClient,
    execSql,
    encapsulationSecretKey: runtime.crypto.encapsulationKeyPair.secretKey,
  }).syncRemoteDocument({
    author,
    documentId,
    localVersionVector: encodeVersionVector(doc),
    persistedState: await defaultDocumentsPersistence.loadDocument(
      execSql,
      localId,
    ),
    pendingUpdates: [
      {
        id,
        ...getUpdateVersionVectors(update),
        updateData: Buffer.from(update).toString("base64"),
      },
    ],
    resolveProjectionUserKey:
      sdk.containerContents.documentLinks().resolveProjectionUserKey,
    resolveWriterPublicKey: async ({
      writerUserId,
      writerSigningKeyFingerprint,
    }) => {
      const identity = await runtime.resolveTrustedUserIdentity(writerUserId);
      return identity?.signingKeyFingerprint === writerSigningKeyFingerprint
        ? identity.signingPublicKey
        : null;
    },
    validateIncomingUpdates: ({ decryptedUpdates, response }) =>
      validateDocumentSyncUpdateImports({
        currentDocument: doc,
        decryptedUpdates,
        responseUpdates: response.updates,
      }),
    warmReferencedPrincipalPolicies: runtime.principalPolicies.createWarmer(),
  });
  expect(result?.settledPendingUpdateIds).toContain(id);
}

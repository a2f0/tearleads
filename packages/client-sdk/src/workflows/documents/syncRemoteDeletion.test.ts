import { expect, test } from "bun:test";
import {
  createMaterializedSyncFixture,
  createPendingUpdateRecord,
} from "../../../test/helpers/documentFixtures";
import { syncRemoteDocument } from "./sync";

test("syncRemoteDocument notifies when submit returns document 404", async () => {
  const { author, resolveProjectionUserKey, secretKey, writerProjection } =
    await createMaterializedSyncFixture();
  const deletedDocumentIds: string[] = [];
  const reportedErrors: string[] = [];
  const message = "Document not found";

  const synced = await syncRemoteDocument({
    apiClient: {
      getDocumentWriterProjection: async () => {
        throw new Error("Unexpected writer projection fetch");
      },
      syncDocument: async () => {
        throw new Error("Expected syncDocumentResult to return the failure");
      },
      syncDocumentResult: async () => ({
        message,
        ok: false,
        report: () => {
          reportedErrors.push(message);
        },
        status: 404,
      }),
    },
    author,
    documentId: writerProjection.documentId,
    localVersionVector: null,
    onRemoteDocumentDeleted: ({ documentId }) => {
      deletedDocumentIds.push(documentId);
    },
    pendingUpdates: [createPendingUpdateRecord()],
    resolveProjectionUserKey,
    targetSecretKey: secretKey,
    writerProjection,
  });

  expect(synced).toBeNull();
  expect(deletedDocumentIds).toEqual([writerProjection.documentId]);
  expect(reportedErrors).toEqual([]);
});

test("syncRemoteDocument notifies when writer projection returns document 404", async () => {
  const { author, resolveProjectionUserKey, secretKey, writerProjection } =
    await createMaterializedSyncFixture();
  const deletedDocumentIds: string[] = [];
  const reportedErrors: string[] = [];
  const message = "Document manifest head missing";

  const synced = await syncRemoteDocument({
    apiClient: {
      getDocumentWriterProjection: async () => {
        throw new Error("Expected getDocumentWriterProjectionResult");
      },
      getDocumentWriterProjectionResult: async () => ({
        message,
        ok: false,
        report: () => {
          reportedErrors.push(message);
        },
        status: 404,
      }),
      syncDocument: async () => {
        throw new Error("Unexpected syncDocument call");
      },
    },
    author,
    documentId: writerProjection.documentId,
    localVersionVector: null,
    onRemoteDocumentDeleted: ({ documentId }) => {
      deletedDocumentIds.push(documentId);
    },
    pendingUpdates: [createPendingUpdateRecord()],
    resolveProjectionUserKey,
    targetSecretKey: secretKey,
  });

  expect(synced).toBeNull();
  expect(deletedDocumentIds).toEqual([writerProjection.documentId]);
  expect(reportedErrors).toEqual([]);
});

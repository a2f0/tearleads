import { expect, test } from "bun:test";
import { createTestExecSql } from "@symcrypt/test-utils";
import { DOCUMENT_NOT_FOUND_ERROR_CODE } from "@symcrypt/validators/response";
import {
  createMaterializedSyncFixture,
  createPendingUpdateRecord,
} from "../../../test/helpers/documentFixtures";
import { syncRemoteDocument } from "./sync";

test("syncRemoteDocument notifies when submit returns coded document 404", async () => {
  const { author, resolveProjectionUserKey, secretKey, writerProjection } =
    await createMaterializedSyncFixture();
  const deletedDocumentIds: string[] = [];
  const reportedErrors: string[] = [];
  const message = "Document not found";
  const { close, execSql } = await createTestExecSql("deleted-document-sync");

  const synced = await syncRemoteDocument({
    apiClient: {
      getDocumentWriterProjection: async () => {
        throw new Error("Unexpected writer projection fetch");
      },
      syncDocument: async () => {
        throw new Error("Expected syncDocumentResult to return the failure");
      },
      syncDocumentResult: async () => ({
        code: DOCUMENT_NOT_FOUND_ERROR_CODE,
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
    execSql,
    localVersionVector: null,
    onRemoteDocumentDeleted: ({ documentId }) => {
      deletedDocumentIds.push(documentId);
    },
    pendingUpdates: [createPendingUpdateRecord()],
    resolveProjectionUserKey,
    resolveWriterPublicKey: async () => null,
    targetSecretKey: secretKey,
    writerProjection,
  });
  close();

  expect(synced).toBeNull();
  expect(deletedDocumentIds).toEqual([writerProjection.documentId]);
  expect(reportedErrors).toEqual([]);
});

test("syncRemoteDocument fails closed on a bare 404 without the deletion code", async () => {
  // The destructive local teardown must never key off a bare HTTP 404:
  // proxy/tunnel error pages, deploy-skew route misses, and container-level
  // lookups all produce one without the document being deleted.
  const { author, resolveProjectionUserKey, secretKey, writerProjection } =
    await createMaterializedSyncFixture();
  const deletedDocumentIds: string[] = [];
  const reportedErrors: string[] = [];
  const message = "Document not found";
  const { close, execSql } = await createTestExecSql("bare-404-sync");

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
    execSql,
    localVersionVector: null,
    onRemoteDocumentDeleted: ({ documentId }) => {
      deletedDocumentIds.push(documentId);
    },
    pendingUpdates: [createPendingUpdateRecord()],
    resolveProjectionUserKey,
    resolveWriterPublicKey: async () => null,
    targetSecretKey: secretKey,
    writerProjection,
  });
  close();

  expect(synced).toBeNull();
  expect(deletedDocumentIds).toEqual([]);
  expect(reportedErrors).toEqual([message]);
});

test("syncRemoteDocument fails closed on a 404 with an unknown code", async () => {
  const { author, resolveProjectionUserKey, secretKey, writerProjection } =
    await createMaterializedSyncFixture();
  const deletedDocumentIds: string[] = [];
  const reportedErrors: string[] = [];
  const message = "Not found";
  const { close, execSql } = await createTestExecSql("unknown-code-404-sync");

  const synced = await syncRemoteDocument({
    apiClient: {
      getDocumentWriterProjection: async () => {
        throw new Error("Unexpected writer projection fetch");
      },
      syncDocument: async () => {
        throw new Error("Expected syncDocumentResult to return the failure");
      },
      syncDocumentResult: async () => ({
        code: "some_future_code",
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
    execSql,
    localVersionVector: null,
    onRemoteDocumentDeleted: ({ documentId }) => {
      deletedDocumentIds.push(documentId);
    },
    pendingUpdates: [createPendingUpdateRecord()],
    resolveProjectionUserKey,
    resolveWriterPublicKey: async () => null,
    targetSecretKey: secretKey,
    writerProjection,
  });
  close();

  expect(synced).toBeNull();
  expect(deletedDocumentIds).toEqual([]);
  expect(reportedErrors).toEqual([message]);
});

test("syncRemoteDocument notifies when writer projection returns coded document 404", async () => {
  const { author, resolveProjectionUserKey, secretKey, writerProjection } =
    await createMaterializedSyncFixture();
  const deletedDocumentIds: string[] = [];
  const reportedErrors: string[] = [];
  const message = "Document not found";
  const { close, execSql } = await createTestExecSql(
    "deleted-document-projection-sync",
  );

  const synced = await syncRemoteDocument({
    apiClient: {
      getDocumentWriterProjection: async () => {
        throw new Error("Expected getDocumentWriterProjectionResult");
      },
      getDocumentWriterProjectionResult: async () => ({
        code: DOCUMENT_NOT_FOUND_ERROR_CODE,
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
    execSql,
    localVersionVector: null,
    onRemoteDocumentDeleted: ({ documentId }) => {
      deletedDocumentIds.push(documentId);
    },
    pendingUpdates: [createPendingUpdateRecord()],
    resolveProjectionUserKey,
    resolveWriterPublicKey: async () => null,
    targetSecretKey: secretKey,
  });

  expect(synced).toBeNull();
  expect(deletedDocumentIds).toEqual([writerProjection.documentId]);
  expect(reportedErrors).toEqual([]);
  close();
});

test("syncRemoteDocument fails closed on a bare writer-projection 404", async () => {
  const { author, resolveProjectionUserKey, secretKey, writerProjection } =
    await createMaterializedSyncFixture();
  const deletedDocumentIds: string[] = [];
  const reportedErrors: string[] = [];
  const message = "Document manifest head missing";
  const { close, execSql } = await createTestExecSql(
    "bare-404-projection-sync",
  );

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
    execSql,
    localVersionVector: null,
    onRemoteDocumentDeleted: ({ documentId }) => {
      deletedDocumentIds.push(documentId);
    },
    pendingUpdates: [createPendingUpdateRecord()],
    resolveProjectionUserKey,
    resolveWriterPublicKey: async () => null,
    targetSecretKey: secretKey,
  });

  expect(synced).toBeNull();
  expect(deletedDocumentIds).toEqual([]);
  expect(reportedErrors).toEqual([message]);
  close();
});

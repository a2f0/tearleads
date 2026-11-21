import { expect, test } from "bun:test";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import type {
  BlobAttachmentBindRequest,
  DocumentSyncRequest,
} from "@tearleads/validators/request";
import {
  BLOB_MUTATION_ERROR_CODES,
  type BlobAttachmentSummary,
} from "@tearleads/validators/response";
import {
  createBlobAttachmentBindResponse,
  createMultipartBlobStageFixture,
} from "../../../../../test/helpers/data/blobUploadFixtures";
import {
  createResponseFromRequest,
  type DocumentCreateFixture,
} from "../../../../../test/helpers/data/documentFixtures";
import { waitFor } from "../../../../../test/helpers/data/waitFor";
import { createMaterializedSyncFixture } from "../../../../../test/helpers/workflows/materializedSyncFixture";
import {
  attachmentSummaryFromBind,
  createEchoDocumentSyncResponse,
  createOnlineDocumentsRuntime,
  createStoredDocumentWriterProjection,
} from "../../../../../test/helpers/workflows/onlineDocumentStoreFixtures";
import { defaultDocumentsPersistence } from "../../../../workflows/documents";
import { createDocumentStore } from "../index";
import { MAX_CONSECUTIVE_DOCUMENT_CHANGED_PASSES } from "./attachmentDocumentVersion";

function documentChangedFailure(path: string) {
  return {
    code: BLOB_MUTATION_ERROR_CODES.attachmentDocumentChanged,
    kind: "http",
    message: "Document changed after the attachment slot was checked",
    method: "POST",
    ok: false,
    path,
    report: () => undefined,
    status: 409,
    statusText: "Conflict",
  } as const;
}

/**
 * A store whose API refuses the first `refusals` binds because another
 * device's update committed after the store's pull.
 */
async function uploadWithDocumentChangedRefusals(refusals: number) {
  const fixture = await createMaterializedSyncFixture();
  const localId = `document-changed-${refusals}`;
  const { close, execSql } = await createTestExecSql(localId);
  const binds: Array<{ request: BlobAttachmentBindRequest; pulls: number }> =
    [];
  const attachments: BlobAttachmentSummary[] = [];
  let pulls = 0;
  let recordedFailure: ReturnType<typeof documentChangedFailure> | null = null;
  let storedDocument: DocumentCreateFixture | null = null;
  const { getAssembledBytes: _bytes, ...multipartApi } =
    createMultipartBlobStageFixture();
  const apiClient = createMockApiClient({
    ...multipartApi,
    async bindBlobAttachment(blobId, request) {
      binds.push({ pulls, request });
      if (!storedDocument || binds.length <= refusals) {
        // The client records each refusal as a new failure.
        recordedFailure = documentChangedFailure(
          `/blobs/${blobId}/attachment-bindings`,
        );
        return null;
      }
      const response = await createBlobAttachmentBindResponse({
        blobId,
        documentManifest: storedDocument.accessManifest,
        request,
      });
      attachments.push(attachmentSummaryFromBind(response));
      return response;
    },
    async createDocument(request) {
      storedDocument = await createResponseFromRequest(request);
      return storedDocument;
    },
    getContainerWriterProjection: async () => fixture.projection,
    getDocumentWriterProjection: async () =>
      storedDocument
        ? createStoredDocumentWriterProjection(fixture, storedDocument)
        : null,
    getRequestFailure: ({ method, path }) =>
      method === "POST" && path.endsWith("/attachment-bindings")
        ? recordedFailure
        : null,
    listDocumentAttachments: async () => attachments,
    async syncDocument(_documentId: string, request: DocumentSyncRequest) {
      if (!storedDocument) return null;
      if (request.outgoingUpdates.length === 0) pulls += 1;
      return createEchoDocumentSyncResponse({
        commitLsn: `0/${binds.length + 1}0`,
        request,
        storedDocument,
      });
    },
  });
  const store = createDocumentStore(
    localId,
    createOnlineDocumentsRuntime({ apiClient, execSql, fixture }),
    defaultDocumentsPersistence,
  );
  const syncFailure = async () => {
    const [row] = await execSql(
      "SELECT sync_failure_message AS message FROM documents WHERE local_id = ?",
      [localId],
    );
    return row ? Reflect.get(row, "message") : null;
  };
  return { binds, close, store, syncFailure };
}

test("a bind refused because the document advanced pulls and binds again", async () => {
  const { binds, close, store, syncFailure } =
    await uploadWithDocumentChangedRefusals(1);
  try {
    expect(await store.ensureInitialized()).toBe(true);
    store.attachFiles([
      {
        bytes: new TextEncoder().encode("document changed bytes"),
        mimeType: "image/png",
        name: "changed.png",
      },
    ]);
    await waitFor(
      () => binds.length === 2 && !store.getSnapshot().syncing,
      "The refused bind was not retried after a pull.",
      5_000,
    );

    const [refused, retried] = binds;
    // The retry is a new pass: it pulled before checking the slot again.
    expect(retried?.pulls).toBeGreaterThan(refused?.pulls ?? 0);
    expect(retried?.request.documentVersionVector).toBe(
      store.getSnapshot().versionVector,
    );
    expect(store.getSnapshot().attachments).toHaveLength(1);
    expect(store.getSnapshot().attachmentStatusBySlotId).toEqual({});
    expect(await syncFailure()).toBeNull();
  } finally {
    close();
  }
}, 10_000);

test("a bind the API keeps refusing stops re-pulling and records the stuck upload", async () => {
  const { binds, close, store, syncFailure } =
    await uploadWithDocumentChangedRefusals(Number.POSITIVE_INFINITY);
  try {
    expect(await store.ensureInitialized()).toBe(true);
    store.attachFiles([
      {
        bytes: new TextEncoder().encode("busy document bytes"),
        mimeType: "image/png",
        name: "busy.png",
      },
    ]);
    // Only the pass that stops re-pulling records the failure.
    await waitFor(
      async () => (await syncFailure()) !== null,
      "The refused binds did not settle.",
      5_000,
    );

    expect(binds).toHaveLength(MAX_CONSECUTIVE_DOCUMENT_CHANGED_PASSES + 1);
    expect(store.getSnapshot().attachmentStatusBySlotId).not.toEqual({});
    expect(await syncFailure()).toContain(
      "Attachment upload failed for busy.png",
    );
    // A later sync signal gets one more bind, still without re-pulling.
    expect(await store.requestRemoteSyncAndWait()).toBe(true);
    expect(binds).toHaveLength(MAX_CONSECUTIVE_DOCUMENT_CHANGED_PASSES + 2);
  } finally {
    close();
  }
}, 10_000);

import { expect, test } from "bun:test";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import type {
  BlobAttachmentBindRequest,
  DocumentSyncRequest,
} from "@tearleads/validators/request";
import type { BlobAttachmentSummary } from "@tearleads/validators/response";
import {
  createBlobAttachmentBindResponse,
  createMultipartBlobStageFixture,
} from "../../../../../test/helpers/blobUploadFixtures";
import {
  createMaterializedSyncFixture,
  createResponseFromRequest,
  type DocumentCreateFixture,
} from "../../../../../test/helpers/documentFixtures";
import {
  attachmentSummaryFromBind,
  createEchoDocumentSyncResponse,
  createOnlineDocumentsRuntime,
  createStoredDocumentWriterProjection,
} from "../../../../../test/helpers/onlineDocumentStoreFixtures";
import { waitFor } from "../../../../../test/helpers/waitFor";
import type { BlobStore } from "../../../../data/blobs/blobContracts";
import { createMemoryBlobStore } from "../../../../data/blobs/memoryBlobStore";
import { defaultDocumentsPersistence } from "../../../../workflows/documents";
import { createDocumentStore } from "../index";
import { PDF_FIELDS, PDF_UPLOAD } from "./deferredInitialUpdate.testFixtures";

test("an online deferred import sends its birth, fields and attachment as one update", async () => {
  const fixture = await createMaterializedSyncFixture();
  const { close, execSql } = await createTestExecSql("deferred-birth-online");
  const outgoingUpdateCounts: number[] = [];
  const attachments: BlobAttachmentSummary[] = [];
  let storedDocument: DocumentCreateFixture | null = null;
  let completedSyncLaneRuns = 0;
  const multipartApi = createMultipartBlobStageFixture();
  const apiClient = createMockApiClient({
    ...multipartApi,
    async bindBlobAttachment(
      blobId: string,
      request: BlobAttachmentBindRequest,
    ) {
      if (!storedDocument || !request.stagedBlob) return null;
      const response = await createBlobAttachmentBindResponse({
        blobId,
        documentManifest: storedDocument.accessManifest,
        request,
      });
      attachments.push(attachmentSummaryFromBind(response));
      return response;
    },
    async createDocument(
      request: Parameters<typeof createResponseFromRequest>[0],
    ) {
      storedDocument = await createResponseFromRequest(request);
      return storedDocument;
    },
    getContainerWriterProjection: async () => fixture.projection,
    getDocumentWriterProjection: async () =>
      storedDocument
        ? createStoredDocumentWriterProjection(fixture, storedDocument)
        : null,
    listDocumentAttachments: async () => attachments,
    async syncDocument(_documentId: string, request: DocumentSyncRequest) {
      if (!storedDocument) return null;
      outgoingUpdateCounts.push(request.outgoingUpdates.length);
      return createEchoDocumentSyncResponse({
        commitLsn: `0/${outgoingUpdateCounts.length}0`,
        request,
        storedDocument,
      });
    },
  });
  // Staging waits until the store's sync lane has run once, so a pass that
  // ignored the deferral would ship the birth before the attach persists.
  const memoryBlobStore = createMemoryBlobStore();
  const blobStore = Object.assign(Object.create(memoryBlobStore) as BlobStore, {
    writeByteSource: async (
      ...args: Parameters<BlobStore["writeByteSource"]>
    ) => {
      await waitFor(
        () => completedSyncLaneRuns > 0,
        "The sync lane never ran while the attach was staging.",
        2_000,
      );
      return memoryBlobStore.writeByteSource(...args);
    },
  });
  const store = createDocumentStore(
    "deferred-online-pdf",
    createOnlineDocumentsRuntime({ apiClient, blobStore, execSql, fixture }),
    defaultDocumentsPersistence,
    null,
    "",
    "pdf",
    { deferInitialUpdate: true },
  );
  let syncing = false;
  const unsubscribe = store.subscribe(() => {
    const nextSyncing = store.getSnapshot().syncing;
    if (syncing && !nextSyncing) completedSyncLaneRuns += 1;
    syncing = nextSyncing;
  });

  try {
    expect(await store.ensureInitialized()).toBe(true);
    await store.setStructuredFields("pdf", PDF_FIELDS, {
      deferRemoteSync: true,
    });
    store.attachFiles([PDF_UPLOAD]);
    await waitFor(
      () =>
        attachments.length === 1 &&
        outgoingUpdateCounts.some((count) => count > 0) &&
        !store.getSnapshot().syncing,
      "The deferred import never synced.",
      5_000,
    );

    expect(
      outgoingUpdateCounts.reduce((total, count) => total + count, 0),
    ).toBe(1);
    expect(store.getSnapshot()).toMatchObject({
      documentKind: "pdf",
      structuredFields: PDF_FIELDS,
    });
    expect(store.getSnapshot().attachments).toHaveLength(1);
  } finally {
    unsubscribe();
    close();
  }
}, 10_000);

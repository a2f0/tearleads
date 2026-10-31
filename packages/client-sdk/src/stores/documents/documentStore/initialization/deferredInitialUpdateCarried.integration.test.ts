import { expect, test } from "bun:test";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import type {
  BlobAttachmentBindRequest,
  DocumentSyncRequest,
} from "@tearleads/validators/request";
import type {
  BlobAttachmentSummary,
  DocumentCreateResponse,
} from "@tearleads/validators/response";
import {
  createBlobAttachmentBindResponse,
  createMultipartBlobStageFixture,
} from "../../../../../test/helpers/blobUploadFixtures";
import {
  createMaterializedSyncFixture,
  createResponseFromRequest,
} from "../../../../../test/helpers/documentFixtures";
import {
  attachmentSummaryFromBind,
  createEchoDocumentSyncResponse,
  createOnlineDocumentsRuntime,
  createStoredDocumentWriterProjection,
} from "../../../../../test/helpers/onlineDocumentStoreFixtures";
import { waitFor } from "../../../../../test/helpers/waitFor";
import {
  defaultDocumentsPersistence,
  listPendingDocumentUpdates,
} from "../../../../workflows/documents";
import { createDocumentStore } from "../index";
import { PDF_FIELDS, PDF_UPLOAD } from "./deferredInitialUpdate.testFixtures";

type BindOutcome = "acknowledge" | "omit" | "refuse-carry" | "relink";

/**
 * An online deferred import whose server commits a carried update in the
 * bind (`acknowledge`), binds without reporting it (`omit`), refuses the
 * first, carrying bind (`refuse-carry`), or acknowledges it after the store
 * relinked to another document mid-bind (`relink`).
 */
async function runDeferredImport(name: string, outcome: BindOutcome) {
  const fixture = await createMaterializedSyncFixture();
  const { close, execSql } = await createTestExecSql(name);
  const binds: BlobAttachmentBindRequest[] = [];
  const syncedUpdateIds: string[] = [];
  const attachments: BlobAttachmentSummary[] = [];
  let storedDocument: DocumentCreateResponse | null = null;
  let refusedBlobId: string | null = null;
  let relinkMidBind: (() => Promise<unknown>) | null = null;
  const apiClient = createMockApiClient({
    ...createMultipartBlobStageFixture(),
    async bindBlobAttachment(
      blobId: string,
      request: BlobAttachmentBindRequest,
    ) {
      binds.push(request);
      if (!storedDocument || !request.stagedBlob) return null;
      if (outcome === "refuse-carry" && request.documentSync) {
        refusedBlobId = blobId;
        return null;
      }
      const response = await createBlobAttachmentBindResponse({
        blobId,
        documentManifest: storedDocument.accessManifest,
        request,
      });
      attachments.push(attachmentSummaryFromBind(response));
      const carried = request.documentSync?.outgoingUpdates.map(
        (update) => update.id,
      );
      if (outcome === "relink" && carried) await relinkMidBind?.();
      return outcome !== "omit" && carried
        ? {
            ...response,
            documentSync: {
              acceptedOutgoingUpdateIds: carried,
              commitLsn: "0/42",
              commitLsnMode: "tracked" as const,
            },
          }
        : response;
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
    getRequestFailure: ({ path }: { path: string }) =>
      refusedBlobId && path === `/blobs/${refusedBlobId}/attachment-bindings`
        ? {
            kind: "http" as const,
            message: "stale carried update",
            method: "POST" as const,
            ok: false as const,
            path,
            report: () => undefined,
            status: 409,
            statusText: "Conflict",
          }
        : null,
    listDocumentAttachments: async () => attachments,
    async syncDocument(_documentId: string, request: DocumentSyncRequest) {
      if (!storedDocument) return null;
      syncedUpdateIds.push(...request.outgoingUpdates.map((u) => u.id));
      return createEchoDocumentSyncResponse({
        commitLsn: "0/50",
        request,
        storedDocument,
      });
    },
  });
  const store = createDocumentStore(
    name,
    createOnlineDocumentsRuntime({ apiClient, execSql, fixture }),
    defaultDocumentsPersistence,
    null,
    "",
    "pdf",
    { deferInitialUpdate: true },
  );
  relinkMidBind = () =>
    store.relink({
      accessEpoch: 1,
      containerId: fixture.projection.containerId,
      documentId: "relinked-document",
      localId: name,
    });
  try {
    expect(await store.ensureInitialized()).toBe(true);
    await store.setStructuredFields("pdf", PDF_FIELDS, {
      deferRemoteSync: true,
    });
    store.attachFiles([PDF_UPLOAD]);
    await waitFor(
      () => attachments.length === 1 && !store.getSnapshot().syncing,
      "The deferred import never bound its attachment.",
      5_000,
    );
    const pending = await listPendingDocumentUpdates({
      execSql,
      localId: name,
      persistence: defaultDocumentsPersistence,
    });
    return { binds, pending, store, syncedUpdateIds };
  } finally {
    close();
  }
}

test("the first bind carries the deferred birth and settles it", async () => {
  const { binds, pending, syncedUpdateIds } = await runDeferredImport(
    "deferred-birth-carried",
    "acknowledge",
  );

  const carried = binds[0]?.documentSync?.outgoingUpdates ?? [];
  expect(binds).toHaveLength(1);
  expect(carried).toHaveLength(1);
  // Settled by the bind's acknowledgement: no sync ships it again.
  expect(pending).toEqual([]);
  expect(syncedUpdateIds).toEqual([]);
}, 10_000);

test("a carried birth the bind does not acknowledge syncs on its own", async () => {
  const { binds, syncedUpdateIds } = await runDeferredImport(
    "deferred-birth-unacknowledged",
    "omit",
  );

  const carriedId = binds[0]?.documentSync?.outgoingUpdates[0]?.id ?? "";
  expect(carriedId).not.toBe("");
  await waitFor(
    () => syncedUpdateIds.includes(carriedId),
    "The unacknowledged birth never synced.",
    5_000,
  );
  expect(syncedUpdateIds).toEqual([carriedId]);
}, 10_000);

test("a relink during the carrying bind keeps the birth queued", async () => {
  const { binds, pending, store } = await runDeferredImport(
    "deferred-birth-relinked",
    "relink",
  );

  const carriedId = binds[0]?.documentSync?.outgoingUpdates[0]?.id ?? "";
  expect(carriedId).not.toBe("");
  expect(store.getSnapshot().documentId).toBe("relinked-document");
  // The acknowledgement describes the old document, so it settles nothing
  // under the new identity.
  expect(pending.map((update) => update.id)).toContain(carriedId);
}, 10_000);

test("a refused carrying bind binds plainly and the birth syncs alone", async () => {
  const { binds, syncedUpdateIds } = await runDeferredImport(
    "deferred-birth-refused",
    "refuse-carry",
  );

  const carriedId = binds[0]?.documentSync?.outgoingUpdates[0]?.id ?? "";
  expect(binds.map((bind) => bind.documentSync === undefined)).toEqual([
    false,
    true,
  ]);
  await waitFor(
    () => syncedUpdateIds.includes(carriedId),
    "The refused birth never synced.",
    5_000,
  );
  expect(syncedUpdateIds).toEqual([carriedId]);
}, 10_000);

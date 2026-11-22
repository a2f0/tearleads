import { expect, test } from "bun:test";
import { satisfiesVersionVector } from "@tearleads/loro";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import type {
  BlobAttachmentBindRequest,
  DocumentSyncRequest,
} from "@tearleads/validators/request";
import {
  BLOB_MUTATION_ERROR_CODES,
  type BlobAttachmentSummary,
  type DocumentSyncResponse,
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
import type { DocumentStore } from "../../types";
import { createDocumentStore } from "../index";

type MultipartStage = ReturnType<typeof createMultipartBlobStageFixture>;

/** One fixture stage per upload, so a device can upload more than once. */
function createMultipartStages() {
  const stages = new Map<string, MultipartStage>();
  const stage = (stageId: string) => {
    const found = stages.get(stageId);
    if (!found) throw new Error(`Unknown multipart stage ${stageId}`);
    return found;
  };
  return {
    getMultipartBlobStage: async (stageId: string) =>
      stages.get(stageId)?.getMultipartBlobStage(stageId) ?? null,
    initiateMultipartBlobStage: (
      request: Parameters<MultipartStage["initiateMultipartBlobStage"]>[0],
    ) => {
      const stageId = crypto.randomUUID();
      const created = createMultipartBlobStageFixture({ stageId });
      stages.set(stageId, created);
      return created.initiateMultipartBlobStage(request);
    },
    uploadMultipartBlobPartBytes: (
      ...args: Parameters<MultipartStage["uploadMultipartBlobPartBytes"]>
    ) => stage(args[0]).uploadMultipartBlobPartBytes(...args),
  };
}

/**
 * A server that commits every update two devices send and refuses a bind
 * whose version lacks a committed update, as the API's precondition does.
 * `beforeFirstBind` runs inside the uploader's first bind, before the
 * server checks it: a peer's edit then lands inside the pull-then-bind
 * window.
 */
async function peerEditHarness(name: string) {
  const fixture = await createMaterializedSyncFixture();
  const uploaderDb = await createTestExecSql(`${name}-uploader`);
  const peerDb = await createTestExecSql(`${name}-peer`);
  const committed: DocumentSyncResponse["updates"] = [];
  const binds: BlobAttachmentBindRequest[] = [];
  const attachments: BlobAttachmentSummary[] = [];
  const hooks: { beforeFirstBind: (() => Promise<void>) | null } = {
    beforeFirstBind: null,
  };
  let recordedFailure: object | null = null;
  let storedDocument: DocumentCreateFixture | null = null;
  const apiClient = createMockApiClient({
    ...createMultipartStages(),
    async bindBlobAttachment(blobId, request) {
      const beforeFirstBind = hooks.beforeFirstBind;
      hooks.beforeFirstBind = null;
      await beforeFirstBind?.();
      binds.push(request);
      if (!storedDocument) return null;
      if (
        committed.some(
          (update) =>
            !satisfiesVersionVector(
              request.documentVersionVector,
              update.partialEndVersionVector,
            ),
        )
      ) {
        // The client records each refusal as a new failure.
        recordedFailure = {
          code: BLOB_MUTATION_ERROR_CODES.attachmentDocumentChanged,
          kind: "http",
          message: "Document changed after the attachment slot was checked",
          method: "POST",
          ok: false,
          path: `/blobs/${blobId}/attachment-bindings`,
          report: () => undefined,
          status: 409,
        };
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
        ? (recordedFailure as never)
        : null,
    listDocumentAttachments: async () => attachments,
    async syncDocument(_documentId: string, request: DocumentSyncRequest) {
      if (!storedDocument) return null;
      const echo = createEchoDocumentSyncResponse({
        commitLsn: `0/${committed.length + 1}0`,
        request,
        storedDocument,
      });
      committed.push(...echo.updates);
      return { ...echo, updates: [...committed] };
    },
  });
  const uploader = createDocumentStore(
    `${name}-uploader`,
    createOnlineDocumentsRuntime({
      apiClient,
      execSql: uploaderDb.execSql,
      fixture,
    }),
    defaultDocumentsPersistence,
  );
  const stores: DocumentStore[] = [uploader];
  /** Opens the uploader's document on a second device. */
  const openPeer = async () => {
    if (!storedDocument) throw new Error("Expected a remote document");
    const peer = createDocumentStore(
      `${name}-peer`,
      createOnlineDocumentsRuntime({
        apiClient,
        execSql: peerDb.execSql,
        fixture,
      }),
      defaultDocumentsPersistence,
      storedDocument.id,
    );
    stores.push(peer);
    expect(await peer.ensureInitialized()).toBe(true);
    expect(await peer.requestRemoteSyncAndWait()).toBe(true);
    return peer;
  };
  const close = () => {
    uploaderDb.close();
    peerDb.close();
  };
  return { attachments, binds, close, committed, hooks, openPeer, uploader };
}

/** Opens the uploader's document with one synced edit. */
async function openSyncedDocument(
  harness: Awaited<ReturnType<typeof peerEditHarness>>,
) {
  expect(await harness.uploader.ensureInitialized()).toBe(true);
  await harness.uploader.setText("base");
  await waitFor(
    () =>
      harness.committed.length > 0 && !harness.uploader.getSnapshot().syncing,
    "The uploader's document did not sync.",
    10_000,
  );
}

/**
 * Runs `upload` on the uploader, and `peerEdit` on a second device inside
 * the upload's first bind. Returns the updates the peer committed.
 */
function uploadWithPeerEdit(
  harness: Awaited<ReturnType<typeof peerEditHarness>>,
  upload: () => void,
  peerEdit: (peer: DocumentStore) => Promise<void>,
) {
  let peerUpdates: DocumentSyncResponse["updates"] = [];
  harness.hooks.beforeFirstBind = async () => {
    const peer = await harness.openPeer();
    const before = harness.committed.length;
    await peerEdit(peer);
    expect(await peer.requestRemoteSyncAndWait()).toBe(true);
    peerUpdates = harness.committed.slice(before);
  };
  upload();
  return () => peerUpdates;
}

function file(name: string) {
  return {
    bytes: new TextEncoder().encode(`${name} bytes`),
    mimeType: "image/png",
    name,
  };
}

test("a peer removal pulled after a refused bind sends no second bind and drops the upload", async () => {
  const harness = await peerEditHarness("peer-removal");
  try {
    await openSyncedDocument(harness);
    // A fresh slot reaches the server only with its binding, so a peer can
    // remove a slot mid-upload only once it is visible: replace a bound one.
    harness.uploader.attachFiles([file("first.png")]);
    await waitFor(
      () =>
        harness.attachments.length === 1 &&
        !harness.uploader.getSnapshot().syncing,
      "The first attachment did not bind.",
      10_000,
    );
    const [slot] = harness.uploader.getSnapshot().attachments;
    if (!slot) throw new Error("Expected the bound slot");
    const bindsBefore = harness.binds.length;

    const peerUpdates = uploadWithPeerEdit(
      harness,
      () => harness.uploader.replaceAttachment(slot.slotId, file("second.png")),
      async (peer) => {
        expect(peer.getSnapshot().attachments).toHaveLength(1);
        peer.removeAttachment(slot.slotId);
      },
    );
    await waitFor(
      () =>
        harness.binds.length > bindsBefore &&
        harness.uploader.getSnapshot().attachments.length === 0 &&
        Object.keys(harness.uploader.getSnapshot().attachmentStatusBySlotId)
          .length === 0 &&
        !harness.uploader.getSnapshot().syncing,
      "The uploader did not drop the removed slot's upload.",
      10_000,
    );

    expect(peerUpdates().length).toBeGreaterThan(0);
    expect(harness.binds).toHaveLength(bindsBefore + 1);
    // A later pass has nothing left to bind.
    expect(await harness.uploader.requestRemoteSyncAndWait()).toBe(true);
    expect(harness.binds).toHaveLength(bindsBefore + 1);
  } finally {
    harness.close();
  }
}, 30_000);

test("an unrelated peer edit pulled after a refused bind retries at a version covering it", async () => {
  const harness = await peerEditHarness("peer-unrelated");
  try {
    await openSyncedDocument(harness);
    const peerUpdates = uploadWithPeerEdit(
      harness,
      () => harness.uploader.attachFiles([file("portrait.png")]),
      async (peer) => {
        await peer.setText("peer edit");
      },
    );
    await waitFor(
      () => harness.attachments.length === 1,
      "The uploader did not bind after pulling the peer's edit.",
      10_000,
    );

    const [refused, retried] = harness.binds;
    if (!refused || !retried) throw new Error("Expected two binds");
    expect(harness.binds).toHaveLength(2);
    const updates = peerUpdates();
    expect(updates.length).toBeGreaterThan(0);
    for (const update of updates) {
      expect(
        satisfiesVersionVector(
          refused.documentVersionVector,
          update.partialEndVersionVector,
        ),
      ).toBe(false);
      expect(
        satisfiesVersionVector(
          retried.documentVersionVector,
          update.partialEndVersionVector,
        ),
      ).toBe(true);
    }
    expect(harness.uploader.getSnapshot().text).toBe("peer edit");
    expect(harness.uploader.getSnapshot().attachments).toHaveLength(1);
  } finally {
    harness.close();
  }
}, 30_000);

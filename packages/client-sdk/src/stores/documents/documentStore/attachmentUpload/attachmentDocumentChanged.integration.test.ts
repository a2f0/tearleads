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
import { MAX_DOCUMENT_VERSION_REFRESHES } from "../../../../workflows/blobs/upload/bindAtDocumentVersion";
import { defaultDocumentsPersistence } from "../../../../workflows/documents";
import { createDocumentStore } from "../index";
import { MAX_CONSECUTIVE_DOCUMENT_CHANGED_PASSES } from "./attachmentDocumentVersion";

/** Binds one upload call sends before it gives up on a busy document. */
const BINDS_PER_CALL = MAX_DOCUMENT_VERSION_REFRESHES + 1;

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
  /** Runs inside each pull, before it answers. */
  const hooks: { onPull: (() => Promise<void>) | null } = { onPull: null };
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
      if (request.outgoingUpdates.length === 0) {
        pulls += 1;
        await hooks.onPull?.();
      }
      return createEchoDocumentSyncResponse({
        commitLsn: `0/${binds.length + 1}0`,
        request,
        storedDocument,
      });
    },
  });
  const runtime = createOnlineDocumentsRuntime({ apiClient, execSql, fixture });
  const store = createDocumentStore(
    localId,
    runtime,
    defaultDocumentsPersistence,
  );
  const syncFailure = async () => {
    const [row] = await execSql(
      "SELECT sync_failure_message AS message FROM documents WHERE local_id = ?",
      [localId],
    );
    return row ? Reflect.get(row, "message") : null;
  };
  return { binds, close, hooks, runtime, store, syncFailure };
}

function attachBusyFile(
  store: Awaited<ReturnType<typeof uploadWithDocumentChangedRefusals>>["store"],
  name: string,
) {
  store.attachFiles([
    {
      bytes: new TextEncoder().encode(`${name} bytes`),
      mimeType: "image/png",
      name,
    },
  ]);
}

test("a peer edit that lands mid-pass refuses the bind, and the same pass pulls and binds", async () => {
  const { binds, close, store, syncFailure } =
    await uploadWithDocumentChangedRefusals(1);
  try {
    expect(await store.ensureInitialized()).toBe(true);
    attachBusyFile(store, "changed.png");
    await waitFor(
      () => binds.length === 2 && !store.getSnapshot().syncing,
      "The refused bind was not retried after a pull.",
      5_000,
    );

    const [refused, retried] = binds;
    if (!refused || !retried) throw new Error("Expected two binds");
    // One pull sits between them, and the retry is the same signed bind on
    // the kept stage: the pass pulled and checked the slot in place.
    expect(retried.pulls).toBe(refused.pulls + 1);
    expect({
      ...retried.request,
      documentVersionVector: refused.request.documentVersionVector,
    }).toEqual(refused.request);
    expect(store.getSnapshot().versionVector).toBe(
      retried.request.documentVersionVector,
    );
    expect(store.getSnapshot().attachments).toHaveLength(1);
    expect(store.getSnapshot().attachmentStatusBySlotId).toEqual({});
    expect(await syncFailure()).toBeNull();
  } finally {
    close();
  }
}, 10_000);

test("a peer that keeps editing past one pass's pulls still lets the upload bind", async () => {
  const refusals = BINDS_PER_CALL + 1;
  const { binds, close, store, syncFailure } =
    await uploadWithDocumentChangedRefusals(refusals);
  try {
    expect(await store.ensureInitialized()).toBe(true);
    attachBusyFile(store, "busy.png");
    // Nothing but the uploader's own passes runs: no sync is requested here.
    await waitFor(
      () => binds.length === refusals + 1 && !store.getSnapshot().syncing,
      "The upload did not bind once the peer stopped editing.",
      5_000,
    );

    // Every refused bind pulled before the next one.
    for (const [index, bind] of binds.entries()) {
      if (index > 0)
        expect(bind.pulls).toBe((binds[index - 1]?.pulls ?? 0) + 1);
    }
    expect(store.getSnapshot().attachments).toHaveLength(1);
    expect(await syncFailure()).toBeNull();
  } finally {
    close();
  }
}, 10_000);

test("a bind the API keeps refusing stops after a bounded budget and records the stuck upload", async () => {
  const { binds, close, store, syncFailure } =
    await uploadWithDocumentChangedRefusals(Number.POSITIVE_INFINITY);
  try {
    expect(await store.ensureInitialized()).toBe(true);
    attachBusyFile(store, "stuck.png");
    // Only the pass that stops re-arming records the failure.
    await waitFor(
      async () => (await syncFailure()) !== null,
      "The refused binds did not settle.",
      5_000,
    );

    const budget =
      BINDS_PER_CALL * (MAX_CONSECUTIVE_DOCUMENT_CHANGED_PASSES + 1);
    expect(binds).toHaveLength(budget);
    expect(store.getSnapshot().attachmentStatusBySlotId).not.toEqual({});
    expect(await syncFailure()).toContain(
      "Attachment upload failed for stuck.png",
    );
    // A later sync signal gets one more call's pulls, and no re-armed pass.
    expect(await store.requestRemoteSyncAndWait()).toBe(true);
    expect(binds).toHaveLength(budget + BINDS_PER_CALL);
  } finally {
    close();
  }
}, 10_000);

test("a store torn down during a refused bind's pull leaves the reloaded upload its full budget", async () => {
  const { binds, close, hooks, runtime, store, syncFailure } =
    await uploadWithDocumentChangedRefusals(Number.POSITIVE_INFINITY);
  try {
    expect(await store.ensureInitialized()).toBe(true);
    let tornDown = false;
    hooks.onPull = async () => {
      if (tornDown || binds.length !== 1) return;
      tornDown = true;
      // The refused bind's refresh is mid-pull when the store resets and
      // loads the pending upload again.
      store.updateRuntime({
        ...runtime,
        infra: { ...runtime.infra, dbStatus: "idle" },
      });
      store.updateRuntime(runtime);
      expect(await store.ensureInitialized()).toBe(true);
    };
    attachBusyFile(store, "reloaded.png");
    await waitFor(
      async () => (await syncFailure()) !== null,
      "The reloaded upload's refused binds did not settle.",
      5_000,
    );

    expect(tornDown).toBe(true);
    // The torn-down pass sent one bind and counted nothing, so the reloaded
    // upload re-armed as many passes as a fresh one.
    expect(binds).toHaveLength(
      1 + BINDS_PER_CALL * (MAX_CONSECUTIVE_DOCUMENT_CHANGED_PASSES + 1),
    );
  } finally {
    close();
  }
}, 10_000);

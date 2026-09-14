import { expect, test } from "bun:test";
import { createDocument, importSnapshot } from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
import { sqlDocumentsPersistence } from "../../../data/persistence/documents/documentsPersistence";
import {
  createRemoteHistoryFixture,
  noopDocumentStorePersistenceEffects,
} from "./documentStore.testFixtures";
import { ensureDocumentStoreReady } from "./initialization";
import {
  createRotationRecoveryRuntime,
  persistFullHistoryDocument,
} from "./rotationRecoveryHelpers.test";
import { createDocumentStoreState, type DocumentStoreState } from "./state";
import { settleUploadedAttachment } from "./syncAttachmentSettlement";
import { finalizeDocumentSync } from "./syncFinalize";
import { captureDocumentStoreSyncGeneration } from "./syncGeneration";
import { requestRemoteDocumentSync } from "./syncRequest";
import { invalidateDocumentWriterProjection } from "./writerProjectionGeneration";

test("a sync whose request straddles a hint does not reinstall its pre-hint projection", async () => {
  const { close, execSql } = await createTestExecSql(
    "document-sync-projection-generation",
  );
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const fixture = await createRemoteHistoryFixture();
    const localId = "document-sync-projection-generation-local";
    const behindDocument = await createDocument(
      "document-sync-projection-generation-behind",
    );
    importSnapshot(behindDocument, fixture.behindSnapshot);
    await persistFullHistoryDocument({
      doc: behindDocument,
      documentId: fixture.writerProjection.documentId,
      execSql,
      localId,
    });
    let state: DocumentStoreState | null = null;
    let hintsDelivered = 0;
    const runtime = createRotationRecoveryRuntime({
      execSql,
      fixture,
      requireRawHistory: false,
      responseForRequest: async (_request, response) => {
        // A peer's grant hint lands while this sync's request is in flight.
        if (state) {
          invalidateDocumentWriterProjection(state);
          hintsDelivered += 1;
        }
        return response;
      },
    });
    state = createDocumentStoreState(
      localId,
      runtime,
      sqlDocumentsPersistence,
      noopDocumentStorePersistenceEffects,
      fixture.writerProjection.documentId,
    );
    expect(await ensureDocumentStoreReady(state, () => undefined)).toBe(true);
    const currentDoc = state.doc;
    const currentRecord = state.record;
    if (!currentDoc || !currentRecord) {
      throw new Error("Expected initialized document state");
    }
    const generation = captureDocumentStoreSyncGeneration(state, currentDoc);
    if (!generation) throw new Error("Expected current sync generation");
    state.syncLane = {
      requestSync: () => undefined,
    } as NonNullable<typeof state.syncLane>;

    const attempt = await requestRemoteDocumentSync({
      currentDoc,
      currentRecord,
      encapsulationKeyPair: fixture,
      generation,
      pendingUpdates: [],
      state,
      unavailableWriterLogMessage: "unexpected unavailable writer",
    });
    if (!attempt) throw new Error("Expected a completed sync response");
    expect(hintsDelivered).toBe(1);
    expect(attempt.synced.writerProjection).toBeTruthy();
    // The attempt remembers the generation it left with; the hint moved it.
    expect(attempt.writerProjectionGeneration).toBe(
      state.writerProjectionGeneration - 1,
    );

    await finalizeDocumentSync(
      state,
      currentDoc,
      currentRecord,
      attempt,
      1,
      generation,
      [],
      false,
    );
    // The settlement applied its content but kept the pre-hint projection out
    // of the cache, so the next operation fetches a fresh one.
    expect(state.writerProjection).toBeNull();
  } finally {
    close();
  }
});

test("an undisturbed sync settlement installs its projection", async () => {
  const { close, execSql } = await createTestExecSql(
    "document-sync-projection-generation-steady",
  );
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const fixture = await createRemoteHistoryFixture();
    const localId = "document-sync-projection-generation-steady-local";
    const behindDocument = await createDocument(
      "document-sync-projection-generation-steady-behind",
    );
    importSnapshot(behindDocument, fixture.behindSnapshot);
    await persistFullHistoryDocument({
      doc: behindDocument,
      documentId: fixture.writerProjection.documentId,
      execSql,
      localId,
    });
    const runtime = createRotationRecoveryRuntime({
      execSql,
      fixture,
      requireRawHistory: false,
    });
    const state = createDocumentStoreState(
      localId,
      runtime,
      sqlDocumentsPersistence,
      noopDocumentStorePersistenceEffects,
      fixture.writerProjection.documentId,
    );
    expect(await ensureDocumentStoreReady(state, () => undefined)).toBe(true);
    const currentDoc = state.doc;
    const currentRecord = state.record;
    if (!currentDoc || !currentRecord) {
      throw new Error("Expected initialized document state");
    }
    const generation = captureDocumentStoreSyncGeneration(state, currentDoc);
    if (!generation) throw new Error("Expected current sync generation");
    state.syncLane = {
      requestSync: () => undefined,
    } as NonNullable<typeof state.syncLane>;
    const attempt = await requestRemoteDocumentSync({
      currentDoc,
      currentRecord,
      encapsulationKeyPair: fixture,
      generation,
      pendingUpdates: [],
      state,
      unavailableWriterLogMessage: "unexpected unavailable writer",
    });
    if (!attempt) throw new Error("Expected a completed sync response");
    await finalizeDocumentSync(
      state,
      currentDoc,
      currentRecord,
      attempt,
      1,
      generation,
      [],
      false,
    );
    expect(state.writerProjection).not.toBeNull();
  } finally {
    close();
  }
});

test("an attachment upload settled after a hint leaves the projection empty", async () => {
  const { close, execSql } = await createTestExecSql(
    "attachment-settle-projection-generation",
  );
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const fixture = await createRemoteHistoryFixture();
    const runtime = createRotationRecoveryRuntime({ execSql, fixture });
    const state = createDocumentStoreState(
      "attachment-settle-local",
      runtime,
      sqlDocumentsPersistence,
      noopDocumentStorePersistenceEffects,
      fixture.writerProjection.documentId,
    );
    state.doc = fixture.remoteDocument;
    const attachmentGeneration = captureDocumentStoreSyncGeneration(
      state,
      state.doc,
    );
    if (!attachmentGeneration) throw new Error("Expected sync generation");
    const pendingAttachment = {
      byteLength: 3,
      contentSha256: "1".repeat(64),
      localId: state.localId,
      mimeType: "application/octet-stream",
      name: "pending.bin",
      slotId: "slot-1",
      storageKey: "pending-bytes",
      upload: null,
    };
    state.pendingAttachments = [pendingAttachment];
    const uploaded = {
      bindingId: "binding-1",
      blobId: "blob-1",
      response: {
        bindingEvent: {},
        blobKekTargets: {},
        contentKeyBundle: {},
        documentManifestHash: "manifest-1",
        previousBindingId: null,
        writeAuthorization: {},
        writeHeader: {},
      },
      writerProjection: fixture.writerProjection,
    } as unknown as Parameters<typeof settleUploadedAttachment>[0]["uploaded"];
    const lane = {
      complete: () => undefined,
      fail: () => undefined,
      failIfStarted: () => undefined,
      onMultipartProgress: () => undefined,
    };

    // The upload captured its generation when it started; a peer's grant hint
    // lands before its settlement runs.
    const writerProjectionGeneration = state.writerProjectionGeneration;
    invalidateDocumentWriterProjection(state);
    await settleUploadedAttachment({
      activeBindingBySlotId: new Map(),
      attachmentGeneration,
      pendingAttachment,
      remoteDocumentId: fixture.writerProjection.documentId,
      state,
      uploadLane: lane,
      uploaded,
      writerProjectionGeneration,
    });
    expect(state.writerProjection).toBeNull();

    // A settlement that captured the current generation installs normally.
    state.pendingAttachments = [pendingAttachment];
    await settleUploadedAttachment({
      activeBindingBySlotId: new Map(),
      attachmentGeneration,
      pendingAttachment,
      remoteDocumentId: fixture.writerProjection.documentId,
      state,
      uploadLane: lane,
      uploaded,
      writerProjectionGeneration: state.writerProjectionGeneration,
    });
    expect(state.writerProjection).toBe(
      fixture.writerProjection as DocumentWriterProjectionResponse,
    );
  } finally {
    close();
  }
});

import { expect, test } from "bun:test";
import { encodeVersionVector } from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import { createMemoryBlobStore } from "../../../data/blobs/memoryBlobStore";
import { attachmentContentSha256 } from "../../../data/documents/attachmentContentIdentity";
import {
  addDocumentAttachments,
  getDocumentAttachments,
  removeDocumentAttachment,
} from "../../../data/documents/documentContent";
import { sqlDocumentsPersistence } from "../../../data/persistence/documents/documentsPersistence";
import {
  createRemoteHistoryFixture,
  noopDocumentStorePersistenceEffects,
} from "./documentStore.testFixtures";
import { createRotationRecoveryRuntime } from "./rotationRecoveryHelpers.test";
import { createDocumentStoreState } from "./state";
import { syncPendingAttachments } from "./syncAttachments";
import { captureDocumentStoreSyncGeneration } from "./syncGeneration";

for (const change of [
  "removed",
  "replaced",
  "replaced-during-read",
  "queued-during-read",
  "reset-during-read",
  "corrupted",
  "read-failure",
]) {
  test(`pending upload cleanup handles ${change}`, async () => {
    const { execSql, close } = await createTestExecSql("superseded-upload");
    try {
      await sqlDocumentsPersistence.ensureSchema(execSql);
      const fixture = await createRemoteHistoryFixture();
      const baseRuntime = createRotationRecoveryRuntime({ execSql, fixture });
      const blobStore = createMemoryBlobStore();
      let uploadCalls = 0;
      const runtime = {
        ...baseRuntime,
        apiClient: Object.assign(baseRuntime.apiClient, {
          listDocumentAttachments: async () => [],
          createMultipartBlobStage: async () => {
            uploadCalls += 1;
            throw new Error("Superseded content must never upload");
          },
        }),
        infra: { ...baseRuntime.infra, blobStore },
      };
      const state = createDocumentStoreState(
        "local-document",
        runtime,
        sqlDocumentsPersistence,
        noopDocumentStorePersistenceEffects,
        fixture.writerProjection.documentId,
      );
      state.doc = fixture.remoteDocument;
      const bytes = new Uint8Array([1, 2, 3]);
      const pending = {
        byteLength: bytes.length,
        contentSha256: await attachmentContentSha256(bytes),
        localId: state.localId,
        mimeType: "application/octet-stream",
        name: "pending.bin",
        slotId: "slot-1",
        storageKey: "old-bytes",
        upload: null,
      };
      const replacement = {
        ...pending,
        contentSha256: "2".repeat(64),
        storageKey: "new-bytes",
      };
      addDocumentAttachments(state.doc, [pending]);
      const changeIntent = () => {
        if (change === "removed")
          removeDocumentAttachment(fixture.remoteDocument, pending.slotId);
        else addDocumentAttachments(fixture.remoteDocument, [replacement]);
      };
      if (change === "removed" || change === "replaced") changeIntent();
      await blobStore.writeBytes(
        pending.storageKey,
        change === "corrupted" ? new Uint8Array([4, 5, 6]) : bytes,
      );
      const open = blobStore.openByteSource.bind(blobStore);
      blobStore.openByteSource = async (key) => {
        const source = await open(key);
        if (!source) return null;
        return {
          byteLength: source.byteLength,
          read: async (offset, length) => {
            if (change === "read-failure")
              throw new Error("temporary source read failure");
            if (change === "replaced-during-read") changeIntent();
            if (change === "queued-during-read") {
              changeIntent();
              await sqlDocumentsPersistence.savePendingAttachment(
                execSql,
                replacement,
              );
              state.pendingAttachments = [replacement];
            }
            if (change === "reset-during-read") {
              changeIntent();
              state.localWriteGeneration += 1;
            }
            return source.read(offset, length);
          },
        };
      };
      const record = {
        accessEpoch: 1,
        containerId: "source-container",
        documentId: fixture.writerProjection.documentId,
        id: state.localId,
        snapshotEndVersion: encodeVersionVector(state.doc),
        text: "queued text",
      };
      await sqlDocumentsPersistence.saveDocument(execSql, record);
      await sqlDocumentsPersistence.savePendingAttachment(execSql, pending);
      state.pendingAttachments = [pending];
      const generation = captureDocumentStoreSyncGeneration(state, state.doc);
      if (!generation) throw new Error("Expected live upload generation");
      const syncing = syncPendingAttachments(
        state,
        record,
        {
          publicKey: fixture.publicKey,
          secretKey: fixture.secretKey,
        },
        generation,
      );
      if (change === "read-failure")
        await expect(syncing).rejects.toThrow("temporary source read failure");
      else await syncing;
      const remaining =
        change === "queued-during-read"
          ? [replacement]
          : change === "reset-during-read" || change === "read-failure"
            ? [pending]
            : [];
      expect(state.pendingAttachments).toEqual(remaining);
      expect(
        await sqlDocumentsPersistence.listPendingAttachments(
          execSql,
          state.localId,
        ),
      ).toEqual(remaining);
      expect(uploadCalls).toBe(0);
      expect(
        getDocumentAttachments(state.doc).map((item) => item.contentSha256),
      ).toEqual(
        change === "removed"
          ? []
          : [
              change === "corrupted" || change === "read-failure"
                ? pending.contentSha256
                : replacement.contentSha256,
            ],
      );
      const heldSource = await open(pending.storageKey);
      expect(await heldSource?.read(0, bytes.length)).toEqual(
        change === "corrupted" ? new Uint8Array([4, 5, 6]) : bytes,
      );
    } finally {
      close();
    }
  });
}

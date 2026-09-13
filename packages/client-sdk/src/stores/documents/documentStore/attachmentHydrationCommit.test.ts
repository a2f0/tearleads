import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { createMemoryBlobStore } from "../../../data/blobs/memoryBlobStore";
import { addDocumentAttachments } from "../../../data/documents/documentContent";
import { sqlDocumentsPersistence } from "../../../data/persistence/documents/documentsPersistence";
import { commitHydratedAttachment } from "./attachmentHydrationCommit";
import {
  createRemoteHistoryFixture,
  noopDocumentStorePersistenceEffects,
} from "./documentStore.testFixtures";
import { createRotationRecoveryRuntime } from "./rotationRecoveryHelpers.test";
import { createDocumentStoreState } from "./state";

for (const changed of ["document", "copy", "generation"]) {
  test(`hydration preserves held bytes when ${changed} changes during byte storage`, async () => {
    const { execSql, close } = await createTestExecSql("hydration-commit-race");
    try {
      await sqlDocumentsPersistence.ensureSchema(execSql);
      const fixture = await createRemoteHistoryFixture();
      const baseRuntime = createRotationRecoveryRuntime({ execSql, fixture });
      const runtime = {
        ...baseRuntime,
        infra: { ...baseRuntime.infra, blobStore: createMemoryBlobStore() },
      };
      const state = createDocumentStoreState(
        "local-document",
        runtime,
        sqlDocumentsPersistence,
        noopDocumentStorePersistenceEffects,
        fixture.writerProjection.documentId,
      );
      state.doc = fixture.remoteDocument;
      const intent = {
        byteLength: 4,
        contentSha256: "1".repeat(64),
        mimeType: "text/plain",
        name: "preview",
        slotId: "preview",
      };
      addDocumentAttachments(state.doc, [intent]);
      const held = {
        blobId: "held-blob",
        byteLength: 4,
        detachedAt: null,
        localId: state.localId,
        mimeType: "text/plain",
        slotId: "preview",
        storageKey: "held-copy",
      };
      await sqlDocumentsPersistence.saveLocalAttachment(execSql, held);
      state.attachmentBlobIdBySlotId = { preview: held.blobId };
      state.attachmentStorageKeyBySlotId = { preview: held.storageKey };
      await runtime.infra.blobStore.writeBytes(
        "held-copy",
        new Uint8Array([2, 2, 2, 2]),
      );
      const writeBytes = runtime.infra.blobStore.writeBytes.bind(
        runtime.infra.blobStore,
      );
      let currentGeneration = true;
      runtime.infra.blobStore.writeBytes = async (key, bytes) => {
        await writeBytes(key, bytes);
        if (changed === "document")
          addDocumentAttachments(fixture.remoteDocument, [
            { ...intent, contentSha256: "2".repeat(64) },
          ]);
        if (changed === "copy") {
          await writeBytes("newer-copy", new Uint8Array([3, 3, 3, 3]));
          await sqlDocumentsPersistence.saveLocalAttachment(execSql, {
            ...held,
            blobId: "newer-blob",
            storageKey: "newer-copy",
          });
        }
        if (changed === "generation") currentGeneration = false;
      };
      await commitHydratedAttachment({
        state,
        currentDoc: fixture.remoteDocument,
        expectedStorageKey: "held-copy",
        generationIsCurrent: () => currentGeneration,
        hydratedBlob: {
          attachment: intent,
          binding: { blobId: "replayed-blob" },
          bytes: new Uint8Array([1, 1, 1, 1]),
          storageKey: "replayed-copy",
        },
      });
      const rows = await sqlDocumentsPersistence.listLocalAttachments(
        execSql,
        state.localId,
      );
      expect(rows[0]?.storageKey).toBe(
        changed === "copy" ? "newer-copy" : "held-copy",
      );
      expect(state.attachmentStorageKeyBySlotId[intent.slotId]).toBe(
        changed === "copy" ? "newer-copy" : "held-copy",
      );
      expect(state.attachmentBlobIdBySlotId[intent.slotId]).toBe(
        changed === "copy" ? "newer-blob" : "held-blob",
      );
      const source = await runtime.infra.blobStore.openByteSource("held-copy");
      expect(await source?.read(0, 4)).toEqual(new Uint8Array([2, 2, 2, 2]));
    } finally {
      close();
    }
  });
}

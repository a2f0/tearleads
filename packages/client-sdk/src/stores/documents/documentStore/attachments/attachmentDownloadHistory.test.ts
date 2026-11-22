import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { createRotationRecoveryRuntime } from "../../../../../test/helpers/workflows/rotationRecoveryRuntime";
import { createMemoryBlobStore } from "../../../../data/blobs/memoryBlobStore";
import { addDocumentAttachments } from "../../../../data/documents/documentContent";
import { sqlDocumentsPersistence } from "../../../../data/persistence/documents/documentsPersistence";
import { getDomainDownloadHistorySnapshot } from "../../../../data/sync/downloadHistory";
import {
  createRemoteHistoryFixture,
  noopDocumentStorePersistenceEffects,
} from "../documentStore.testFixtures";
import { createDocumentStoreState } from "../state";
import { commitHydratedAttachment } from "./attachmentHydrationCommit";

const intent = {
  byteLength: 4,
  contentSha256: "1".repeat(64),
  mimeType: "application/pdf",
  name: "itinerary.pdf",
  slotId: "itinerary",
};

for (const heldBefore of [false, true]) {
  test(`storing a file ${heldBefore ? "over a held copy is not" : "a slot never held is"} a download`, async () => {
    const { execSql, close } = await createTestExecSql(
      `attachment-download-history-${heldBefore}`,
    );
    try {
      await sqlDocumentsPersistence.ensureSchema(execSql);
      const fixture = await createRemoteHistoryFixture();
      const baseRuntime = createRotationRecoveryRuntime({ execSql, fixture });
      const runtime = {
        ...baseRuntime,
        infra: { ...baseRuntime.infra, blobStore: createMemoryBlobStore() },
      };
      const documentId = fixture.writerProjection.documentId;
      const state = createDocumentStoreState(
        "local-document",
        runtime,
        sqlDocumentsPersistence,
        noopDocumentStorePersistenceEffects,
        documentId,
      );
      const record = {
        accessEpoch: 1,
        containerId: "trips",
        documentId,
        id: state.localId,
        snapshotEndVersion: "stored-frontier",
        text: "",
        title: "Trip notes",
      };
      await sqlDocumentsPersistence.saveDocument(execSql, record);
      state.record = record;
      state.doc = fixture.remoteDocument;
      addDocumentAttachments(state.doc, [intent]);
      if (heldBefore)
        await sqlDocumentsPersistence.saveLocalAttachment(execSql, {
          blobId: "held-blob",
          byteLength: 4,
          contentSha256: intent.contentSha256,
          detachedAt: null,
          localId: state.localId,
          mimeType: intent.mimeType,
          slotId: intent.slotId,
          storageKey: "held-copy",
        });

      await commitHydratedAttachment({
        state,
        currentDoc: fixture.remoteDocument,
        expectedStorageKey: heldBefore ? "held-copy" : null,
        generationIsCurrent: () => true,
        hydratedBlob: {
          attachment: intent,
          binding: { blobId: "served-blob" },
          bytes: new Uint8Array([1, 1, 1, 1]),
          contentSha256: intent.contentSha256,
          storageKey: "served-copy",
        },
      });

      const rows = await sqlDocumentsPersistence.listLocalAttachments(
        execSql,
        state.localId,
      );
      expect(rows[0]?.storageKey).toBe("served-copy");
      expect(
        getDomainDownloadHistorySnapshot(runtime.state.domainScope).completed,
      ).toEqual(
        heldBefore
          ? []
          : [
              {
                blobId: "served-blob",
                containerId: "trips",
                documentId,
                fileName: "itinerary.pdf",
                localId: state.localId,
                objectKind: "attachment",
                slotId: "itinerary",
                storageKey: "served-copy",
                title: "Trip notes",
              },
            ],
      );
    } finally {
      close();
    }
  });
}

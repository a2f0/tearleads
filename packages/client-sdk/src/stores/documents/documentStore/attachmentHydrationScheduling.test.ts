import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { addDocumentAttachments } from "../../../data/documents/documentContent";
import { sqlDocumentsPersistence } from "../../../data/persistence/documents/documentsPersistence";
import { hydrateAttachmentBlobs } from "./attachmentHydration";
import {
  createRemoteHistoryFixture,
  noopDocumentStorePersistenceEffects,
} from "./documentStore.testFixtures";
import {
  createRotationRecoveryRuntime,
  persistFullHistoryDocument,
} from "./rotationRecoveryHelpers.test";
import { createDocumentStoreState } from "./state";

test("settled attachments skip listings until a remote signal or missing/mismatched bytes", async () => {
  const { execSql, close } = await createTestExecSql("hydration-scheduling");
  const fixture = await createRemoteHistoryFixture();
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const runtime = createRotationRecoveryRuntime({ execSql, fixture });
    const state = createDocumentStoreState(
      "local",
      runtime,
      sqlDocumentsPersistence,
      noopDocumentStorePersistenceEffects,
      fixture.writerProjection.documentId,
    );
    const doc = fixture.remoteDocument;
    const attachment = {
      slotId: "file",
      name: "file",
      mimeType: "text/plain",
      byteLength: 4,
      contentSha256: "1".repeat(64),
    };
    addDocumentAttachments(doc, [attachment]);
    await persistFullHistoryDocument({
      doc,
      documentId: fixture.writerProjection.documentId,
      execSql,
      localId: "local",
    });
    const record = await sqlDocumentsPersistence.loadDocument(execSql, "local");
    state.attachmentStorageKeyBySlotId[attachment.slotId] = "held";
    state.attachmentContentSha256BySlotId[attachment.slotId] =
      attachment.contentSha256;
    let listings = 0;
    let signalDuringListing = false;
    runtime.apiClient.listDocumentAttachments = async () => {
      listings += 1;
      if (signalDuringListing) {
        state.remoteUpdateSignalSeq += 1;
        signalDuringListing = false;
      }
      return [];
    };
    await hydrateAttachmentBlobs(state, doc, record);
    await hydrateAttachmentBlobs(state, doc, record);
    expect(listings).toBe(0);
    state.remoteUpdateSignalSeq += 1;
    signalDuringListing = true;
    await hydrateAttachmentBlobs(state, doc, record);
    await hydrateAttachmentBlobs(state, doc, record);
    await hydrateAttachmentBlobs(state, doc, record);
    expect(listings).toBe(2);
    delete state.attachmentStorageKeyBySlotId[attachment.slotId];
    await hydrateAttachmentBlobs(state, doc, record);
    expect(listings).toBe(3);
    state.attachmentStorageKeyBySlotId[attachment.slotId] = "held";
    addDocumentAttachments(doc, [
      { ...attachment, contentSha256: "2".repeat(64) },
    ]);
    await hydrateAttachmentBlobs(state, doc, record);
    expect(listings).toBe(4);
    // Reloading the same remote document resets its signal sequence.
    state.attachmentContentSha256BySlotId[attachment.slotId] = "2".repeat(64);
    state.remoteUpdateSignalSeq = 1;
    const reloaded = doc.fork();
    try {
      await hydrateAttachmentBlobs(state, reloaded, record);
      expect(listings).toBe(5);
    } finally {
      reloaded.free();
    }
  } finally {
    fixture.remoteDocument.free();
    close();
  }
});

import { expect, test } from "bun:test";
import {
  createDocumentStore,
  createMemoryBlobStore,
} from "@tearleads/client-sdk";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import {
  cloneDocumentsTestRuntime,
  createPersistedDocumentSnapshot,
} from "../../../../test/helpers/document-store/documentStoreSyncFixtures";
import { createDocumentsPersistence } from "../../../../test/helpers/document-store/documentStoreSyncPersistence";
import { createOfflineAttachmentRuntime } from "../../../../test/helpers/document-store/documentStoreSyncRuntime";
import { waitForCondition } from "../../../../test/helpers/waitForCondition";

// Regression: the attach write persists the blob bytes + pending-attachment row
// BEFORE enqueuing the slot's CRDT op and persisting the snapshot. A crash in
// that window leaves bytes+row durable but the slot gone from the document, so
// on restart the attachment silently disappeared (and its bytes uploaded to a
// binding nothing referenced). Init must rebuild the dropped slot from the
// durable pending row.
test("an attachment slot lost to an interrupted write is recovered on init", async () => {
  const persistence = createDocumentsPersistence();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const localId = "recovered-attachment-note";
  const slotId = "slot-recovered-1";
  const storageKey = `${localId}-${slotId}`;

  const runtime = cloneDocumentsTestRuntime(
    createOfflineAttachmentRuntime(encapsulationKeyPair, "container-a"),
    { infra: { blobStore: createMemoryBlobStore() } },
  );

  // The persisted snapshot has NO attachment slot (the slot's op + snapshot
  // persist never landed), but the pending-attachment row survived the crash.
  await persistence.saveDocument(runtime.infra.execSql, {
    accessEpoch: 1,
    accessStateHash: null,
    containerId: "container-a",
    documentId: "remote-document",
    effectiveAccessLevel: "admin",
    id: localId,
    lastCommitLsn: "0/10",
    loroSnapshot: await createPersistedDocumentSnapshot("note text"),
    text: "note text",
    contentKeyBundle: "content-key-bundle",
    documentKekTargets: "kek-targets",
    documentManifestBundle: "manifest-bundle",
  });
  await persistence.savePendingAttachment(runtime.infra.execSql, {
    byteLength: 15,
    localId,
    mimeType: "image/png",
    name: "recovered.png",
    slotId,
    storageKey,
  });

  const store = createDocumentStore(localId, runtime, persistence);
  store.updateRuntime(runtime);

  await waitForCondition(
    () => store.getSnapshot().ready,
    "Recovered-attachment document store did not become ready.",
  );

  // The dropped slot is rebuilt from the durable pending row, so the attachment
  // is present again instead of silently disappearing.
  const attachments = store.getSnapshot().attachments;
  expect(attachments).toHaveLength(1);
  expect(attachments[0]?.slotId).toBe(slotId);
  expect(attachments[0]?.name).toBe("recovered.png");
  expect(attachments[0]?.byteLength).toBe(15);
});

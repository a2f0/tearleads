import { expect, test } from "bun:test";
import {
  addDocumentAttachments,
  createDocumentStore,
  createMemoryBlobStore,
} from "@tearleads/client-sdk";
import { bytesToHex, generateKemSeedAndKeyPair } from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  createDocument,
  encodeVersionVector,
  exportFullHistorySnapshot,
} from "@tearleads/loro";
import { cloneDocumentsTestRuntime } from "../../../../test/helpers/document-store/documentStoreSyncFixtures";
import { createDocumentsPersistence } from "../../../../test/helpers/document-store/documentStoreSyncPersistence";
import { createOfflineAttachmentRuntime } from "../../../../test/helpers/document-store/documentStoreSyncRuntime";
import { waitForCondition } from "../../../../test/helpers/waitForCondition";

// Regression: the attach write persists the blob bytes + pending-attachment row
// BEFORE enqueuing the slot's CRDT op and persisting the snapshot. A crash in
// that window leaves bytes+row durable but the slot gone from the document, so
// on restart the attachment silently disappeared (and its bytes uploaded to a
// binding nothing referenced). Init must rebuild the dropped slot from the
// durable pending row.
test.each([
  [false, true],
  [true, true],
  [false, false],
] as const)(
  "an interrupted attachment write recovers its content identity (replacing=%s, bytes=%s)",
  async (replacing, bytesAvailable) => {
    const persistence = createDocumentsPersistence();
    const encapsulationKeyPair = generateKemSeedAndKeyPair();
    const localId = `recovered-attachment-note-${replacing}`;
    const slotId = "slot-recovered-1";
    const storageKey = `${localId}-${slotId}`;

    const runtime = cloneDocumentsTestRuntime(
      createOfflineAttachmentRuntime(encapsulationKeyPair, "container-a"),
      { infra: { blobStore: createMemoryBlobStore() } },
    );

    // The persisted content has NO attachment slot (the slot's op + content
    // persist never landed), but the pending-attachment row survived the crash.
    // Content is seeded the way production persists it: a durable-history
    // checkpoint plus a record row carrying the content frontier.
    const persistedDoc = await createDocument("persisted-document-fixture");
    persistedDoc.getText("text").update("note text");
    if (replacing)
      addDocumentAttachments(persistedDoc, [
        {
          slotId,
          name: "recovered.png",
          mimeType: "image/png",
          byteLength: 15,
          contentSha256: bytesToHex(
            new Uint8Array(
              await crypto.subtle.digest("SHA-256", new Uint8Array(15).fill(1)),
            ),
          ),
        },
      ]);
    await persistence.replaceHistoryCheckpoint?.(runtime.infra.execSql, {
      coveredTailIds: [],
      endVersionVector: encodeVersionVector(persistedDoc),
      force: true,
      localId,
      snapshot: bytesToBase64(exportFullHistorySnapshot(persistedDoc)),
    });
    await persistence.saveDocument(runtime.infra.execSql, {
      accessEpoch: 1,
      accessStateHash: null,
      containerId: "container-a",
      documentId: "remote-document",
      effectiveAccessLevel: "admin",
      id: localId,
      lastCommitLsn: "0/10",
      snapshotEndVersion: encodeVersionVector(persistedDoc),
      text: "note text",
      contentKeyBundle: "content-key-bundle",
      documentKekTargets: "kek-targets",
      documentManifestBundle: "manifest-bundle",
    });
    await persistence.savePendingAttachment(runtime.infra.execSql, {
      byteLength: 15,
      contentSha256: bytesToHex(
        new Uint8Array(
          await crypto.subtle.digest("SHA-256", new Uint8Array(15)),
        ),
      ),
      localId,
      mimeType: "image/png",
      name: "recovered.png",
      slotId,
      storageKey,
    });

    if (bytesAvailable)
      await runtime.infra.blobStore.writeBytes(storageKey, new Uint8Array(15));
    let byteSourceReads = 0;
    const openByteSource = runtime.infra.blobStore.openByteSource.bind(
      runtime.infra.blobStore,
    );
    runtime.infra.blobStore.openByteSource = async (key) => {
      byteSourceReads++;
      return openByteSource(key);
    };
    const store = createDocumentStore(localId, runtime, persistence);
    // Capture every published snapshot to catch a transient empty-content flash:
    // the recovery persist must derive the snapshot from the loaded doc, not
    // preserve the still-empty initial snapshot, or it would publish a ready
    // snapshot with empty text over the real content during init.
    const readyTexts: string[] = [];
    store.subscribe(() => {
      const snapshot = store.getSnapshot();
      if (snapshot.ready) {
        readyTexts.push(snapshot.text);
      }
    });
    store.updateRuntime(runtime);

    await waitForCondition(
      () => store.getSnapshot().ready,
      "Recovered-attachment document store did not become ready.",
    );

    // The dropped slot is rebuilt from the durable pending row, so the attachment
    // is present again instead of silently disappearing.
    const attachments = store.getSnapshot().attachments;
    expect(attachments).toHaveLength(1);
    expect(byteSourceReads).toBe(0);
    expect(attachments[0]?.slotId).toBe(slotId);
    expect(attachments[0]?.name).toBe("recovered.png");
    expect(attachments[0]?.byteLength).toBe(15);
    expect(attachments[0]?.contentSha256).toBe(
      bytesToHex(
        new Uint8Array(
          await crypto.subtle.digest("SHA-256", new Uint8Array(15)),
        ),
      ),
    );
    expect(store.getSnapshot().text).toBe("note text");
    // No ready snapshot ever published empty content over the loaded text.
    expect(readyTexts).not.toContain("");
  },
);

test("a creation loser reloads attachment rows installed by the winner", async () => {
  const basePersistence = createDocumentsPersistence();
  const localId = "creation-loser-attachment-note";
  const slotId = "winner-slot";
  const storageKey = `${localId}-${slotId}`;
  let installedWinner = false;
  const persistence = {
    ...basePersistence,
    async createDocumentWithHistoryCheckpoint(
      ...input: Parameters<
        typeof basePersistence.createDocumentWithHistoryCheckpoint
      >
    ) {
      if (installedWinner) {
        return basePersistence.createDocumentWithHistoryCheckpoint(...input);
      }
      installedWinner = true;
      const [execSql, document, checkpoint, options, saveClientProjection] =
        input;
      const createdAt =
        await basePersistence.createDocumentWithHistoryCheckpoint(
          execSql,
          { ...document, documentId: "winning-document" },
          checkpoint,
          options,
          saveClientProjection,
        );
      expect(createdAt).not.toBeNull();
      await basePersistence.savePendingAttachment(execSql, {
        contentSha256: bytesToHex(
          new Uint8Array(
            await crypto.subtle.digest("SHA-256", new Uint8Array(12)),
          ),
        ),
        byteLength: 12,
        localId,
        mimeType: "text/plain",
        name: "winner.txt",
        slotId,
        storageKey,
      });
      await basePersistence.saveLocalAttachment(execSql, {
        blobId: null,
        byteLength: 12,
        contentSha256: "0".repeat(64),
        detachedAt: null,
        localId,
        mimeType: "text/plain",
        slotId,
        storageKey,
      });
      return null;
    },
  };
  const runtime = cloneDocumentsTestRuntime(
    createOfflineAttachmentRuntime(generateKemSeedAndKeyPair(), "container-a"),
    { infra: { blobStore: createMemoryBlobStore() } },
  );
  await runtime.infra.blobStore.writeBytes(storageKey, new Uint8Array(12));
  const store = createDocumentStore(localId, runtime, persistence);
  store.updateRuntime(runtime);

  await waitForCondition(
    () => store.getSnapshot().ready,
    "Creation-loser document store did not become ready.",
  );

  expect(store.getSnapshot()).toMatchObject({
    attachmentStorageKeyBySlotId: { [slotId]: storageKey },
    attachments: [
      {
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        byteLength: 12,
        mimeType: "text/plain",
        name: "winner.txt",
        slotId,
      },
    ],
    documentId: "winning-document",
  });
});

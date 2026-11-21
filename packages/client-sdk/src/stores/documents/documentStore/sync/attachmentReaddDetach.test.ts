import { expect, test } from "bun:test";
import {
  BINDING_ID,
  BLOB_ID,
  BYTES,
  binding,
  commitPulledReadd,
  LOCAL_ID,
  OTHER_BINDING_ID,
  OTHER_BLOB_ID,
  OTHER_BYTES,
  OTHER_STORAGE_KEY,
  removeAndDetach,
  SLOT_ID,
  STORAGE_KEY,
  withPanes,
} from "../../../../../test/helpers/stores/attachmentReaddPanes";
import { getDocumentAttachments } from "../../../../data/documents/documentContent";
import { listPendingDownloads } from "../../../../workflows/container-contents/documentQueries/pendingDownloads";
import {
  type DocumentsPersistence,
  defaultDocumentsPersistence,
  reclaimDocumentOrphanBlobs,
} from "../../../../workflows/documents";
import { replaceAttachmentInDocumentStore } from "../attachments";
import { commitHydratedAttachment } from "../attachments/attachmentHydrationCommit";
import type { DocumentStoreState } from "../state";

test.each([
  ["the restoring pane reopens", true],
  ["the restoring pane stays closed", false],
])(
  "a slot re-added with the same bytes before the binding list returns keeps its binding and copy (%s)",
  async (_label, secondPaneOpens) => {
    await withPanes("readd-same-copy", async (panes) => {
      const first = await panes.open();
      let second: DocumentStoreState | null = null;
      panes.server.onList = async () => {
        await commitPulledReadd(panes.execSql, BYTES);
        if (secondPaneOpens) second = await panes.open();
      };
      await removeAndDetach(first);

      expect(panes.server.detached).toEqual([]);
      expect(panes.server.bindings).toEqual([binding(BLOB_ID, BINDING_ID)]);
      expect(await panes.rows()).toMatchObject([
        { blobId: BLOB_ID, storageKey: STORAGE_KEY, detachedAt: null },
      ]);
      expect(first.attachmentStorageKeyBySlotId[SLOT_ID]).toBe(STORAGE_KEY);
      // The pane caught up with the re-add, so later passes list no marker.
      await first.writeChain;
      expect(first.snapshot.attachments).toMatchObject([{ slotId: SLOT_ID }]);
      if (second) {
        expect(
          (second as DocumentStoreState).snapshot.attachments,
        ).toMatchObject([{ slotId: SLOT_ID }]);
      }
      await reclaimDocumentOrphanBlobs(panes.runtime);
      expect(await panes.blobStore.readBytes(STORAGE_KEY)).toEqual(BYTES);
    });
  },
);

test("a slot re-added with other bytes keeps its new binding and frees its first download", async () => {
  await withPanes("readd-other-copy", async (panes) => {
    const first = await panes.open();
    panes.server.onList = async () => {
      // Another device replaced the slot's bytes and bound them.
      panes.server.bindings = [binding(OTHER_BLOB_ID, OTHER_BINDING_ID)];
      await commitPulledReadd(panes.execSql, OTHER_BYTES);
      const second = await panes.open();
      // Opening settled the earlier copy: the new one is a first download.
      expect(second.attachmentStorageKeyBySlotId[SLOT_ID]).toBeUndefined();
      expect(await listPendingDownloads(panes.execSql)).toMatchObject([
        { objectKind: "attachment", slotId: SLOT_ID },
      ]);
      const currentDoc = second.doc;
      if (!currentDoc) throw new Error("Expected a loaded document");
      const [attachment] = getDocumentAttachments(currentDoc);
      if (!attachment) throw new Error("Expected the re-added slot");
      // The verified download of the new bytes.
      await commitHydratedAttachment({
        state: second,
        currentDoc,
        hydratedBlob: {
          attachment,
          binding: { blobId: OTHER_BLOB_ID },
          bytes: OTHER_BYTES,
          contentSha256: attachment.contentSha256,
          storageKey: OTHER_STORAGE_KEY,
        },
        expectedStorageKey: null,
        generationIsCurrent: () => true,
      });
    };
    await removeAndDetach(first);

    expect(panes.server.detached).toEqual([]);
    expect(panes.server.bindings).toEqual([
      binding(OTHER_BLOB_ID, OTHER_BINDING_ID),
    ]);
    const reopened = await panes.open();
    expect(reopened.attachmentStorageKeyBySlotId[SLOT_ID]).toBe(
      OTHER_STORAGE_KEY,
    );
    expect(await panes.rows()).toMatchObject([
      {
        blobId: OTHER_BLOB_ID,
        storageKey: OTHER_STORAGE_KEY,
        detachedAt: null,
      },
    ]);
    await reclaimDocumentOrphanBlobs(panes.runtime);
    expect(await panes.blobStore.readBytes(OTHER_STORAGE_KEY)).toEqual(
      OTHER_BYTES,
    );
    expect(await panes.blobStore.readBytes(STORAGE_KEY)).toBeNull();
  });
});

test("a slot re-added while its detach is in flight uploads its held bytes again", async () => {
  await withPanes("readd-during-detach", async (panes) => {
    const first = await panes.open();
    panes.server.onDetach = () => commitPulledReadd(panes.execSql, BYTES);
    await removeAndDetach(first);

    // The detach landed, so the re-added slot has no binding until the held
    // bytes upload again.
    expect(panes.server.detached).toHaveLength(1);
    expect(panes.server.bindings).toEqual([]);
    expect(await panes.rows()).toMatchObject([
      { blobId: null, storageKey: STORAGE_KEY, detachedAt: null },
    ]);
    expect(await panes.pendingRows()).toMatchObject([
      { slotId: SLOT_ID, storageKey: STORAGE_KEY, name: "photo.bin" },
    ]);
    expect(first.pendingAttachments).toMatchObject([
      { slotId: SLOT_ID, storageKey: STORAGE_KEY },
    ]);
    await first.writeChain;
    // The live document caught up, so the upload lane sees the slot.
    expect(first.snapshot.attachments).toMatchObject([{ slotId: SLOT_ID }]);
    await reclaimDocumentOrphanBlobs(panes.runtime);
    expect(await panes.blobStore.readBytes(STORAGE_KEY)).toEqual(BYTES);
  });
});

test("a staged re-add that rolls back leaves the removal to clean up", async () => {
  await withPanes("readd-rolled-back", async (panes) => {
    const first = await panes.open();
    let failCommits = false;
    let refusedCommits = 0;
    const failing: DocumentsPersistence = {
      ...defaultDocumentsPersistence,
      commitDocumentMutation: async (...args) => {
        if (failCommits) {
          refusedCommits += 1;
          throw new Error("disk full");
        }
        return defaultDocumentsPersistence.commitDocumentMutation(...args);
      },
    };
    panes.server.onList = async () => {
      const second = await panes.open(failing);
      failCommits = true;
      await replaceAttachmentInDocumentStore(second, () => undefined, SLOT_ID, {
        bytes: OTHER_BYTES,
        mimeType: "application/octet-stream",
        name: "photo.bin",
      });
      // The staged re-add reached its commit, which failed and rolled back.
      expect(refusedCommits).toBe(1);
      expect(second.snapshot.attachments).toEqual([]);
    };
    await removeAndDetach(first);

    expect(panes.server.detached).toHaveLength(1);
    expect(panes.server.bindings).toEqual([]);
    expect(await panes.rows()).toEqual([]);
    expect(await panes.pendingRows()).toEqual([]);
    expect(first.attachmentStorageKeyBySlotId[SLOT_ID]).toBeUndefined();
    await reclaimDocumentOrphanBlobs(panes.runtime);
    expect(await panes.blobStore.readBytes(STORAGE_KEY)).toBeNull();
  });
});

test.each([
  ["other bytes", OTHER_BYTES],
  ["the same bytes", BYTES],
])(
  "a re-add another device bound before its content update arrived keeps its binding (%s)",
  async (_label, bytes) => {
    await withPanes("readd-bound-first", async (panes) => {
      const first = await panes.open();
      const theirs = binding(OTHER_BLOB_ID, OTHER_BINDING_ID);
      panes.server.onList = async () => {
        // The other device binds first; its content update is still on its way.
        panes.server.bindings = [theirs];
      };
      await removeAndDetach(first);

      expect(panes.server.detached).toEqual([]);
      expect(panes.server.bindings).toEqual([theirs]);
      // This copy's binding was replaced, so it owes no detach.
      expect(await panes.rows()).toEqual([]);
      await reclaimDocumentOrphanBlobs(panes.runtime);
      expect(await panes.blobStore.readBytes(STORAGE_KEY)).toBeNull();
      // The content update arrives: the re-add is a first download.
      await commitPulledReadd(panes.execSql, bytes);
      await panes.open();
      expect(await listPendingDownloads(panes.execSql)).toMatchObject([
        { objectKind: "attachment", slotId: SLOT_ID },
      ]);
    });
  },
);

test("a settle refused before commit writes nothing", async () => {
  await withPanes("readd-settle-refused", async (panes) => {
    const before = await panes.rows();
    expect(
      await defaultDocumentsPersistence.settleAttachmentRemovalMarker(
        panes.execSql,
        {
          localId: LOCAL_ID,
          settle: () => ({
            marker: { status: "dropped" },
            pending: null,
            row: null,
            write: "delete",
          }),
          slotId: SLOT_ID,
          stillCurrent: () => false,
        },
      ),
    ).toBeNull();
    expect(await panes.rows()).toEqual(before);
  });
});

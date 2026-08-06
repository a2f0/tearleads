import { expect, test } from "bun:test";
import { deleteLocalAttachmentRecord } from "./attachmentPersistence";
import type { DocumentStoreState } from "./state";

test("deleteLocalAttachmentRecord preserves a newer same-slot storage key", async () => {
  const deletedAttachments: string[] = [];
  const state = {
    attachmentBlobIdBySlotId: { "slot-1": "blob-new" },
    attachmentStorageKeyBySlotId: { "slot-1": "storage-new" },
    doc: null,
    localId: "local-1",
    persistence: {
      deleteLocalAttachment: async (
        _execSql: unknown,
        _localId: string,
        _slotId: string,
        storageKey: string,
      ) => {
        deletedAttachments.push(storageKey);
      },
    },
    runtime: {
      infra: {
        execSql: async () => [],
      },
    },
  } as unknown as DocumentStoreState;

  await deleteLocalAttachmentRecord(state, "slot-1", "storage-old", null);

  expect(deletedAttachments).toEqual(["storage-old"]);
  expect(state.attachmentStorageKeyBySlotId).toEqual({
    "slot-1": "storage-new",
  });
  expect(state.attachmentBlobIdBySlotId).toEqual({ "slot-1": "blob-new" });
});

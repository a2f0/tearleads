import { expect, test } from "bun:test";
import type { SettleAttachmentRemovalMarkerInput } from "../../../../data/persistence/documents/attachmentRecords";
import type { DocumentStoreState } from "../state";
import { settleAttachmentRemovalMarker } from "./attachmentRemovalMarkers";

test("a settled marker leaves a newer same-slot copy mapped", async () => {
  const settles: string[] = [];
  const state = {
    attachmentBlobIdBySlotId: { "slot-1": "blob-new" },
    attachmentContentSha256BySlotId: { "slot-1": "digest-new" },
    attachmentStorageKeyBySlotId: { "slot-1": "storage-new" },
    doc: null,
    localId: "local-1",
    persistence: {
      // The durable row is gone: another write already settled the slot.
      settleAttachmentRemovalMarker: async (
        _execSql: unknown,
        input: SettleAttachmentRemovalMarkerInput,
      ) => {
        settles.push(input.slotId);
        return input.settle({ committed: undefined, row: null });
      },
    },
    runtime: { infra: { execSql: async () => [] } },
  } as unknown as DocumentStoreState;

  expect(
    await settleAttachmentRemovalMarker({
      doc: null,
      from: { status: "remoteDetached" },
      marker: { slotId: "slot-1", storageKey: "storage-old" },
      state,
      stillCurrent: () => true,
    }),
  ).toEqual({ status: "superseded" });

  expect(settles).toEqual(["slot-1"]);
  expect(state.attachmentStorageKeyBySlotId).toEqual({
    "slot-1": "storage-new",
  });
  expect(state.attachmentBlobIdBySlotId).toEqual({ "slot-1": "blob-new" });
});

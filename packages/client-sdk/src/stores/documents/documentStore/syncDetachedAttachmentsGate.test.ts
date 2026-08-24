import { expect, test } from "bun:test";
import type { DocumentRecord } from "../../../workflows/documents";
import { canSyncDetachedAttachmentBindings } from "./sync";

const record = {
  accessEpoch: 1,
  containerId: "container-1",
  documentId: "document-1",
  id: "local-1",
  snapshotEndVersion: "",
  text: "",
} satisfies DocumentRecord;

test("detached writes wait for both outgoing and paginated pull work", () => {
  expect(canSyncDetachedAttachmentBindings(record, 0)).toBe(true);
  expect(canSyncDetachedAttachmentBindings(record, 1)).toBe(false);
  expect(
    canSyncDetachedAttachmentBindings(
      {
        ...record,
        pullContinuation: {
          commitLsn: "0/2",
          commitLsnMode: "tracked",
          cursor: "page-2",
        },
      },
      0,
    ),
  ).toBe(false);
  expect(
    canSyncDetachedAttachmentBindings(
      { ...record, pullContinuationRecoveryRequired: true },
      0,
    ),
  ).toBe(false);
});

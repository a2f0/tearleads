import { expect, test } from "bun:test";
import {
  item,
  lane,
  operation,
  upload,
} from "../../../../../test/helpers/explorer/syncPanelFixtures";
import { EXPLORER_LABELS } from "../../labels";
import { deriveOutgoingRows, type OutgoingRowsInput } from "./outgoingRows";
import { deriveExplorerUploadItemStatus } from "./uploadTransfer";

function rows(input: Partial<OutgoingRowsInput>) {
  return deriveOutgoingRows({
    billingBlockedOrganizationId: null,
    lanes: [],
    uploads: [],
    writes: [],
    ...input,
  });
}

const importedFile = upload({
  fileName: "a.txt",
  id: "upload-1",
  localId: "document-local-id",
  status: "imported",
});

test("a file joins its document's write-queue entry and appears once", () => {
  const derived = rows({ uploads: [importedFile], writes: [item()] });

  expect(derived.map((row) => [row.kind, row.key])).toEqual([
    ["file-write", "upload:upload-1"],
  ]);
});

test("rows without a partner still render", () => {
  const derived = rows({
    uploads: [upload({ id: "upload-1", status: "queued" })],
    writes: [
      item({ localId: "edited-note", name: "Edited note" }),
      item({ containerId: null, localId: "projects", objectKind: "container" }),
    ],
  });

  expect(derived.map((row) => [row.kind, row.key])).toEqual([
    ["file", "upload:upload-1"],
    ["write", "write:document::edited-note"],
    ["write", "write:container::projects"],
  ]);
});

test("an unrecognized document kind never joins a file of the same id", () => {
  const derived = rows({
    uploads: [importedFile],
    writes: [item({ namespace: "custom-kind" })],
  });

  expect(derived.map((row) => row.kind)).toEqual(["write", "file"]);
});

test("files waiting to import lead, the queue keeps its order, and finished files trail newest first", () => {
  const derived = rows({
    uploads: [
      upload({ id: "cancelled", status: "cancelled" }),
      upload({ id: "uploaded", localId: "uploaded-doc", status: "uploaded" }),
      upload({ id: "unlisted", localId: "unlisted-doc", status: "imported" }),
      upload({ id: "joined", localId: "joined-doc", status: "imported" }),
      upload({ id: "failed", status: "failed" }),
      upload({ id: "importing", status: "importing" }),
      upload({ id: "queued", status: "queued" }),
    ],
    writes: [
      item({ localId: "older-edit" }),
      item({ localId: "joined-doc" }),
      item({ localId: "newer-edit" }),
    ],
  });

  expect(derived.map((row) => row.key)).toEqual([
    "upload:importing",
    "upload:queued",
    "write:document::older-edit",
    "upload:joined",
    "write:document::newer-edit",
    "upload:unlisted",
    "upload:failed",
    "upload:uploaded",
    "upload:cancelled",
  ]);
});

test("a joined file reads as its upload while on its way, and as the queue once that explains more", () => {
  const running = [lane({ status: "running" })];
  const [uploading] = rows({
    lanes: running,
    uploads: [importedFile],
    writes: [item()],
  });
  expect(uploading?.transfer.label).toBe(
    EXPLORER_LABELS.uploadsUploadingStatus,
  );

  const [failed] = rows({
    lanes: running,
    uploads: [importedFile],
    writes: [
      item({
        operations: [operation({ lastError: "Manifest write rejected" })],
        status: "error",
      }),
    ],
  });
  expect(failed?.transfer).toMatchObject({
    detail: "Manifest write rejected",
    label: EXPLORER_LABELS.writeQueueErrorStatus,
    status: "error",
  });

  const [paused] = rows({
    billingBlockedOrganizationId: "personal-org",
    lanes: running,
    uploads: [importedFile],
    writes: [item()],
  });
  expect(paused?.transfer).toMatchObject({
    detail: EXPLORER_LABELS.writeQueueBillingPaused,
    label: EXPLORER_LABELS.writeQueuePendingStatus,
  });

  // The upload finished, and the document has since been edited.
  const [edited] = rows({
    uploads: [{ ...importedFile, status: "uploaded" }],
    writes: [item()],
  });
  expect(edited?.kind).toBe("file-write");
  expect(edited?.transfer.label).toBe(EXPLORER_LABELS.writeQueuePendingStatus);
});

test("an imported file's bar follows its attachments' transferred bytes", () => {
  const [row] = rows({
    lanes: [
      lane({ status: "running" }),
      lane({
        blobStorageKey: "blob-1",
        key: "blobs:blob-1",
        progress: {
          bytesTotal: 4096,
          bytesUploaded: 1024,
          partsCompleted: 1,
          partsTotal: 4,
        },
        status: "running",
      }),
    ],
    uploads: [{ ...importedFile, storageKeys: ["blob-1"] }],
  });

  expect(row?.transfer.percent).toBe(25);
});

test("ingest statuses pass through; imported items refine by sync lane", () => {
  expect(deriveExplorerUploadItemStatus(upload(), undefined)).toBe("queued");
  expect(
    deriveExplorerUploadItemStatus(upload({ status: "failed" }), undefined),
  ).toBe("failed");
  expect(deriveExplorerUploadItemStatus(importedFile, undefined)).toBe(
    "pending-sync",
  );
  expect(deriveExplorerUploadItemStatus(importedFile, lane())).toBe(
    "pending-sync",
  );
  expect(
    deriveExplorerUploadItemStatus(importedFile, lane({ status: "queued" })),
  ).toBe("sync-queued");
  expect(
    deriveExplorerUploadItemStatus(importedFile, lane({ status: "running" })),
  ).toBe("uploading");
  // A completed lane waits for the SDK to confirm nothing is left to sync.
  expect(
    deriveExplorerUploadItemStatus(importedFile, lane({ status: "complete" })),
  ).toBe("pending-sync");
  expect(
    deriveExplorerUploadItemStatus(
      { ...importedFile, status: "uploaded" },
      lane({ status: "error" }),
    ),
  ).toBe("uploaded");
  expect(
    deriveExplorerUploadItemStatus(importedFile, lane({ status: "error" })),
  ).toBe("sync-failed");
});

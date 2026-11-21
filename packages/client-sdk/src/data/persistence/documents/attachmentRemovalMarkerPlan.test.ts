import { expect, test } from "bun:test";
import type { LocalAttachmentRecord } from "./attachmentRecords";
import { planAttachmentRemovalMarkerSettlement } from "./attachmentRemovalMarkerPlan";

const DIGEST = "a".repeat(64);
const NOW = "2026-11-21T00:00:00.000Z";
const heldRow: LocalAttachmentRecord = {
  blobId: "blob-1",
  byteLength: 3,
  contentSha256: DIGEST,
  detachedAt: null,
  localId: "doc-1",
  mimeType: "application/octet-stream",
  slotId: "photo",
  storageKey: "blob-blob-1",
};
const committed = {
  byteLength: 3,
  contentSha256: DIGEST,
  mimeType: "image/png",
  name: "renamed.png",
  slotId: "photo",
};

test("a live row of a removed slot is marked detached at the settle time", () => {
  expect(
    planAttachmentRemovalMarkerSettlement({
      from: { status: "awaitingDetach" },
      now: NOW,
      observed: { committed: undefined, row: heldRow },
      storageKey: heldRow.storageKey,
    }),
  ).toEqual({
    marker: { status: "awaitingDetach" },
    pending: null,
    row: { ...heldRow, detachedAt: NOW },
    write: "upsert",
  });
});

test("a rebound copy is held unbound and queued under the committed name", () => {
  const detached = { ...heldRow, detachedAt: NOW };
  expect(
    planAttachmentRemovalMarkerSettlement({
      from: { status: "remoteDetached" },
      now: NOW,
      observed: { committed, row: detached },
      storageKey: heldRow.storageKey,
    }),
  ).toEqual({
    marker: { mimeType: "image/png", name: "renamed.png", status: "rebinding" },
    pending: {
      byteLength: 3,
      contentSha256: DIGEST,
      localId: "doc-1",
      mimeType: "image/png",
      name: "renamed.png",
      slotId: "photo",
      storageKey: heldRow.storageKey,
    },
    row: { ...heldRow, blobId: null, detachedAt: null },
    write: "upsert",
  });
});

test("a dropped marker deletes its row and a superseded one writes nothing", () => {
  const detached = { ...heldRow, detachedAt: NOW };
  expect(
    planAttachmentRemovalMarkerSettlement({
      from: { status: "bindingReplaced" },
      now: NOW,
      observed: { committed: undefined, row: detached },
      storageKey: heldRow.storageKey,
    }),
  ).toEqual({
    marker: { status: "dropped" },
    pending: null,
    row: null,
    write: "delete",
  });
  // Another writer refilled the slot under a new key: its row is reported.
  const refilled = { ...heldRow, storageKey: "blob-blob-2" };
  expect(
    planAttachmentRemovalMarkerSettlement({
      from: { status: "remoteDetached" },
      now: NOW,
      observed: { committed, row: refilled },
      storageKey: heldRow.storageKey,
    }),
  ).toEqual({
    marker: { status: "superseded" },
    pending: null,
    row: refilled,
    write: "none",
  });
});

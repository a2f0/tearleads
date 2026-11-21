import { describe, expect, test } from "bun:test";
import {
  type AttachmentMarkerRow,
  type AttachmentRemovalMarker,
  attachmentMarkerRowEffect,
  type CommittedAttachmentSlot,
  isOpenAttachmentRemovalMarker,
  type OpenAttachmentRemovalMarker,
  observeAttachmentMarkerRow,
  observeCommittedAttachmentSlot,
  observeMarkerBinding,
  transitionAttachmentRemovalMarker,
} from "./attachmentRemovalMarkerMachine";

const SAME = "a".repeat(64);
const OTHER = "b".repeat(64);
const committedPhoto = {
  contentSha256: SAME,
  mimeType: "image/png",
  name: "photo.png",
};
const rows = {
  absent: { kind: "absent" },
  detached: { bound: true, contentSha256: SAME, kind: "detached" },
  live: { bound: true, contentSha256: SAME, kind: "live" },
  unbound: { bound: false, contentSha256: SAME, kind: "detached" },
} satisfies Record<string, AttachmentMarkerRow>;
const slots = {
  other: { ...committedPhoto, contentSha256: OTHER, kind: "present" },
  removed: { kind: "removed" },
  same: { ...committedPhoto, kind: "present" },
} satisfies Record<string, CommittedAttachmentSlot>;

function check(
  from: OpenAttachmentRemovalMarker["status"],
  row: keyof typeof rows,
  slot: keyof typeof slots,
) {
  const next = transitionAttachmentRemovalMarker(
    { status: from },
    { row: rows[row], slot: slots[slot], type: "committedChecked" },
  );
  return [next.status, attachmentMarkerRowEffect(next, rows[row]).kind];
}

describe("committed history settles an open marker", () => {
  test.each([
    ["awaitingDetach", "detached", "removed", "awaitingDetach", "none"],
    ["awaitingDetach", "live", "removed", "awaitingDetach", "markDetached"],
    ["awaitingDetach", "detached", "same", "held", "revive"],
    ["awaitingDetach", "live", "same", "held", "none"],
    ["awaitingDetach", "unbound", "same", "rebinding", "requeueUpload"],
    ["awaitingDetach", "detached", "other", "dropped", "delete"],
    ["awaitingDetach", "live", "other", "held", "none"],
    ["remoteDetached", "detached", "removed", "dropped", "delete"],
    ["remoteDetached", "live", "removed", "dropped", "delete"],
    ["remoteDetached", "detached", "same", "rebinding", "requeueUpload"],
    ["remoteDetached", "live", "same", "rebinding", "requeueUpload"],
    ["remoteDetached", "detached", "other", "dropped", "delete"],
    ["remoteDetached", "live", "other", "held", "none"],
    ["bindingReplaced", "detached", "removed", "bindingReplaced", "none"],
    ["bindingReplaced", "live", "removed", "bindingReplaced", "markDetached"],
    ["bindingReplaced", "detached", "same", "held", "revive"],
    ["bindingReplaced", "live", "same", "held", "none"],
    ["bindingReplaced", "unbound", "same", "rebinding", "requeueUpload"],
    ["bindingReplaced", "detached", "other", "dropped", "delete"],
    ["bindingReplaced", "live", "other", "held", "none"],
    ["bindingUnknown", "detached", "removed", "bindingUnknown", "none"],
    ["bindingUnknown", "live", "removed", "bindingUnknown", "markDetached"],
    ["bindingUnknown", "detached", "same", "rebinding", "requeueUpload"],
    ["bindingUnknown", "live", "same", "held", "none"],
    ["bindingUnknown", "detached", "other", "dropped", "delete"],
    ["bindingUnknown", "live", "other", "held", "none"],
    ["awaitingDetach", "absent", "removed", "superseded", "none"],
    ["bindingReplaced", "absent", "same", "superseded", "none"],
    ["remoteDetached", "absent", "other", "superseded", "none"],
  ] as const)(
    "%s, row %s, slot %s -> %s (%s)",
    (from, row, slot, to, effect) => {
      expect(check(from, row, slot)).toEqual([to, effect]);
    },
  );
});

test("a rebound copy is requeued under the committed name and type", () => {
  const next = transitionAttachmentRemovalMarker(
    { status: "remoteDetached" },
    { row: rows.detached, slot: slots.same, type: "committedChecked" },
  );
  expect(next).toEqual({
    mimeType: "image/png",
    name: "photo.png",
    status: "rebinding",
  });
  expect(attachmentMarkerRowEffect(next, rows.detached)).toEqual({
    kind: "requeueUpload",
    mimeType: "image/png",
    name: "photo.png",
  });
});

test("a landed detach moves only an awaiting marker", () => {
  expect(
    transitionAttachmentRemovalMarker(
      { status: "awaitingDetach" },
      { type: "remoteDetachSettled" },
    ),
  ).toEqual({ status: "remoteDetached" });
  for (const status of [
    "remoteDetached",
    "bindingReplaced",
    "bindingUnknown",
  ] as const) {
    expect(
      transitionAttachmentRemovalMarker(
        { status },
        { type: "remoteDetachSettled" },
      ),
    ).toEqual({ status });
  }
});

test.each([
  { status: "held" },
  { mimeType: null, name: "photo.png", status: "rebinding" },
  { status: "dropped" },
  { status: "superseded" },
] satisfies AttachmentRemovalMarker[])(
  "a settled $status marker ignores every event",
  (state) => {
    expect(isOpenAttachmentRemovalMarker(state)).toBe(false);
    expect(
      transitionAttachmentRemovalMarker(state, { type: "remoteDetachSettled" }),
    ).toBe(state);
    expect(
      transitionAttachmentRemovalMarker(state, {
        row: rows.detached,
        slot: slots.removed,
        type: "committedChecked",
      }),
    ).toBe(state);
  },
);

test("a binding of another blob is the marker's once it outlives a pull", () => {
  const own = { bindingId: "binding-a", blobId: "blob-a" };
  const other = { bindingId: "binding-b", blobId: "blob-b" };
  expect(observeMarkerBinding(undefined, "blob-a")).toEqual({
    status: "remoteDetached",
  });
  expect(observeMarkerBinding(own, "blob-a")).toEqual({
    status: "awaitingDetach",
  });
  // Possibly another writer's re-add, bound before its content update.
  expect(observeMarkerBinding(other, "blob-a")).toEqual({
    status: "bindingReplaced",
  });
  expect(observeMarkerBinding(other, null)).toEqual({
    status: "bindingReplaced",
  });
  // Still listed after a later pull: the copy this one replaced, or a
  // download the removal overtook.
  expect(observeMarkerBinding(other, null, "binding-b")).toEqual({
    status: "awaitingDetach",
  });
  expect(observeMarkerBinding(other, "blob-a", "binding-c")).toEqual({
    status: "bindingReplaced",
  });
});

test("observations name the marker's own copy only", () => {
  const row = {
    blobId: "blob-a",
    contentSha256: SAME,
    detachedAt: "t",
    storageKey: "key",
  };
  expect(observeAttachmentMarkerRow(row, "key")).toEqual(rows.detached);
  expect(
    observeAttachmentMarkerRow({ ...row, detachedAt: null }, "key"),
  ).toEqual(rows.live);
  // Another writer refilled the slot under a new key.
  expect(observeAttachmentMarkerRow({ ...row, blobId: null }, "key")).toEqual(
    rows.unbound,
  );
  expect(observeAttachmentMarkerRow(row, "other-key")).toEqual(rows.absent);
  expect(observeAttachmentMarkerRow(null, "key")).toEqual(rows.absent);
  expect(observeCommittedAttachmentSlot(undefined)).toEqual(slots.removed);
  expect(observeCommittedAttachmentSlot(committedPhoto)).toEqual(slots.same);
});

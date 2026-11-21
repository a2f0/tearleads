import { describe, expect, test } from "bun:test";
import {
  type AttachmentMarkerRow,
  type AttachmentRemovalMarker,
  attachmentMarkerRowEffect,
  type CommittedAttachmentSlot,
  observeAttachmentMarkerRow,
  observeCommittedAttachmentSlot,
  transitionAttachmentRemovalMarker,
} from "./attachmentRemovalMarkerMachine";

const SAME = "a".repeat(64);
const OTHER = "b".repeat(64);
const rows = {
  absent: { kind: "absent" },
  detached: { contentSha256: SAME, kind: "detached" },
  live: { contentSha256: SAME, kind: "live" },
} satisfies Record<string, AttachmentMarkerRow>;
const slots = {
  other: { contentSha256: OTHER, kind: "present" },
  removed: { kind: "removed" },
  same: { contentSha256: SAME, kind: "present" },
} satisfies Record<string, CommittedAttachmentSlot>;

function check(
  from: AttachmentRemovalMarker["status"],
  row: keyof typeof rows,
  slot: keyof typeof slots,
) {
  const state = { status: from } as AttachmentRemovalMarker;
  const next = transitionAttachmentRemovalMarker(state, {
    row: rows[row],
    slot: slots[slot],
    type: "committedChecked",
  });
  return [next.status, attachmentMarkerRowEffect(next, rows[row])];
}

describe("committed history settles an open marker", () => {
  test.each([
    ["awaitingDetach", "detached", "removed", "awaitingDetach", "none"],
    ["awaitingDetach", "live", "removed", "awaitingDetach", "markDetached"],
    ["awaitingDetach", "detached", "same", "held", "revive"],
    ["awaitingDetach", "live", "same", "held", "none"],
    ["awaitingDetach", "detached", "other", "dropped", "delete"],
    ["awaitingDetach", "live", "other", "held", "none"],
    ["remoteDetached", "detached", "removed", "dropped", "delete"],
    ["remoteDetached", "live", "removed", "dropped", "delete"],
    ["remoteDetached", "detached", "same", "rebinding", "requeueUpload"],
    ["remoteDetached", "live", "same", "rebinding", "requeueUpload"],
    ["remoteDetached", "detached", "other", "dropped", "delete"],
    ["remoteDetached", "live", "other", "held", "none"],
    ["awaitingDetach", "absent", "removed", "superseded", "none"],
    ["awaitingDetach", "absent", "same", "superseded", "none"],
    ["remoteDetached", "absent", "other", "superseded", "none"],
  ] as const)(
    "%s, row %s, slot %s -> %s (%s)",
    (from, row, slot, to, effect) => {
      expect(check(from, row, slot)).toEqual([to, effect]);
    },
  );
});

test("a landed detach moves only an awaiting marker", () => {
  expect(
    transitionAttachmentRemovalMarker(
      { status: "awaitingDetach" },
      { type: "remoteDetachSettled" },
    ),
  ).toEqual({ status: "remoteDetached" });
  expect(
    transitionAttachmentRemovalMarker(
      { status: "remoteDetached" },
      { type: "remoteDetachSettled" },
    ),
  ).toEqual({ status: "remoteDetached" });
});

test.each(["held", "rebinding", "dropped", "superseded"] as const)(
  "a settled %s marker ignores every event",
  (status) => {
    const state = { status } as AttachmentRemovalMarker;
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

test("observations name the marker's own copy only", () => {
  const row = { contentSha256: SAME, detachedAt: "t", storageKey: "key" };
  expect(observeAttachmentMarkerRow(row, "key")).toEqual(rows.detached);
  expect(
    observeAttachmentMarkerRow({ ...row, detachedAt: null }, "key"),
  ).toEqual(rows.live);
  // Another writer refilled the slot under a new key.
  expect(observeAttachmentMarkerRow(row, "other-key")).toEqual(rows.absent);
  expect(observeAttachmentMarkerRow(null, "key")).toEqual(rows.absent);
  expect(observeCommittedAttachmentSlot(undefined)).toEqual(slots.removed);
  expect(observeCommittedAttachmentSlot({ contentSha256: SAME })).toEqual(
    slots.same,
  );
});

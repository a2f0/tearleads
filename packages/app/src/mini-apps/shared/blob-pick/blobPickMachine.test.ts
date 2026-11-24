import { expect, test } from "bun:test";
import {
  type BlobPickState,
  type BlobPickTarget,
  blobPickTarget,
  IDLE_BLOB_PICK,
  transitionBlobPick,
} from "./blobPickMachine";

const TARGET: BlobPickTarget = {
  containerId: "c1",
  localId: "n1",
  slotId: "slot",
  slotLabel: "Attachment",
};
const PICKING: BlobPickState = { status: "picking", target: TARGET };
const RETURNING: BlobPickState = { status: "returning", target: TARGET };

test("a request starts a pick for its target, replacing any earlier one", () => {
  const other = { ...TARGET, localId: "n2" };
  expect(
    transitionBlobPick(IDLE_BLOB_PICK, { type: "requested", target: TARGET }),
  ).toEqual(PICKING);
  expect(
    transitionBlobPick(PICKING, { type: "requested", target: other }),
  ).toEqual({ status: "picking", target: other });
});

test("finishing ends the pick at once when no route has to be left", () => {
  expect(
    transitionBlobPick(PICKING, { type: "finished", awaitsRoute: false }),
  ).toBe(IDLE_BLOB_PICK);
});

test("finishing keeps the target until the picker's route is left", () => {
  const returning = transitionBlobPick(PICKING, {
    type: "finished",
    awaitsRoute: true,
  });
  expect(returning).toEqual(RETURNING);
  expect(blobPickTarget(returning)).toBe(TARGET);
  expect(transitionBlobPick(returning, { type: "picker-route-left" })).toBe(
    IDLE_BLOB_PICK,
  );
});

test("only a pick in progress can finish", () => {
  const finished = { type: "finished", awaitsRoute: true } as const;
  expect(transitionBlobPick(IDLE_BLOB_PICK, finished)).toBe(IDLE_BLOB_PICK);
  expect(transitionBlobPick(RETURNING, finished)).toBe(RETURNING);
});

test("leaving the picker's route abandons a pick still in progress", () => {
  expect(transitionBlobPick(PICKING, { type: "picker-route-left" })).toBe(
    IDLE_BLOB_PICK,
  );
  expect(blobPickTarget(IDLE_BLOB_PICK)).toBeNull();
});

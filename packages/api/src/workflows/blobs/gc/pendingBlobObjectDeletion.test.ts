import { expect, test } from "bun:test";
import { selectFairBlobWorkCandidates } from "./fairBlobWorkSelection";

test("pending deletion selection deduplicates rows across query snapshots", () => {
  const duplicate = {
    blobId: "duplicate",
    queuedAt: new Date("2026-08-22T00:00:00.000Z"),
    storageKey: "storage:duplicate",
  };
  const healthy = {
    blobId: "healthy",
    queuedAt: new Date("2026-08-22T00:01:00.000Z"),
    storageKey: "storage:healthy",
  };

  expect(
    selectFairBlobWorkCandidates(
      [duplicate, healthy],
      [{ ...duplicate, queuedAt: new Date("2026-08-22T00:02:00.000Z") }],
      2,
    ).map((candidate) => candidate.blobId),
  ).toEqual(["healthy", "duplicate"]);
});

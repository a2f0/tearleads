import { expect, test } from "bun:test";
import { PendingBlobDeletionsResponseSchema } from "../response";
import {
  PendingBlobDeletionsQuerySchema,
  RootPendingBlobDeletionsQuerySchema,
} from "./pendingBlobDeletions";

const organizationId = "b7e39441-10b9-4ada-b1c2-b7da295f348a";

test("pending deletion page limits accept bounded HTTP integers without coercing invalid values", () => {
  for (const limit of [1, "1", 50, "50", 100, "100"]) {
    expect(PendingBlobDeletionsQuerySchema.parse({ limit }).limit).toBe(
      Number(limit),
    );
  }
  for (const limit of [
    0,
    "0",
    101,
    "101",
    -1,
    1.5,
    "1.5",
    "1e2",
    " 1 ",
    "",
    null,
    true,
    [],
    {},
    Infinity,
    NaN,
  ]) {
    expect(PendingBlobDeletionsQuerySchema.safeParse({ limit }).success).toBe(
      false,
    );
  }
  expect(PendingBlobDeletionsQuerySchema.parse({})).toEqual({});
  for (const cursor of ["", "a".repeat(513), null, 1]) {
    expect(PendingBlobDeletionsQuerySchema.safeParse({ cursor }).success).toBe(
      false,
    );
  }
  expect(
    RootPendingBlobDeletionsQuerySchema.parse({ organizationId })
      .organizationId,
  ).toBe(organizationId);
  expect(
    RootPendingBlobDeletionsQuerySchema.safeParse({ organizationId: "invalid" })
      .success,
  ).toBe(false);
});

test("lifecycle metadata rejects unknown states, invalid dates and invalid byte lengths", () => {
  const blob = {
    blobId: "93e3ddfd-ab67-41a9-8d29-54926525fb50",
    organizationId,
    byteLength: 0,
    status: "deletion-pending",
    dereferencedAt: null,
    eligibleAfter: null,
    reclaimAttemptedAt: null,
    prunedAt: "2026-11-14T00:00:00.000Z",
    objectDeleteAttemptedAt: null,
  };
  expect(
    PendingBlobDeletionsResponseSchema.safeParse({
      blobs: [blob],
      nextAfterId: null,
    }).success,
  ).toBe(true);
  for (const invalid of [
    { status: "deleted" },
    { byteLength: -1 },
    { byteLength: 0.5 },
    { organizationId: "not-an-organization" },
    { dereferencedAt: "yesterday" },
    { objectDeleteAttemptedAt: "2026-11-14" },
  ]) {
    expect(
      PendingBlobDeletionsResponseSchema.safeParse({
        blobs: [{ ...blob, ...invalid }],
        nextAfterId: null,
      }).success,
    ).toBe(false);
  }
});

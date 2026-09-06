import { expect, test } from "bun:test";
import { compareIsoTimestamps } from "@tearleads/validators/util";
import { normalizeSyncWatermark } from "./syncPaging";
import { normalizeSyncTimestamp, readSyncTimestamp } from "./syncTimestamp";

test("discovery cursors retain microseconds through UTC normalization", () => {
  expect(
    normalizeSyncWatermark(
      { id: "row", updatedAt: "2026-08-31T14:00:00.123456+02:00" },
      () => new Error("invalid"),
    ),
  ).toEqual({ id: "row", updatedAt: "2026-08-31T12:00:00.123456Z" });
  expect(normalizeSyncTimestamp("2026-08-31T12:00:00.123000Z")).toBe(
    "2026-08-31T12:00:00.123Z",
  );
  expect(normalizeSyncTimestamp("2026-08-31T12:00:00.000001Z")).toBe(
    "2026-08-31T12:00:00.000001Z",
  );
  expect(normalizeSyncTimestamp("2026-08-31T12:00:00.1234567Z")).toBeNull();
  expect(normalizeSyncTimestamp("invalid")).toBeNull();
});

test("mixed millisecond and microsecond changes sort by time before id", () => {
  expect(
    compareIsoTimestamps(
      "2026-08-31T12:00:00.123Z",
      "2026-08-31T12:00:00.123001Z",
    ),
  ).toBeLessThan(0);
  expect(
    compareIsoTimestamps(
      "2026-08-31T12:00:00.123999Z",
      "2026-08-31T12:00:00.124Z",
    ),
  ).toBeLessThan(0);
  expect(
    compareIsoTimestamps(
      "2026-08-31T12:00:00.123Z",
      "2026-08-31T12:00:00.123000Z",
    ),
  ).toBe(0);
});

test("Date driver values retain milliseconds", () => {
  expect(readSyncTimestamp(new Date("2026-01-01T00:00:00.123Z"))).toBe(
    "2026-01-01T00:00:00.123Z",
  );
});

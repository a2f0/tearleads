import { expect, test } from "bun:test";
import { normalizeSyncWatermark } from "./syncPaging";
import {
  compareSyncTimestamps,
  normalizeSyncTimestamp,
  readSyncTimestamp,
  syncItemTimestamp,
} from "./syncTimestamp";

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
    compareSyncTimestamps(
      "2026-08-31T12:00:00.123Z",
      "2026-08-31T12:00:00.123001Z",
    ),
  ).toBeLessThan(0);
  expect(
    compareSyncTimestamps(
      "2026-08-31T12:00:00.123999Z",
      "2026-08-31T12:00:00.124Z",
    ),
  ).toBeLessThan(0);
  expect(
    compareSyncTimestamps(
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

test("entity timestamps match millisecond mutation responses while cursors retain precision", () => {
  const timestamp = readSyncTimestamp("2026-01-01T00:00:00.123456Z");
  expect(timestamp).toBe("2026-01-01T00:00:00.123456Z");
  expect(syncItemTimestamp(timestamp)).toBe("2026-01-01T00:00:00.123Z");
  for (const value of [
    "2026-01-01T00:00:00.123456",
    "2026-01-01T00:00:00.123456z",
  ]) {
    expect(normalizeSyncTimestamp(value)).toBeNull();
  }
});

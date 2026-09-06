import { expect, test } from "bun:test";
import { compareIsoTimestamps, normalizeIsoTimestamp } from "./isoTimestamp";

test("mixed timestamp precision orders instants and equivalent offsets equally", () => {
  const values = [
    "2026-01-01T00:00:00.123001Z",
    "2026-01-01T00:00:00.123Z",
    "2026-01-01T00:00:00.124Z",
  ] as const;
  expect(values.toSorted(compareIsoTimestamps)).toEqual([
    values[1],
    values[0],
    values[2],
  ]);
  expect(
    compareIsoTimestamps(
      "2026-01-01T00:00:00.123Z",
      "2026-01-01T02:00:00.123000+02:00",
    ),
  ).toBe(0);
  expect(normalizeIsoTimestamp("2026-01-01T00:00:00.1Z")).toBe(
    "2026-01-01T00:00:00.100000Z",
  );
});

test("unsupported timestamp precision and implicit zones fail instead of truncating", () => {
  for (const value of [
    "2026-01-01T00:00:00.1234567Z",
    "2026-01-01T00:00:00.123456",
    "2026-01-01T00:00:00.123456z",
    "invalid",
  ]) {
    expect(normalizeIsoTimestamp(value)).toBeNull();
    expect(() =>
      compareIsoTimestamps(value, "2026-01-01T00:00:00.000Z"),
    ).toThrow("Invalid ISO timestamp");
  }
});

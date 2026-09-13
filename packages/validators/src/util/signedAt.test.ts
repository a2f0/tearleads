import { expect, test } from "bun:test";
import { isCanonicalSignedAt } from "./signedAt";

test.each([
  "1970-01-01T00:00:00.000Z",
  "2026-09-12T00:00:00.123Z",
  "9999-12-31T23:59:59.999Z",
])("accepts canonical in-range timestamp %s", (value) => {
  expect(isCanonicalSignedAt(value)).toBe(true);
  expect(new Date(value).toISOString()).toBe(value);
});

test.each([
  ["0001-01-01T00:00:00.000Z", "year 0001 is re-read through the pivot"],
  ["0099-12-31T23:59:59.999Z", "year 0099 is re-read through the pivot"],
  ["0100-01-01T00:00:00.000Z", "years before 1970 are never honest data"],
  ["1969-12-31T23:59:59.999Z", "the last millisecond before the epoch"],
  ["+010000-01-01T00:00:00.000Z", "expanded positive year"],
  ["-000001-01-01T00:00:00.000Z", "expanded negative year"],
  ["10000-01-01T00:00:00.000Z", "five-digit year"],
  ["2026-09-12T00:00:00Z", "missing milliseconds"],
  ["2026-09-12T00:00:00.0000Z", "extra fractional digit"],
  ["2026-09-12T01:00:00.000+01:00", "offset instead of Z"],
  ["2026-09-12", "date only"],
  ["2026-02-30T00:00:00.000Z", "impossible calendar date"],
  ["invalid", "not a timestamp"],
  ["", "empty"],
])("rejects %s (%s)", (value) => {
  expect(isCanonicalSignedAt(value)).toBe(false);
});

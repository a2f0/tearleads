import { expect, test } from "bun:test";
import { assertStoredSignedAtVerbatim } from "./storedSignedAt";

function reject(message: string): never {
  throw new Error(`rejected: ${message}`);
}

test("a row that prints the submitted signedAt passes", () => {
  const submitted = "2026-09-12T00:00:00.123Z";
  expect(() =>
    assertStoredSignedAtVerbatim(
      new Date(submitted).toISOString(),
      submitted,
      reject,
    ),
  ).not.toThrow();
});

test("a row re-read through the two-digit-year pivot fails the transaction", () => {
  // drizzle-pg parses stored `timestamp` text with `new Date(value + "+0000")`,
  // which maps 0050 to 1950; this is what the Postgres round trip serves.
  expect(() =>
    assertStoredSignedAtVerbatim(
      new Date("1950-01-01T00:00:00.000Z").toISOString(),
      "0050-01-01T00:00:00.000Z",
      reject,
    ),
  ).toThrow(
    "rejected: signedAt 0050-01-01T00:00:00.000Z would be served back as 1950-01-01T00:00:00.000Z",
  );
});

test("sub-millisecond or offset drift is also refused", () => {
  for (const [served, submitted] of [
    ["2026-09-12T00:00:00.000Z", "2026-09-12T00:00:00.001Z"],
    ["2026-09-12T01:00:00.000Z", "2026-09-12T00:00:00.000Z"],
  ] as const) {
    expect(() =>
      assertStoredSignedAtVerbatim(served, submitted, reject),
    ).toThrow("rejected:");
  }
});

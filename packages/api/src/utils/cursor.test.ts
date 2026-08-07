import { expect, test } from "bun:test";
import { decodeCursor, encodeCursor } from "./cursor";

class TestCursorError extends Error {}

interface TestCursor {
  readonly offset: number;
  readonly version: 1;
}

function invalidCursor(): TestCursorError {
  return new TestCursorError("Invalid test cursor");
}

function parseTestCursor(payload: unknown): TestCursor | undefined {
  if (
    typeof payload !== "object" ||
    payload === null ||
    Reflect.get(payload, "version") !== 1 ||
    typeof Reflect.get(payload, "offset") !== "number"
  ) {
    return undefined;
  }
  return {
    offset: Reflect.get(payload, "offset"),
    version: 1,
  };
}

test("cursor payloads round-trip through canonical base64url JSON", () => {
  const encoded = encodeCursor({ extra: true, offset: 7, version: 1 });

  expect(decodeCursor(encoded, parseTestCursor, invalidCursor)).toEqual({
    offset: 7,
    version: 1,
  });
});

test("cursor decoding rejects malformed, non-canonical, and oversized input", () => {
  for (const invalid of [
    "",
    "not+base64url",
    "e31",
    "A".repeat(513),
    encodeCursor({ offset: "7", version: 1 }),
  ]) {
    expect(() => decodeCursor(invalid, parseTestCursor, invalidCursor)).toThrow(
      TestCursorError,
    );
  }
});

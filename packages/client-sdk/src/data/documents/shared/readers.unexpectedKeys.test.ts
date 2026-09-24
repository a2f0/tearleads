import { expect, test } from "bun:test";
import { assertOnlyRecordKeys } from "./readers";

test("unexpected envelope keys produce a bounded escaped diagnostic", () => {
  const record = Object.fromEntries(
    Array.from({ length: 1000 }, (_, index) => [
      `${index}\n${"untrusted".repeat(100)}`,
      true,
    ]),
  );
  let failure: unknown;
  try {
    assertOnlyRecordKeys(record, new Set(), "Envelope");
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(Error);
  if (!(failure instanceof Error)) throw new Error("Expected refusal");
  expect(failure.message.length).toBeLessThan(200);
  expect(failure.message).not.toContain("\n");
  expect(failure.message).toContain("997 more");
});

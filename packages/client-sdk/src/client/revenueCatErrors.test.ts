import { expect, test } from "bun:test";
import {
  copyRevenueCatError,
  RevenueCatOperationTimeoutError,
} from "./revenueCatErrors";

class PrivateSlotError extends Error {
  readonly #code = "private";

  code(): string {
    return this.#code;
  }
}

test("timeout copies preserve restart guidance in a valid instance", () => {
  const source = new RevenueCatOperationTimeoutError("restore", 30);
  source.markRestartRequired();

  const copy = copyRevenueCatError(source);

  expect(copy).not.toBe(source);
  expect(copy).toBeInstanceOf(RevenueCatOperationTimeoutError);
  expect(copy.restartRequired).toBe(true);
});

test("unknown subclasses are wrapped without fabricating private slots", () => {
  const source = new PrivateSlotError("provider failed");

  const copy = copyRevenueCatError(source);

  expect(copy).not.toBeInstanceOf(PrivateSlotError);
  expect(copy).toMatchObject({
    cause: source,
    message: "provider failed",
    name: "Error",
  });
});

import { expect, test } from "bun:test";
import {
  copyRevenueCatError,
  normalizeRevenueCatError,
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

test("provider error copies preserve native diagnostics", () => {
  const source = normalizeRevenueCatError({
    code: "13",
    message: "Receipt belongs to another buyer",
    storeError: { code: 7, domain: "SKErrorDomain" },
    userCancelled: false,
  });

  const copy = copyRevenueCatError(source);

  expect(copy).not.toBe(source);
  expect(copy).toMatchObject({
    code: "13",
    message: "Receipt belongs to another buyer",
    storeError: { code: 7, domain: "SKErrorDomain" },
    userCancelled: false,
  });
});

test("provider error copies preserve nested Capacitor diagnostics", () => {
  const data = {
    storeError: { code: 509, domain: "ASDErrorDomain" },
    underlyingErrorMessage: "ASDErrorDomain Code=509",
    userCancelled: false,
  };
  const source = normalizeRevenueCatError({
    code: "2",
    data,
    message: "Store problem",
  });

  const copy = copyRevenueCatError(source);

  expect(copy).not.toBe(source);
  expect(copy).toMatchObject({
    code: "2",
    data,
    storeError: data.storeError,
    underlyingErrorMessage: data.underlyingErrorMessage,
    userCancelled: false,
  });
});

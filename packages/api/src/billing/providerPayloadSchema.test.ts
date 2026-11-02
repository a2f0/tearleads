import { describe, expect, test } from "bun:test";
import {
  nonnegativeIntegerSchema,
  positiveIntegerSchema,
  providerResponseSchema,
  readProviderField,
  readProviderObject,
  readProviderString,
  readStripeReferenceId,
  readUnixTimestamp,
} from "./providerPayloadSchema";
import { stripeObjectIdSchema } from "./stripeApiSchema";

describe("billing provider leaf schemas", () => {
  test("strings must be non-empty", () => {
    expect(readProviderString("value")).toBe("value");
    expect(readProviderString("")).toBeNull();
    expect(readProviderString(1)).toBeNull();
    expect(readProviderString(undefined)).toBeNull();
  });

  test.each([
    [0, 0, null],
    [1, 1, 1],
    [-0, -0, null],
    [-1, null, null],
    [1.5, null, null],
    ["1", null, null],
    [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
    [Number.MAX_SAFE_INTEGER + 1, null, null],
    [Number.POSITIVE_INFINITY, null, null],
    [Number.NaN, null, null],
  ])(
    "integer %p reads as non-negative %p and positive %p",
    (value, nonnegative, positive) => {
      expect(readProviderField(nonnegativeIntegerSchema, value)).toBe(
        nonnegative,
      );
      expect(readProviderField(positiveIntegerSchema, value)).toBe(positive);
    },
  );

  test("unix timestamps accept finite numeric seconds", () => {
    expect(readUnixTimestamp(1)?.toISOString()).toBe(
      "1970-01-01T00:00:01.000Z",
    );
    expect(readUnixTimestamp(-1)?.toISOString()).toBe(
      "1969-12-31T23:59:59.000Z",
    );
    expect(readUnixTimestamp(Number.POSITIVE_INFINITY)).toBeNull();
    expect(readUnixTimestamp(Number.NaN)).toBeNull();
    expect(readUnixTimestamp(1e300)).toBeNull();
    expect(readUnixTimestamp("1")).toBeNull();
  });

  test("Stripe references are an id string or an object carrying one", () => {
    expect(readStripeReferenceId("cus_1")).toBe("cus_1");
    expect(readStripeReferenceId({ id: "cus_1", email: null })).toBe("cus_1");
    expect(readStripeReferenceId({ id: "" })).toBeNull();
    expect(readStripeReferenceId("")).toBeNull();
    expect(readStripeReferenceId(["cus_1"])).toBeNull();
    expect(readStripeReferenceId(null)).toBeNull();
  });

  test("provider objects keep unknown keys and reject arrays", () => {
    expect(
      readProviderField(stripeObjectIdSchema, { id: "x", extra: [1] }),
    ).toEqual({ id: "x", extra: [1] });
    expect(
      readProviderField(stripeObjectIdSchema, Object.assign([], { id: "x" })),
    ).toBeNull();
    expect(readProviderObject(stripeObjectIdSchema, null)).toEqual({});
  });

  test.each([
    [{}, true],
    [[], true],
    [null, false],
    ["{}", false],
    [0, false],
  ])("response %j is an object or array: %p", (value, accepted) => {
    expect(providerResponseSchema.safeParse(value).success).toBe(accepted);
  });
});

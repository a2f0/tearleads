import { describe, expect, test } from "bun:test";
import {
  readNonnegativeInteger,
  readPositiveInteger,
  readString,
  readUnixTimestamp,
} from "./stripeHttp";

describe("billing scalar readers", () => {
  test("readString accepts only non-empty strings", () => {
    expect(readString("value")).toBe("value");
    expect(readString("")).toBeNull();
    expect(readString(1)).toBeNull();
  });

  test("integer readers preserve their sign boundaries", () => {
    expect(readNonnegativeInteger(0)).toBe(0);
    expect(readNonnegativeInteger(-1)).toBeNull();
    expect(readPositiveInteger(1)).toBe(1);
    expect(readPositiveInteger(0)).toBeNull();
    expect(readPositiveInteger("1")).toBeNull();
    expect(readPositiveInteger(Number.MAX_SAFE_INTEGER + 1)).toBeNull();
  });

  test("readUnixTimestamp accepts finite numeric seconds", () => {
    expect(readUnixTimestamp(1)?.toISOString()).toBe(
      "1970-01-01T00:00:01.000Z",
    );
    expect(readUnixTimestamp(Number.POSITIVE_INFINITY)).toBeNull();
    expect(readUnixTimestamp("1")).toBeNull();
  });
});

import { expect, test } from "bun:test";
import { parseOptionalInteger } from "./queryParams";

test("parseOptionalInteger accepts absent and canonical safe decimal integers", () => {
  expect(parseOptionalInteger(undefined)).toBeUndefined();
  expect(parseOptionalInteger("1")).toBe(1);
  expect(parseOptionalInteger("500")).toBe(500);
});

test("parseOptionalInteger rejects non-decimal and unsafe integer encodings", () => {
  expect(Number.isNaN(parseOptionalInteger("1e2"))).toBe(true);
  expect(Number.isNaN(parseOptionalInteger("-1"))).toBe(true);
  expect(Number.isNaN(parseOptionalInteger("9007199254740993"))).toBe(true);
});

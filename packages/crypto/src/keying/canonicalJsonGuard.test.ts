import { describe, expect, test } from "bun:test";
import {
  isKeyingCanonicalJson,
  readKeyingCanonicalJson,
} from "./canonicalJsonGuard";

const cyclicObject: { name: string; self?: unknown } = { name: "cycle" };
cyclicObject.self = cyclicObject;
const cyclicArray: unknown[] = [];
cyclicArray.push(cyclicArray);
const shared = { value: 1 };
const sparseArray: unknown[] = [1];
sparseArray[2] = 3;

describe("isKeyingCanonicalJson", () => {
  test.each([
    ["null", null],
    ["string", "text"],
    ["boolean", false],
    ["finite number", 1.5],
    ["nested plain values", { list: [1, "two", { three: null }] }],
    ["a repeated, non-cyclic reference", { left: shared, right: [shared] }],
  ])("accepts %s", (_label, value) => {
    expect(isKeyingCanonicalJson(value)).toBe(true);
  });

  test.each([
    ["undefined", undefined],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["a bigint", 1n],
    ["a function", () => null],
    ["a sparse array", sparseArray],
    ["a class instance", new Date(0)],
    ["a nested non-finite number", { values: [Number.NaN] }],
    ["a cyclic object", cyclicObject],
    ["a cyclic array", cyclicArray],
  ])("rejects %s", (_label, value) => {
    expect(isKeyingCanonicalJson(value)).toBe(false);
  });
});

describe("readKeyingCanonicalJson", () => {
  test("returns the value it accepts", () => {
    const value = { list: [1, 2] };
    expect(readKeyingCanonicalJson(value, "body")).toBe(value);
  });

  test("names the label when it rejects a value", () => {
    expect(() => readKeyingCanonicalJson(cyclicObject, "Event body")).toThrow(
      "Event body must be canonical JSON",
    );
  });
});

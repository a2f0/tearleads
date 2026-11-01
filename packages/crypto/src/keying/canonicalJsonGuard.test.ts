import { describe, expect, test } from "bun:test";
import { toFingerprint } from "../fingerprint";
import { serializeKeyingCanonicalJson } from "./canonical";
import {
  computeContainerKekLevelDigest,
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

describe("computeContainerKekLevelDigest", () => {
  const level = { containerId: "container-1", containerKeyEpoch: 2, keks: [] };

  test("is domain-separated from the plain hash of the level's bytes", async () => {
    const digest = await computeContainerKekLevelDigest(level);
    const encoder = new TextEncoder();
    expect(digest).toBe(
      await toFingerprint(
        encoder.encode(
          serializeKeyingCanonicalJson({
            domain: "tearleads.keying.container-kek-level-citation",
            payload: level,
          }),
        ),
      ),
    );
    expect(digest).not.toBe(
      await toFingerprint(encoder.encode(serializeKeyingCanonicalJson(level))),
    );
    // Key order does not change the canonical level, so neither its digest.
    expect(
      await computeContainerKekLevelDigest({
        keks: [],
        containerKeyEpoch: 2,
        containerId: "container-1",
      }),
    ).toBe(digest);
  });

  test.each([
    ["negative zero", { epoch: -0 }],
    ["undefined property", { value: undefined }],
    ["cycle", cyclicObject],
  ])("is null for a level with no canonical form (%s)", async (_, value) => {
    expect(await computeContainerKekLevelDigest(value)).toBeNull();
  });
});

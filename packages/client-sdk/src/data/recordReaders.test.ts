import { expect, test } from "bun:test";
import {
  readRecordInteger,
  readRecordNullableString,
  readRecordPositiveInteger,
  readRecordString,
  readRecordValue,
  readRequiredRecordValue,
  readStringArray,
} from "./recordReaders";

test("plain and required value lookups differ exactly on missing keys", () => {
  const record: Record<string, unknown> = { present: "value", explicit: null };

  expect(readRecordValue(record, "present")).toBe("value");
  expect(readRecordValue(record, "missing")).toBeUndefined();

  expect(readRequiredRecordValue(record, "present", "Payload")).toBe("value");
  // An explicitly present null/undefined is not "missing".
  expect(readRequiredRecordValue(record, "explicit", "Payload")).toBeNull();
  expect(() => readRequiredRecordValue(record, "missing", "Payload")).toThrow(
    "Payload.missing is missing",
  );

  // Own-key semantics: an inherited property does not satisfy the required
  // lookup, so a forged prototype cannot smuggle a value past it.
  const inherited = Object.create({ proto: "smuggled" }) as Record<
    string,
    unknown
  >;
  expect(() => readRequiredRecordValue(inherited, "proto", "Payload")).toThrow(
    "Payload.proto is missing",
  );
});

test("string readers reject empty and non-string values", () => {
  expect(readRecordString({ key: "ok" }, "key", "Payload")).toBe("ok");
  for (const bad of ["", 7, null, undefined, ["x"]]) {
    expect(() => readRecordString({ key: bad }, "key", "Payload")).toThrow(
      "Payload.key must be a non-empty string",
    );
  }

  expect(readRecordNullableString({ key: null }, "key", "Payload")).toBeNull();
  expect(readRecordNullableString({ key: "ok" }, "key", "Payload")).toBe("ok");
  for (const bad of ["", 7, undefined]) {
    expect(() =>
      readRecordNullableString({ key: bad }, "key", "Payload"),
    ).toThrow("Payload.key must be a non-empty string or null");
  }
});

test("integer readers accept exactly the integers their names claim", () => {
  expect(readRecordInteger({ key: 0 }, "key", "Payload")).toBe(0);
  expect(readRecordInteger({ key: -3 }, "key", "Payload")).toBe(-3);
  for (const bad of [1.5, Number.NaN, "7", null, undefined]) {
    expect(() => readRecordInteger({ key: bad }, "key", "Payload")).toThrow(
      "Payload.key must be an integer",
    );
  }

  expect(readRecordPositiveInteger({ key: 1 }, "key", "Payload")).toBe(1);
  for (const bad of [0, -1, 1.5, Number.NaN, "7", null, undefined]) {
    expect(() =>
      readRecordPositiveInteger({ key: bad }, "key", "Payload"),
    ).toThrow("Payload.key must be a positive integer");
  }
});

test("readStringArray validates entries and returns an independent copy", () => {
  const source = ["a", "b"];
  const copy = readStringArray(source, "Payload");
  expect(copy).toEqual(["a", "b"]);
  copy.push("c");
  expect(source).toEqual(["a", "b"]);

  for (const bad of ["a", [""], ["a", 7], [null], undefined]) {
    expect(() => readStringArray(bad, "Payload")).toThrow(
      "Payload must be a string array",
    );
  }

  // A sparse array's holes are skipped by a bare `some`; they must reject.
  const sparse = new Array<string>(3);
  sparse[0] = "a";
  sparse[2] = "b";
  expect(() => readStringArray(sparse, "Payload")).toThrow(
    "Payload must be a string array",
  );

  // The validated copy is the returned copy: a stateful iterator that yields
  // clean strings once and garbage afterwards cannot poison the result.
  let pass = 0;
  class ShiftyArray extends Array<string> {
    override [Symbol.iterator]() {
      pass += 1;
      return (pass === 1 ? ["clean"] : [42 as unknown as string])[
        Symbol.iterator
      ]();
    }
  }
  const shifty = new ShiftyArray();
  shifty.push("clean");
  expect(readStringArray(shifty, "Payload")).toEqual(["clean"]);
});

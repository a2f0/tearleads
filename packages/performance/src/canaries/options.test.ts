import { expect, test } from "bun:test";
import { parseCanaryOptions } from "./options";

test("runs every canary once by default", () => {
  expect(parseCanaryOptions([])).toEqual({
    mode: "run",
    canaries: [],
    samples: 1,
    baseline: null,
    statements: false,
    paramHash: false,
  });
  expect(parseCanaryOptions(["--help"])).toBeNull();
  expect(
    parseCanaryOptions([
      "--canary",
      "Group",
      "--canary",
      "Upload",
      "--samples",
      "3",
      "--baseline",
      "before.json",
    ]),
  ).toEqual({
    mode: "run",
    canaries: ["Group", "Upload"],
    samples: 3,
    baseline: "before.json",
    statements: false,
    paramHash: false,
  });
  expect(parseCanaryOptions(["--statements", "--param-hash"])).toMatchObject({
    statements: true,
    paramHash: true,
  });
  expect(() => parseCanaryOptions(["--param-hash"])).toThrow(/--statements/);
});

test("compares exactly two reports and runs nothing", () => {
  expect(parseCanaryOptions(["--compare", "a.json", "b.json"])).toEqual({
    mode: "compare",
    before: "a.json",
    after: "b.json",
  });
  expect(() => parseCanaryOptions(["--compare", "a.json"])).toThrow(/two/);
  expect(() =>
    parseCanaryOptions(["--compare", "a.json", "b.json", "c.json"]),
  ).toThrow(/two/);
  expect(() =>
    parseCanaryOptions(["--compare", "--canary", "x", "a.json", "b.json"]),
  ).toThrow(/runs no canaries/);
});

test("rejects stray arguments and out-of-range samples", () => {
  expect(() => parseCanaryOptions(["a.json"])).toThrow(/Unexpected/);
  expect(() => parseCanaryOptions(["--samples", "6"])).toThrow(/--samples/);
  expect(() => parseCanaryOptions(["--samples", "0"])).toThrow(/--samples/);
  expect(() => parseCanaryOptions(["--bogus"])).toThrow();
});

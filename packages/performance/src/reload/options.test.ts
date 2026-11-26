import { expect, test } from "bun:test";
import { parseReloadOptions } from "./options";

test("defaults cover three account sizes", () => {
  expect(parseReloadOptions([])).toEqual({
    documents: [10, 100, 1000],
    perFolder: 10,
    samples: 3,
    quietMs: 1000,
  });
  expect(parseReloadOptions(["--help"])).toBeNull();
});

test("flags set each option", () => {
  expect(
    parseReloadOptions([
      "--documents",
      "5,50",
      "--per-folder",
      "1000",
      "--samples",
      "1",
      "--quiet-ms",
      "250",
    ]),
  ).toEqual({ documents: [5, 50], perFolder: 1000, samples: 1, quietMs: 250 });
});

test("invalid flags are refused", () => {
  expect(() => parseReloadOptions(["--documents", "50,5"])).toThrow(
    "strictly ascending",
  );
  expect(() => parseReloadOptions(["--documents", "5001"])).toThrow(
    "from 1 to 5000",
  );
  expect(() => parseReloadOptions(["--quiet-ms", "50"])).toThrow(
    "from 100 to 10000",
  );
  expect(() => parseReloadOptions(["--samples"])).toThrow("needs a value");
  expect(() => parseReloadOptions(["--sizes", "5"])).toThrow(
    "Unknown option --sizes",
  );
});

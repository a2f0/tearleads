import { expect, test } from "bun:test";
import { parentPosition } from "./folderTree";
import { parseRealtimeOptions } from "./options";

test("defaults to the issue's three sizes, one sample, and a fresh seed", () => {
  expect(parseRealtimeOptions([])).toEqual({
    sizes: [100, 1_000, 10_000],
    fanout: 10,
    samples: 1,
    reuse: false,
  });
  expect(parseRealtimeOptions(["--help"])).toBeNull();
  expect(
    parseRealtimeOptions([
      "--sizes",
      "5, 50",
      "--fanout",
      "3",
      "--samples",
      "10",
      "--reuse",
    ]),
  ).toEqual({ sizes: [5, 50], fanout: 3, samples: 10, reuse: true });
});

test("rejects sizes the hub would refuse and unordered or bad counts", () => {
  expect(() => parseRealtimeOptions(["--sizes", "10001"])).toThrow(/--sizes/);
  expect(() => parseRealtimeOptions(["--sizes", "0"])).toThrow(/--sizes/);
  expect(() => parseRealtimeOptions(["--sizes", "100,100"])).toThrow(
    /ascending/,
  );
  expect(() => parseRealtimeOptions(["--sizes", "1e3"])).toThrow(/--sizes/);
  expect(() => parseRealtimeOptions(["--samples", "11"])).toThrow(/--samples/);
  expect(() => parseRealtimeOptions(["--fanout", "0"])).toThrow(/--fanout/);
  expect(() => parseRealtimeOptions(["--env", "production"])).toThrow();
});

test("created folders fill the tree breadth first", () => {
  // Position 0 is the root; created folder i sits at position i + 1.
  const parents = Array.from({ length: 12 }, (_, index) =>
    parentPosition(index, 3),
  );
  expect(parents).toEqual([0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3]);
});

import { expect, test } from "bun:test";
import { parseRotationOptions } from "./options";

test("parses defaults and overrides for perf:rotations", () => {
  expect(parseRotationOptions([])).toEqual({
    rotations: [1, 4, 8],
    depth: 3,
    samples: 1,
  });
  expect(
    parseRotationOptions([
      "--rotations",
      "2,6,12",
      "--depth",
      "4",
      "--samples",
      "2",
    ]),
  ).toEqual({
    rotations: [2, 6, 12],
    depth: 4,
    samples: 2,
  });
  expect(parseRotationOptions(["--help"])).toBeNull();
});

test("rejects invalid values and unknown options", () => {
  expect(() => parseRotationOptions(["--rotations", "4,2"])).toThrow(
    /strictly ascending/u,
  );
  expect(() => parseRotationOptions(["--depth", "9"])).toThrow(
    /integer from 1 to 8/u,
  );
  expect(() => parseRotationOptions(["--samples", "0"])).toThrow(
    /integer from 1 to 5/u,
  );
  expect(() => parseRotationOptions(["--unknown", "1"])).toThrow(
    /Unknown option/u,
  );
});

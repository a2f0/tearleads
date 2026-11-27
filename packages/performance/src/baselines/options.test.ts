import { expect, test } from "bun:test";
import { parseBaselineOptions } from "./options";

test("uses defaults and parses valid baseline flags", () => {
  expect(parseBaselineOptions([])).toEqual({
    sizesMb: [1, 5, 13],
    chunkMb: 6,
    samples: 1,
    race: false,
  });
  expect(
    parseBaselineOptions([
      "--sizes-mb",
      "1,6,14",
      "--chunk-mb",
      "7",
      "--samples",
      "2",
      "--race",
    ]),
  ).toEqual({
    sizesMb: [1, 6, 14],
    chunkMb: 7,
    samples: 2,
    race: true,
  });
  expect(parseBaselineOptions(["--help"])).toBeNull();
});

test("rejects invalid baseline option values", () => {
  expect(() => parseBaselineOptions(["--sizes-mb", "5,5"])).toThrow(
    /strictly ascending/u,
  );
  expect(() => parseBaselineOptions(["--sizes-mb", "40"])).toThrow(
    /integer from 1 to 32/u,
  );
  expect(() => parseBaselineOptions(["--chunk-mb", "11"])).toThrow(
    /integer from 1 to 10/u,
  );
  expect(() => parseBaselineOptions(["--samples", "0"])).toThrow(
    /integer from 1 to 5/u,
  );
  expect(() => parseBaselineOptions(["--sizes-mb"])).toThrow(/needs a value/u);
  expect(() => parseBaselineOptions(["--bogus", "1"])).toThrow(
    /Unknown option/u,
  );
});

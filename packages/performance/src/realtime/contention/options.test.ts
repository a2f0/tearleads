import { expect, test } from "bun:test";
import { parseContentionOptions } from "./options";

test("defaults compare one, two and four sockets at 1,000 and 10,000", () => {
  expect(parseContentionOptions([])).toEqual({
    sizes: [1_000, 10_000],
    sockets: [1, 2, 4],
    fanout: 10,
    samples: 1,
    hintIntervalMs: 10,
    reuse: false,
  });
  expect(parseContentionOptions(["--help"])).toBeNull();
});

test("flags override each default", () => {
  expect(
    parseContentionOptions([
      "--sizes",
      "4, 100",
      "--sockets",
      "2,8",
      "--samples",
      "3",
      "--hint-interval-ms",
      "5",
      "--reuse",
    ]),
  ).toMatchObject({
    sizes: [4, 100],
    sockets: [2, 8],
    samples: 3,
    hintIntervalMs: 5,
    reuse: true,
  });
});

test("sizes, sockets and the interval are bounded", () => {
  const rejects = (args: string[], message: RegExp) =>
    expect(() => parseContentionOptions(args)).toThrow(message);
  // Fewer than the root and three system containers.
  rejects(["--sizes", "3"], /--sizes must be an integer from 4 to 10000/);
  rejects(["--sizes", "10001"], /--sizes/);
  rejects(["--sizes", "100,100"], /--sizes must be strictly ascending/);
  rejects(["--sockets", "9"], /--sockets must be an integer from 1 to 8/);
  rejects(["--sockets", "4,2"], /--sockets must be strictly ascending/);
  rejects(["--hint-interval-ms", "0"], /--hint-interval-ms/);
  rejects(["--samples", "11"], /--samples/);
  rejects(["--unknown"], /unknown/i);
});

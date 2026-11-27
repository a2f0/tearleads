import { expect, test } from "bun:test";
import { generateIncompressibleChunks, incompressibleText } from "./largeText";

test("generates 64-byte random hex lines of exact size", () => {
  const sample = incompressibleText(64 * 10);
  const lines = sample.trimEnd().split("\n");
  expect(lines).toHaveLength(10);
  expect(Buffer.byteLength(sample)).toBe(640);
  for (const line of lines) {
    expect(line).toMatch(/^[0-9a-f]{63}$/u);
  }
  expect(new Set(lines).size).toBe(10);
});

test("splits total MiB into bounded chunks", () => {
  const chunks = generateIncompressibleChunks(13, 6);
  expect(chunks.map((c) => Buffer.byteLength(c))).toEqual([
    6 * 1024 * 1024,
    6 * 1024 * 1024,
    1 * 1024 * 1024,
  ]);
  expect(() => generateIncompressibleChunks(0, 6)).toThrow(/must be positive/u);
});

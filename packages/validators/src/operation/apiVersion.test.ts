import { expect, test } from "bun:test";
import { parseApiVersion } from "./apiVersion";

test("parses a positive decimal API version", () => {
  expect(parseApiVersion("1")).toBe(1);
  expect(parseApiVersion("2461")).toBe(2461);
});

test("rejects absent, malformed, and unsafe API versions", () => {
  for (const value of [
    null,
    "",
    "0",
    "007",
    "-1",
    "1.5",
    " 12",
    "12 ",
    "1e3",
    "abc",
    "9007199254740992",
  ]) {
    expect(parseApiVersion(value)).toBeNull();
  }
});

import { expect, test } from "bun:test";
import { uniqueSortedStrings } from "./array";

test("uniqueSortedStrings deduplicates and orders canonical API identifiers", () => {
  expect(
    uniqueSortedStrings([
      "symcrypt.container-kek.v1.sha256:ff",
      "00000000-0000-4000-8000-000000000002",
      "symcrypt.container-kek.v1.sha256:00",
      "00000000-0000-4000-8000-000000000001",
      "symcrypt.container-kek.v1.sha256:ff",
    ]),
  ).toEqual([
    "00000000-0000-4000-8000-000000000001",
    "00000000-0000-4000-8000-000000000002",
    "symcrypt.container-kek.v1.sha256:00",
    "symcrypt.container-kek.v1.sha256:ff",
  ]);
});

test("uniqueSortedStrings uses canonical code-unit ordering", () => {
  expect(uniqueSortedStrings(new Set(["ä", "z", "a", "A", ":"]))).toEqual([
    ":",
    "A",
    "a",
    "z",
    "ä",
  ]);
});

import { expect, test } from "bun:test";
import { requiredCarriedRekeys } from "./grantedPathCurrency";

const closureIds = ["a", "b", "c", "d"];

test("a closure within the limit is owed in full, named whole", () => {
  // Only `a` is stale right now, but carrying it stales `b`, and so on down:
  // naming less would cost one refusal per level.
  expect(
    requiredCarriedRekeys({
      carriedLimit: 64,
      closureIds,
      strandedIds: new Set(["a"]),
    }),
  ).toEqual(closureIds);
});

test("a fully current closure refuses nothing", () => {
  expect(
    requiredCarriedRekeys({
      carriedLimit: 64,
      closureIds,
      strandedIds: new Set(),
    }),
  ).toBeNull();
});

// A revocation must never be blockable by the size of a tree, so an overflowing
// closure is owed only as its parent-first prefix.

test("past the limit only the parent-first prefix is owed", () => {
  expect(
    requiredCarriedRekeys({
      carriedLimit: 2,
      closureIds,
      strandedIds: new Set(["c", "d"]),
    }),
  ).toBeNull();
  expect(
    requiredCarriedRekeys({
      carriedLimit: 2,
      closureIds,
      strandedIds: new Set(["b", "c", "d"]),
    }),
  ).toEqual(["a", "b"]);
});

// The waiver reads the closure, never how many rekeys rode along, so padding a
// batch with unrelated rekeys cannot buy it.

test("the waiver cannot be bought by carrying more", () => {
  expect(
    requiredCarriedRekeys({
      carriedLimit: 64,
      closureIds,
      strandedIds: new Set(["d"]),
    }),
  ).toEqual(closureIds);
});

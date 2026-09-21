import { expect, test } from "bun:test";
import {
  owedLevelsOnChain,
  requiredCarriedRekeys,
} from "./grantedPathCurrency";

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

const level = (id: string) => ({ id });
// Nearest the grant first: the grant sits under `c`, below `b`, below `a`.
const chain = [level("c"), level("b"), level("a")];

test("a chain owes everything below its topmost rotated container", () => {
  expect(owedLevelsOnChain(chain, new Set(["a"]))).toEqual([
    level("c"),
    level("b"),
  ]);
});

// Rotating `b` and then its parent `a` in one batch leaves `b` pinned to a
// retired epoch, so being rotated excuses nothing.

test("a container rotated below another is still owed", () => {
  expect(owedLevelsOnChain(chain, new Set(["a", "b"]))).toEqual([
    level("c"),
    level("b"),
  ]);
});

test("a grant directly below the rotation, or on another branch, owes nothing", () => {
  expect(owedLevelsOnChain([level("a")], new Set(["a"]))).toEqual([]);
  expect(owedLevelsOnChain(chain, new Set(["elsewhere"]))).toEqual([]);
});

// Nothing caps a tree's depth, and the walk is bounded, so a chain it could not
// follow to the rotation never reaches a rotated id. It must owe nothing rather
// than refuse: a revocation is never blockable by a tree's shape.

test("a chain the bounded walk could not finish is never a refusal", () => {
  const truncated = Array.from({ length: 100 }, (_, index) =>
    level(`deep-${index}`),
  );
  expect(owedLevelsOnChain(truncated, new Set(["root"]))).toEqual([]);
});

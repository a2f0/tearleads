import { expect, test } from "bun:test";
import {
  MAX_INLINE_CONTAINER_REKEYS,
  MAX_ROTATION_CONTAINER_REKEYS,
} from "@tearleads/validators/util";
import {
  owedLevelsOnChain,
  requiredCarriedRekeys,
} from "./grantedPathCurrency";

const closureIds = ["a", "b", "c", "d"];
const levels = (count: number) =>
  Array.from({ length: count }, (_, index) => `level-${index}`);

test("a closure within the limit is owed in full, named whole", () => {
  // Only `a` is stale right now, but carrying it stales `b`, and so on down:
  // naming less would cost one refusal per level.
  expect(
    requiredCarriedRekeys({
      closureIds,
      strandedIds: new Set(["a"]),
    }),
  ).toEqual(closureIds);
});

test("a fully current closure refuses nothing", () => {
  expect(
    requiredCarriedRekeys({
      closureIds,
      strandedIds: new Set(),
    }),
  ).toBeNull();
});

// A revocation must never be blockable by the size of a tree, so an overflowing
// closure is owed only as its parent-first prefix.

test("past the limit only the parent-first prefix is owed", () => {
  const overflowing = levels(MAX_ROTATION_CONTAINER_REKEYS + 2);
  const prefix = overflowing.slice(0, MAX_ROTATION_CONTAINER_REKEYS);
  expect(
    requiredCarriedRekeys({
      closureIds: overflowing,
      strandedIds: new Set(overflowing.slice(MAX_ROTATION_CONTAINER_REKEYS)),
    }),
  ).toBeNull();
  expect(
    requiredCarriedRekeys({
      closureIds: overflowing,
      strandedIds: new Set(
        overflowing.slice(MAX_ROTATION_CONTAINER_REKEYS - 1),
      ),
    }),
  ).toEqual(prefix);
});

// Unkeyed levels wrap nothing to their parent, so they are never stranded, but
// they still count toward the prefix. Inline writes take the shared cap too
// (#2365 finding 30): with sixteen or more unkeyed levels first, a stranded
// level below them is still owed, where the old inline cap would have waived it.
test("an inline write is held to the shared cap past sixteen unkeyed levels", () => {
  const closure = levels(MAX_INLINE_CONTAINER_REKEYS + 4);
  const strandedBelowUnkeyed = closure[MAX_INLINE_CONTAINER_REKEYS];
  if (!strandedBelowUnkeyed) throw new Error("Expected a level below the cap");
  expect(
    requiredCarriedRekeys({
      closureIds: closure,
      strandedIds: new Set([strandedBelowUnkeyed]),
    }),
  ).toEqual(closure);
});

// The waiver reads the closure, never how many rekeys rode along, so padding a
// batch with unrelated rekeys cannot buy it.

test("the waiver cannot be bought by carrying more", () => {
  expect(
    requiredCarriedRekeys({
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

// Create and move cap tree depth. The bounded walk still fails safe for a
// malformed stored tree: a chain that never reaches the rotation owes nothing
// rather than refusing revocation because of the tree's shape.

test("a chain the bounded walk could not finish is never a refusal", () => {
  const truncated = Array.from({ length: 100 }, (_, index) =>
    level(`deep-${index}`),
  );
  expect(owedLevelsOnChain(truncated, new Set(["root"]))).toEqual([]);
});

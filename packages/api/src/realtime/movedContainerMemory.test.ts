import { expect, test } from "bun:test";
import { MAX_CONTAINER_PATH_LENGTH } from "@tearleads/validators/util";
import {
  MOVED_CONTAINER_TTL_MS,
  MovedContainerMemory,
} from "./movedContainerMemory";

test("rewrites moved container and descendant prefixes until TTL expiry", () => {
  const memory = new MovedContainerMemory(MOVED_CONTAINER_TTL_MS);
  memory.remember(
    "folder-a",
    ["root-2", "parent-2"],
    "2026-01-01T00:00:05.000Z",
    1_000,
  );

  expect(
    memory.resolveAncestors("folder-a", ["root-1", "parent-1"], 2_000),
  ).toEqual(["root-2", "parent-2"]);
  expect(
    memory.resolvePath(["root-1", "parent-1", "folder-a", "leaf"], 2_000),
  ).toEqual(["root-2", "parent-2", "folder-a", "leaf"]);
  expect(
    memory.resolvePath(["root-1", "parent-1", "folder-a", "leaf"], 62_000),
  ).toEqual(["root-1", "parent-1", "folder-a", "leaf"]);
});

test("newer ancestor move supersedes an earlier descendant move without reverting", () => {
  const memory = new MovedContainerMemory(60_000);
  // T2: B moves into R2/A.
  memory.remember("b", ["r2", "a"], "2026-01-01T00:00:05.000Z", 1_000);
  // T3 > T2: A moves from R2 to R4.
  memory.remember("a", ["r4"], "2026-01-01T00:00:10.000Z", 1_500);

  // Stale hint from between T2 and T3 must resolve to [r4, a, b, d], not revert to [r2, a, b, d].
  expect(memory.resolvePath(["r2", "a", "b", "d"], 2_000)).toEqual([
    "r4",
    "a",
    "b",
    "d",
  ]);
  // Fresh hint already carrying [r4, a, b, d] stays at [r4, a, b, d].
  expect(memory.resolvePath(["r4", "a", "b", "d"], 2_000)).toEqual([
    "r4",
    "a",
    "b",
    "d",
  ]);
});

test("older ancestor move does not overwrite a newer descendant move prefix", () => {
  const memory = new MovedContainerMemory(60_000);
  // T2: A moved to R2. Later A moved to R4 (delayed), and at T4 > T2 B moved into R4/A.
  memory.remember("a", ["r2"], "2026-01-01T00:00:02.000Z", 1_000);
  memory.remember("b", ["r4", "a"], "2026-01-01T00:00:04.000Z", 1_200);

  expect(memory.resolvePath(["r4", "a", "b", "d"], 2_000)).toEqual([
    "r4",
    "a",
    "b",
    "d",
  ]);
});

test("compares ISO timestamps by parsed epoch across fractional-second precisions", () => {
  const memory = new MovedContainerMemory(60_000);
  memory.remember("folder-a", ["r1"], "2026-01-01T00:00:05Z", 1_000);
  // 05.500Z is newer than 05Z even though '.' < 'Z' lexicographically.
  memory.remember("folder-a", ["r2"], "2026-01-01T00:00:05.500Z", 1_100);
  // Older 04.999Z must not overwrite 05.500Z.
  memory.remember("folder-a", ["r-stale"], "2026-01-01T00:00:04.999Z", 1_200);

  expect(memory.resolveAncestors("folder-a", ["r0"], 2_000)).toEqual(["r2"]);
});

test("fails closed (null) on cyclic remembered moves or path-length overflow", () => {
  const memory = new MovedContainerMemory(60_000);
  memory.remember("a", ["b"], "2026-01-01T00:00:01.000Z", 1_000);
  memory.remember("b", ["a"], "2026-01-01T00:00:02.000Z", 1_100);
  expect(memory.resolvePath(["r0", "a", "leaf"], 2_000)).toBeNull();
  expect(memory.resolveAncestors("a", ["r0"], 2_000)).toBeNull();

  const deep = new MovedContainerMemory(60_000);
  const longAncestors = Array.from(
    { length: MAX_CONTAINER_PATH_LENGTH },
    (_, index) => `anc-${index}`,
  );
  deep.remember("x", longAncestors, "2026-01-01T00:00:05.000Z", 1_000);
  expect(deep.resolvePath(["r0", "x", "leaf"], 2_000)).toBeNull();
  expect(deep.resolveAncestors("x", ["r0"], 2_000)).toBeNull();
});

test("evicts oldest entries in O(1) when capacity is reached", () => {
  const memory = new MovedContainerMemory(60_000, 2);
  memory.remember("a", ["r1"], "2026-01-01T00:00:01.000Z", 1_000);
  memory.remember("b", ["r2"], "2026-01-01T00:00:02.000Z", 2_000);
  memory.remember("c", ["r3"], "2026-01-01T00:00:03.000Z", 3_000);

  expect(memory.resolveAncestors("a", ["old"], 4_000)).toEqual(["old"]);
  expect(memory.resolveAncestors("b", ["old"], 4_000)).toEqual(["r2"]);
  expect(memory.resolveAncestors("c", ["old"], 4_000)).toEqual(["r3"]);
});

test("leaves undefined paths undefined (fail-closed)", () => {
  const memory = new MovedContainerMemory(60_000);
  memory.remember("folder-a", ["root-2"], "2026-01-01T00:00:05.000Z", 1_000);
  expect(memory.resolveAncestors("folder-a", undefined, 2_000)).toBeUndefined();
  expect(memory.resolvePath(undefined, 2_000)).toBeUndefined();
});

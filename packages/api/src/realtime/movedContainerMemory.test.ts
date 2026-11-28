import { expect, test } from "bun:test";
import {
  MOVED_CONTAINER_TTL_MS,
  MovedContainerMemory,
} from "./movedContainerMemory";

test("rewrites moved container and descendant prefixes until TTL expiry", () => {
  const memory = new MovedContainerMemory(MOVED_CONTAINER_TTL_MS);
  memory.remember(
    "folder-a",
    ["root-2", "parent-2"],
    "2026-01-01T00:00:05Z",
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

test("chained moves rewrite transitively without overwriting newer moves with older ones", () => {
  const memory = new MovedContainerMemory(60_000);
  memory.remember("parent-2", ["root-3"], "2026-01-01T00:00:10Z", 1_000);
  memory.remember(
    "folder-a",
    ["root-2", "parent-2"],
    "2026-01-01T00:00:05Z",
    1_000,
  );
  // Out-of-order older move must not replace the newer move.
  memory.remember("folder-a", ["root-stale"], "2026-01-01T00:00:01Z", 2_000);

  expect(memory.resolvePath(["root-1", "folder-a", "leaf"], 2_000)).toEqual([
    "root-3",
    "parent-2",
    "folder-a",
    "leaf",
  ]);
});

test("leaves undefined paths undefined (fail-closed)", () => {
  const memory = new MovedContainerMemory(60_000);
  memory.remember("folder-a", ["root-2"], "2026-01-01T00:00:05Z", 1_000);
  expect(memory.resolveAncestors("folder-a", undefined, 2_000)).toBeUndefined();
  expect(memory.resolvePath(undefined, 2_000)).toBeUndefined();
});

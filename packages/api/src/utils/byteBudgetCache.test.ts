import { expect, test } from "bun:test";
import { ByteBudgetCache } from "./byteBudgetCache";

test("byte budgets retain many small entries and evict the least recently used", () => {
  const cache = new ByteBudgetCache<string>(600);
  cache.set("a", "first", 50);
  cache.set("b", "second", 50);
  cache.set("c", "third", 50);
  expect(cache.get("a")).toBe("first");
  cache.set("d", "fourth", 50);
  expect(cache.get("b")).toBeUndefined();
  expect(cache.get("a")).toBe("first");
  expect(cache.get("c")).toBe("third");
  expect(cache.get("d")).toBe("fourth");
});

test("replacements and clears release their charged bytes", () => {
  const cache = new ByteBudgetCache<string>(600);
  cache.set("a", "large", 400);
  cache.set("a", "small", 50);
  cache.set("b", "second", 50);
  cache.set("c", "third", 50);
  expect(cache.get("a")).toBe("small");
  cache.clear();
  cache.set("d", "large", 400);
  expect(cache.get("a")).toBeUndefined();
  expect(cache.get("d")).toBe("large");
});

test("oversized values bypass the cache without evicting unrelated entries", () => {
  const cache = new ByteBudgetCache<string>(600);
  cache.set("a", "kept", 50);
  cache.set("b", "too large", 600);
  expect(cache.get("a")).toBe("kept");
  expect(cache.get("b")).toBeUndefined();
  expect(() => cache.set("c", "invalid", Number.NaN)).toThrow(RangeError);
});

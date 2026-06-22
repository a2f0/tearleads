import { expect, test } from "bun:test";
import { BoundedCache } from "./ApiCache";

test("stores and retrieves entries", () => {
  const cache = new BoundedCache<number>(3);
  cache.set("a", 1);
  expect(cache.get("a")).toBe(1);
  expect(cache.has("a")).toBe(true);
  expect(cache.get("missing")).toBeUndefined();
  expect(cache.has("missing")).toBe(false);
});

test("evicts the least-recently-used entry past the cap", () => {
  const cache = new BoundedCache<number>(2);
  cache.set("a", 1);
  cache.set("b", 2);
  cache.set("c", 3);
  expect(cache.has("a")).toBe(false);
  expect(cache.get("b")).toBe(2);
  expect(cache.get("c")).toBe(3);
  expect(cache.size).toBe(2);
});

test("get is side-effect-free and does not refresh recency", () => {
  const cache = new BoundedCache<number>(2);
  cache.set("a", 1);
  cache.set("b", 2);
  // Reading "a" must NOT protect it: the request helpers compare the stored
  // promise by reference, so get() stays pure and eviction is by write order.
  expect(cache.get("a")).toBe(1);
  cache.set("c", 3);
  expect(cache.has("a")).toBe(false);
  expect(cache.has("b")).toBe(true);
  expect(cache.has("c")).toBe(true);
});

test("overwriting an entry refreshes recency without growing size", () => {
  const cache = new BoundedCache<number>(2);
  cache.set("a", 1);
  cache.set("b", 2);
  cache.set("a", 11);
  cache.set("c", 3);
  expect(cache.get("a")).toBe(11);
  expect(cache.has("b")).toBe(false);
  expect(cache.size).toBe(2);
});

test("delete and clear remove entries", () => {
  const cache = new BoundedCache<number>(4);
  cache.set("a", 1);
  cache.set("b", 2);
  expect(cache.delete("a")).toBe(true);
  expect(cache.delete("a")).toBe(false);
  expect(cache.has("a")).toBe(false);
  cache.clear();
  expect(cache.size).toBe(0);
  expect(cache.has("b")).toBe(false);
});

test("rejects a non-positive cap", () => {
  expect(() => new BoundedCache<number>(0)).toThrow(RangeError);
});

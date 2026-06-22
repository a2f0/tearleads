import { beforeEach, expect, test } from "bun:test";
import { clearInMemoryRedisData } from "./adapters/inMemoryRedis";
import { wsInterestStore } from "./wsInterestStore";

beforeEach(() => {
  clearInMemoryRedisData();
});

test("replace then load round-trips the interest set", async () => {
  await wsInterestStore.apply("u1", "s1", {
    containerIds: ["a", "b"],
    kind: "replace",
  });
  expect((await wsInterestStore.load("u1", "s1")).sort()).toEqual(["a", "b"]);
});

test("add and remove mutate the persisted set", async () => {
  await wsInterestStore.apply("u1", "s1", { containerIds: ["a"], kind: "add" });
  await wsInterestStore.apply("u1", "s1", {
    containerIds: ["b", "c"],
    kind: "add",
  });
  await wsInterestStore.apply("u1", "s1", {
    containerIds: ["b"],
    kind: "remove",
  });
  expect((await wsInterestStore.load("u1", "s1")).sort()).toEqual(["a", "c"]);
});

test("replace clears the prior set", async () => {
  await wsInterestStore.apply("u1", "s1", {
    containerIds: ["a", "b"],
    kind: "add",
  });
  await wsInterestStore.apply("u1", "s1", {
    containerIds: ["c"],
    kind: "replace",
  });
  expect(await wsInterestStore.load("u1", "s1")).toEqual(["c"]);
});

test("interest is scoped per user and session", async () => {
  await wsInterestStore.apply("u1", "s1", { containerIds: ["a"], kind: "add" });
  expect(await wsInterestStore.load("u1", "s2")).toEqual([]);
  expect(await wsInterestStore.load("u2", "s1")).toEqual([]);
});

test("clear removes the persisted set", async () => {
  await wsInterestStore.apply("u1", "s1", { containerIds: ["a"], kind: "add" });
  await wsInterestStore.clear("u1", "s1");
  expect(await wsInterestStore.load("u1", "s1")).toEqual([]);
});

test("a null applied interest is a no-op", async () => {
  await wsInterestStore.apply("u1", "s1", null);
  expect(await wsInterestStore.load("u1", "s1")).toEqual([]);
});

test("deduplicates and persists a large interest set", async () => {
  const containerIds = Array.from({ length: 250 }, (_, i) => `c${i % 200}`);
  await wsInterestStore.apply("u1", "s1", {
    containerIds,
    kind: "replace",
  });
  // 250 ids with 50 duplicates -> 200 unique members, chunked under the hood.
  expect((await wsInterestStore.load("u1", "s1")).length).toBe(200);
});

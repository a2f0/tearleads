import { beforeEach, expect, test } from "bun:test";
import { clearInMemoryRedisData } from "../adapters/inMemoryRedis";
import { createWsInterestStore, wsInterestStore } from "./wsInterestStore";

function createRecordingDeps() {
  const sets = new Map<string, Set<string>>();
  const expireCalls: Array<{ key: string; ttlSeconds: number }> = [];
  return {
    expireCalls,
    deps: {
      async del(key: string) {
        sets.delete(key);
      },
      async expire(key: string, ttlSeconds: number) {
        expireCalls.push({ key, ttlSeconds });
      },
      async sadd(key: string, member: string) {
        const set = sets.get(key) ?? new Set<string>();
        set.add(member);
        sets.set(key, set);
      },
      async srem(key: string, member: string) {
        sets.get(key)?.delete(member);
      },
      async *sscanMembers(key: string) {
        const set = sets.get(key);
        if (set) {
          yield [...set];
        }
      },
    },
  };
}

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

test("remove re-arms the interest TTL so it survives the session", async () => {
  const { deps, expireCalls } = createRecordingDeps();
  const store = createWsInterestStore(deps);
  await store.apply("u1", "s1", { containerIds: ["a", "b"], kind: "add" });
  expireCalls.length = 0;
  await store.apply("u1", "s1", { containerIds: ["a"], kind: "remove" });
  expect(expireCalls).toHaveLength(1);
  expect(expireCalls[0]?.ttlSeconds).toBeGreaterThan(0);
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

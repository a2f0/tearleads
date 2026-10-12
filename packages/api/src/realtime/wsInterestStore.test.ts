import { beforeEach, expect, test } from "bun:test";
import { clearInMemoryRedisData } from "../adapters/inMemoryRedis";
import {
  createOrderedInterestPersister,
  createWsInterestStore,
  wsInterestStore,
} from "./wsInterestStore";

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

test("the persister pauses a session whose writes lag behind the bound", async () => {
  const releases: (() => void)[] = [];
  const persister = createOrderedInterestPersister(
    {
      apply: () =>
        new Promise<void>((resolve) => {
          releases.push(resolve);
        }),
    },
    2,
  );
  persister("user", "session", { kind: "add", containerIds: ["a"] });
  persister("user", "session", { kind: "remove", containerIds: ["a"] });
  expect(persister.pending("user", "session")).toBe(2);
  // Another session is unaffected.
  await persister.drain("user", "other");
  let drained = false;
  const waiting = persister.drain("user", "session").then(() => {
    drained = true;
  });
  await Bun.sleep(0);
  expect(drained).toBe(false);
  releases[0]?.();
  await Bun.sleep(0);
  // Still at the bound until the whole queue settles.
  expect(persister.pending("user", "session")).toBe(1);
  releases[1]?.();
  await waiting;
  expect(drained).toBe(true);
  expect(persister.pending("user", "session")).toBe(0);
});

test("flush settles its captured writes even while another event queues more", async () => {
  const first = Promise.withResolvers<void>();
  const second = Promise.withResolvers<void>();
  const persister = createOrderedInterestPersister({
    apply: (_user, session) =>
      session === "first" ? first.promise : second.promise,
  });
  persister("user", "first", { kind: "add", containerIds: ["a"] });
  const flushing = persister.flush();
  persister("user", "second", { kind: "add", containerIds: ["b"] });
  try {
    first.resolve();
    const result = await Promise.race([
      flushing.then(() => "flushed"),
      Bun.sleep(0).then(() => "blocked"),
    ]);
    expect(result).toBe("flushed");
    expect(persister.pending("user", "second")).toBe(1);
  } finally {
    first.resolve();
    second.resolve();
    await flushing;
    await persister.flush();
  }
});

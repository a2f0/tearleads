import { Database } from "bun:sqlite";
import {
  afterEach,
  beforeEach,
  expect,
  mock,
  setSystemTime,
  test,
} from "bun:test";

// The Durable Object base class is runtime-provided; the store only needs the
// constructor to keep its context, and the SQLite surface is the same dialect
// Bun ships, so the object runs unchanged against an in-memory database.
mock.module("cloudflare:workers", () => ({
  DurableObject: class {
    constructor(
      protected readonly ctx: unknown,
      protected readonly env: unknown,
    ) {}
  },
}));

const { KeyValueStore } = await import("./keyValueStoreObject");

function createStore() {
  const database = new Database(":memory:");
  let alarm: number | null = null;
  const ctx = {
    storage: {
      sql: {
        exec: <Row>(
          query: string,
          ...bindings: readonly (string | number | null)[]
        ) => {
          const rows = database.query(query).all(...bindings) as Row[];
          return {
            toArray: () => rows,
            [Symbol.iterator]: () => rows[Symbol.iterator](),
          };
        },
      },
      getAlarm: async () => alarm,
      setAlarm: async (scheduledTime: number) => {
        alarm = scheduledTime;
      },
    },
    blockConcurrencyWhile: async <T>(callback: () => Promise<T>) => callback(),
  };
  return { store: new KeyValueStore(ctx, {}), alarmAt: () => alarm };
}

beforeEach(() => {
  setSystemTime(new Date("2026-10-11T12:00:00.000Z"));
});

afterEach(() => {
  setSystemTime();
});

test("set, get, and expiry behave like Redis strings with TTL", () => {
  const { store } = createStore();
  store.set("session:a", "alice", 60);
  store.set("session:b", "bob");
  expect(store.get("session:a")).toBe("alice");
  setSystemTime(new Date("2026-10-11T12:00:59.000Z"));
  expect(store.get("session:a")).toBe("alice");
  setSystemTime(new Date("2026-10-11T12:01:00.000Z"));
  expect(store.get("session:a")).toBeNull();
  expect(store.get("session:b")).toBe("bob");
});

test("getdel consumes a ticket exactly once", () => {
  const { store } = createStore();
  store.set("ws-ticket:t", "identity", 60);
  expect(store.getdel("ws-ticket:t")).toBe("identity");
  expect(store.getdel("ws-ticket:t")).toBeNull();
  expect(store.get("ws-ticket:t")).toBeNull();
});

test("an expired ticket cannot be consumed", () => {
  const { store } = createStore();
  store.set("ws-ticket:t", "identity", 60);
  setSystemTime(new Date("2026-10-11T12:01:00.000Z"));
  expect(store.getdel("ws-ticket:t")).toBeNull();
});

test("setKeepTtl updates only a live entry and preserves its expiry", () => {
  const { store } = createStore();
  store.set("session:a", "v1", 60);
  store.setKeepTtl("session:a", "v2");
  expect(store.get("session:a")).toBe("v2");
  setSystemTime(new Date("2026-10-11T12:01:00.000Z"));
  // The activity update did not extend the session.
  expect(store.get("session:a")).toBeNull();
  // A revoked or expired session is not resurrected by a late activity write.
  store.setKeepTtl("session:a", "v3");
  expect(store.get("session:a")).toBeNull();
  store.del("session:missing");
  store.setKeepTtl("session:missing", "v1");
  expect(store.get("session:missing")).toBeNull();
});

test("sets page by member cursor and honor their expiry", () => {
  const { store } = createStore();
  for (const member of ["c", "a", "b"]) {
    store.sadd("user-sessions:u", member);
  }
  expect(store.smembers("user-sessions:u", null)).toEqual(["a", "b", "c"]);
  expect(store.smembers("user-sessions:u", "a")).toEqual(["b", "c"]);
  store.srem("user-sessions:u", "b");
  expect(store.smembers("user-sessions:u", "a")).toEqual(["c"]);
  store.expire("user-sessions:u", 60);
  setSystemTime(new Date("2026-10-11T12:01:00.000Z"));
  expect(store.smembers("user-sessions:u", null)).toEqual([]);
  // A write after expiry starts a fresh set rather than reviving the old one.
  store.sadd("user-sessions:u", "z");
  expect(store.smembers("user-sessions:u", null)).toEqual(["z"]);
});

test("a key holds either a string or a set, and del clears both", () => {
  const { store } = createStore();
  store.set("k", "string");
  store.sadd("k", "member");
  expect(store.get("k")).toBeNull();
  expect(store.smembers("k", null)).toEqual(["member"]);
  store.set("k", "again");
  expect(store.smembers("k", null)).toEqual([]);
  store.del("k");
  expect(store.get("k")).toBeNull();
});

test("the alarm sweeps expired rows and re-arms itself", async () => {
  const { store, alarmAt } = createStore();
  store.set("a", "1", 60);
  store.sadd("s", "m");
  store.expire("s", 60);
  setSystemTime(new Date("2026-10-11T13:00:00.000Z"));
  await store.alarm();
  expect(alarmAt()).toBe(Date.now() + 60 * 60 * 1000);
  // The rows are gone even for a reader that ignores expiry.
  store.sadd("s", "n");
  expect(store.smembers("s", null)).toEqual(["n"]);
  expect(store.get("a")).toBeNull();
});

import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import type { GatewaySocketSnapshot } from "../realtime/gatewayHibernation";
import { HubSocketStore } from "./hubSocketStore";

function fixture() {
  const db = new Database(":memory:");
  const store = new HubSocketStore({
    exec: <Row>(
      query: string,
      ...bindings: readonly (string | number | null)[]
    ) => {
      const rows = db.query(query).all(...bindings) as Row[];
      return {
        toArray: () => rows,
        [Symbol.iterator]: () => rows[Symbol.iterator](),
      };
    },
  });
  return { db, store };
}

function snapshot(): GatewaySocketSnapshot {
  return {
    proofs: [],
    verifiedAt: 1,
    nextCheckAt: 10,
    session: { confirmedAt: 1, nextCheckAt: 10 },
    organization: null,
  };
}

test("stores interest larger than a SQL value and removes leftover chunks on shrink", () => {
  const { db, store } = fixture();
  try {
    const saved = snapshot();
    for (let index = 0; index < 10_000; index++)
      saved.proofs.push({
        containerId: String(index),
        pathContainerIds: ["parent".repeat(50)],
        principalKeys: ["principal:group:g"],
      });
    expect(JSON.stringify(saved).length).toBeGreaterThan(2 * 1024 * 1024);
    store.save("a", saved);
    expect(store.load("a")).toEqual(saved);
    store.save("a", snapshot());
    expect(store.load("a")).toEqual(snapshot());
    expect(
      db.query("SELECT count(*) AS n FROM realtime_socket_chunks").get(),
    ).toEqual({ n: 1 });
    store.prune(new Set());
    expect(store.load("a")).toBeNull();
  } finally {
    db.close();
  }
});

test("chunk boundaries preserve Unicode and pruning keeps only connected sockets", () => {
  const { db, store } = fixture();
  try {
    const saved = snapshot();
    saved.proofs.push({
      containerId: "x",
      pathContainerIds: [],
      principalKeys: ["a".repeat(16_300) + "🙂".repeat(100)],
    });
    store.save("keep", saved);
    store.save("gone", snapshot());
    store.prune(new Set(["keep"]));
    expect(store.load("keep")).toEqual(saved);
    expect(store.load("gone")).toBeNull();
  } finally {
    db.close();
  }
});

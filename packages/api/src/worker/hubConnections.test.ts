import { Database } from "bun:sqlite";
import { expect, spyOn, test } from "bun:test";
import { createRealtimeGateway } from "../realtime/realtimeGateway";
import { HubConnections } from "./hubConnections";
import { HubSocketStore } from "./hubSocketStore";

test("ordinary hints do not rewrite unchanged snapshots but declarations persist", async () => {
  const gateway = createRealtimeGateway({
    revalidation: { intervalMs: 0 },
    interestStore: { load: async () => [], apply: async () => {} },
    validateSession: async () => true,
  });
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
  const save = spyOn(store, "save");
  const snapshot = spyOn(gateway.hibernation, "snapshot");
  const sent: string[] = [];
  // Only the host's send/close surface is used; lifecycle coverage uses workerd.
  const server = {
    send: (message: string) => sent.push(message),
    close: () => {},
  } as unknown as CloudflareServerWebSocket;
  const connections = new HubConnections(
    {
      gateway,
      consumeTicket: async () => null,
      report: () => {},
      withDatabase: (work) => work(),
    },
    store,
  );
  try {
    await connections.attach(server, {
      id: "socket",
      identity: { userId: "user", sessionId: "session" },
    });
    connections.saveDirty();
    expect(connections.countSession("user", "session")).toBe(1);
    save.mockClear();
    snapshot.mockClear();
    sent.length = 0;
    await gateway.publish(
      JSON.stringify({ type: "shared_with_you", userId: "user" }),
    );
    connections.saveDirty();
    expect(sent).toHaveLength(1);
    expect(save).not.toHaveBeenCalled();
    expect(snapshot).not.toHaveBeenCalled();
    const declaration = JSON.stringify({
      type: "known_containers",
      declarationId: "new",
      containerIds: [],
    });
    await connections.message(server, declaration, declaration.length);
    connections.saveDirty();
    expect(save).toHaveBeenCalled();
    expect(store.load("socket")).not.toBeNull();
    connections.close(server);
    expect(connections.countSession("user", "session")).toBe(0);
    expect(store.load("socket")).toBeNull();
  } finally {
    gateway.stop();
    db.close();
  }
});

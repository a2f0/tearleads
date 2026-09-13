import { expect, test } from "bun:test";
import type { Tearleads } from "@tearleads/client-sdk";
import {
  createMswEventRouter,
  type MswSocketClient,
} from "../../../test/helpers/mswEventRouter";
import { startContainerInterestDeclaration } from "./serverEventsBinding";

function createFakeStore(initialIds: string[]) {
  let ids = initialIds;
  let ready = true;
  const listeners = new Set<() => void>();
  return {
    setNodes(next: string[]) {
      ids = next;
      for (const listener of listeners) {
        listener();
      }
    },
    setReady(next: boolean) {
      ready = next;
      for (const listener of listeners) {
        listener();
      }
    },
    store: {
      getSnapshot: () => ({ nodes: ids.map((id) => ({ id })), ready }),
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  };
}

function acknowledgeInitialDeclaration(
  handle: ReturnType<typeof startContainerInterestDeclaration>,
  sent: string[],
): void {
  const declaration = JSON.parse(sent.at(-1) ?? "null") as {
    declarationId?: unknown;
  };
  expect(typeof declaration.declarationId).toBe("string");
  expect(handle.acknowledge(String(declaration.declarationId))).toBe(true);
}

function tearleadsWithStore(openTree: () => unknown): Tearleads {
  return {
    deviceFirst: {
      open: () => ({ containerStore: openTree() }),
    },
  } as unknown as Tearleads;
}

function fakeSocket(readyState: number) {
  const sent: string[] = [];
  return {
    sent,
    ws: {
      readyState,
      send: (message: string) => {
        sent.push(message);
      },
    } as unknown as WebSocket,
  };
}

test("declares the authoritative ready set, waits for its ack, then sends deltas", () => {
  const fakeStore = createFakeStore(["c1", "c2"]);
  const { sent, ws } = fakeSocket(WebSocket.OPEN);

  const handle = startContainerInterestDeclaration(
    tearleadsWithStore(() => fakeStore.store),
    ws,
    new Set(),
  );

  expect(JSON.parse(sent[0] ?? "null")).toEqual({
    type: "known_containers",
    containerIds: ["c1", "c2"],
    declarationId: expect.any(String),
  });
  acknowledgeInitialDeclaration(handle, sent);

  fakeStore.setNodes(["c1", "c2", "c3"]);
  expect(JSON.parse(sent[1] ?? "null")).toEqual({
    type: "known_containers.add",
    containerIds: ["c3"],
  });

  fakeStore.setNodes(["c2", "c3"]);
  expect(JSON.parse(sent[2] ?? "null")).toEqual({
    type: "known_containers.remove",
    containerIds: ["c1"],
  });

  handle.stop();
  fakeStore.setNodes(["c2"]);
  expect(sent).toHaveLength(3);
});

test("re-declares an invalidated container on the next tree change", () => {
  // The server evicted "b" on an access change; invalidate forgets it so the
  // next tree change re-declares it (still authorized) without an immediate
  // re-add before the access re-check.
  const fakeStore = createFakeStore(["a", "b"]);
  const { sent, ws } = fakeSocket(WebSocket.OPEN);

  const handle = startContainerInterestDeclaration(
    tearleadsWithStore(() => fakeStore.store),
    ws,
    new Set(["a", "b"]),
  );
  acknowledgeInitialDeclaration(handle, sent);
  sent.length = 0;

  handle.invalidate("b");
  // No immediate re-add; only the next tree change re-evaluates.
  expect(sent).toEqual([]);

  fakeStore.setNodes(["a", "b"]);
  expect(JSON.parse(sent[0] ?? "null")).toEqual({
    type: "known_containers.add",
    containerIds: ["b"],
  });
});

test("re-declares an invalidated container after an unchanged access recheck", () => {
  const fakeStore = createFakeStore(["a", "b"]);
  const { sent, ws } = fakeSocket(WebSocket.OPEN);

  const handle = startContainerInterestDeclaration(
    tearleadsWithStore(() => fakeStore.store),
    ws,
    new Set(["a", "b"]),
  );
  acknowledgeInitialDeclaration(handle, sent);
  sent.length = 0;

  handle.invalidate("b");
  handle.sync();

  expect(JSON.parse(sent[0] ?? "null")).toEqual({
    type: "known_containers.add",
    containerIds: ["b"],
  });
});

test("replaces a hydrated baseline with the authoritative ready tree", () => {
  const fakeStore = createFakeStore(["a", "b", "c"]);
  const { sent, ws } = fakeSocket(WebSocket.OPEN);

  startContainerInterestDeclaration(
    tearleadsWithStore(() => fakeStore.store),
    ws,
    new Set(["a", "b"]),
  );

  expect(JSON.parse(sent[0] ?? "null")).toEqual({
    type: "known_containers",
    containerIds: ["a", "b", "c"],
    declarationId: expect.any(String),
  });
  expect(sent).toHaveLength(1);
});

test("acknowledges an authoritative declaration even when baseline matches", () => {
  const fakeStore = createFakeStore(["a", "b"]);
  const { sent, ws } = fakeSocket(WebSocket.OPEN);

  const handle = startContainerInterestDeclaration(
    tearleadsWithStore(() => fakeStore.store),
    ws,
    new Set(["a", "b"]),
  );

  expect(JSON.parse(sent[0] ?? "null")).toEqual({
    type: "known_containers",
    containerIds: ["a", "b"],
    declarationId: expect.any(String),
  });
  acknowledgeInitialDeclaration(handle, sent);
  expect(handle.acknowledge("stale")).toBe(false);
});

test("retains the hydrated baseline until the local tree is ready", () => {
  const fakeStore = createFakeStore([]);
  fakeStore.setReady(false);
  const { sent, ws } = fakeSocket(WebSocket.OPEN);
  const handle = startContainerInterestDeclaration(
    tearleadsWithStore(() => fakeStore.store),
    ws,
    new Set(["a", "b"]),
  );

  expect(sent).toEqual([]);
  fakeStore.setNodes(["a", "b"]);
  expect(sent).toEqual([]);
  fakeStore.setReady(true);
  expect(JSON.parse(sent[0] ?? "null")).toEqual({
    type: "known_containers",
    containerIds: ["a", "b"],
    declarationId: expect.any(String),
  });
  acknowledgeInitialDeclaration(handle, sent);
});

test("skips interest when the container tree cannot be opened", () => {
  const { sent, ws } = fakeSocket(WebSocket.OPEN);

  const handle = startContainerInterestDeclaration(
    tearleadsWithStore(() => {
      throw new Error("runtime not ready");
    }),
    ws,
    new Set(),
  );

  expect(sent).toEqual([]);
  expect(() => handle.stop()).not.toThrow();
  expect(() => handle.invalidate("anything")).not.toThrow();
});

test("does not send while the socket is not open", () => {
  const fakeStore = createFakeStore(["c1"]);
  const { sent, ws } = fakeSocket(WebSocket.CONNECTING);

  startContainerInterestDeclaration(
    tearleadsWithStore(() => fakeStore.store),
    ws,
    new Set(),
  );

  expect(sent).toEqual([]);
});

test("reconnect with a revoked local ID reaches the acknowledgment barrier and reconciles", () => {
  const fakeStore = createFakeStore(["revoked", "readable"]);
  const router = createMswEventRouter({
    containerPath: (id) => (id === "revoked" ? null : [id]),
  });
  const serverFrames: Array<Record<string, unknown>> = [];
  let listener: ((event: { data?: unknown }) => void) | undefined;
  const client: MswSocketClient = {
    addEventListener: (type, callback) => {
      if (type === "message") listener = callback;
    },
    send: (data) => {
      serverFrames.push(JSON.parse(data));
    },
  };
  router.handleConnection(client);
  const sent: Array<Record<string, unknown>> = [];
  const ws = {
    readyState: WebSocket.OPEN,
    send: (data: string) => {
      sent.push(JSON.parse(data));
      listener?.({ data });
    },
  } as unknown as WebSocket;
  const handle = startContainerInterestDeclaration(
    tearleadsWithStore(() => fakeStore.store),
    ws,
    new Set(["readable"]),
  );
  const ack = serverFrames.find(
    (frame) => Reflect.get(frame, "type") === "known_containers_ack",
  );
  if (!ack) throw new Error("Missing declaration acknowledgment");
  const declarationId = Reflect.get(ack, "declarationId");
  expect(declarationId).toBeString();
  expect(handle.acknowledge(String(declarationId))).toBe(true);
  // The production binding starts HTTP catch-up after this barrier. Its tree
  // result drops the revoked ID; the connection remains available for deltas.
  fakeStore.setNodes(["readable"]);
  expect(sent.at(-1)).toEqual({
    type: "known_containers.remove",
    containerIds: ["revoked"],
  });
  handle.stop();
});

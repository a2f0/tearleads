import { expect, test } from "bun:test";
import type { Tearleads } from "@tearleads/client-sdk";
import { MAX_WS_INTEREST_CONTAINER_IDS } from "@tearleads/validators/realtime";
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
    containerIds: string[];
  };
  expect(typeof declaration.declarationId).toBe("string");
  expect(
    handle.acknowledge(
      String(declaration.declarationId),
      declaration.containerIds,
    ),
  ).toBe(true);
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

for (const initialPending of [false, true]) {
  test(`bulk discovery coalesces behind ${initialPending ? "initial" : "delta"} authorization`, () => {
    const fakeStore = createFakeStore(["root"]);
    const { sent, ws } = fakeSocket(WebSocket.OPEN);
    const handle = startContainerInterestDeclaration(
      tearleadsWithStore(() => fakeStore.store),
      ws,
      new Set(),
    );
    if (!initialPending) {
      acknowledgeInitialDeclaration(handle, sent);
      fakeStore.setNodes(["root", "first"]);
    }
    const pending = JSON.parse(sent.at(-1) ?? "null");
    const sentBefore = sent.length;
    for (let count = 1; count <= 100; count++) {
      fakeStore.setNodes([
        "root",
        ...Array.from({ length: count }, (_, index) => `child-${index}`),
      ]);
    }
    expect(sent).toHaveLength(sentBefore);
    expect(
      handle.acknowledge(pending.declarationId, pending.containerIds),
    ).toBe(initialPending);
    const deltas = sent.slice(sentBefore).map((value) => JSON.parse(value));
    expect(deltas[0]).toMatchObject({
      type: "known_containers.add",
      containerIds: Array.from({ length: 100 }, (_, index) => `child-${index}`),
    });
    expect(deltas).toHaveLength(initialPending ? 1 : 2);
    if (!initialPending)
      expect(deltas[1]).toMatchObject({
        type: "known_containers.remove",
        containerIds: ["first"],
      });
    handle.stop();
  });
}

test("splits an oversized declaration at the server cap and clears the barrier on the last ack", () => {
  const ids = Array.from(
    { length: MAX_WS_INTEREST_CONTAINER_IDS + 1 },
    (_, index) => `container-${index}`,
  );
  const fakeStore = createFakeStore(ids);
  const { sent, ws } = fakeSocket(WebSocket.OPEN);
  const handle = startContainerInterestDeclaration(
    tearleadsWithStore(() => fakeStore.store),
    ws,
    new Set(),
  );
  const [first, second] = sent.map((value) => JSON.parse(value));
  expect(sent).toHaveLength(2);
  expect(first).toMatchObject({ type: "known_containers" });
  expect(first.containerIds).toHaveLength(MAX_WS_INTEREST_CONTAINER_IDS);
  expect(second).toMatchObject({
    type: "known_containers.add",
    containerIds: [ids.at(-1)],
  });
  expect(first.declarationId).not.toBe(second.declarationId);
  // Neither chunk alone completes the authoritative declaration.
  expect(handle.acknowledge(first.declarationId, first.containerIds)).toBe(
    false,
  );
  expect(handle.acknowledge(second.declarationId, second.containerIds)).toBe(
    true,
  );

  fakeStore.setNodes([
    ...ids,
    ...Array.from(
      { length: MAX_WS_INTEREST_CONTAINER_IDS + 1 },
      (_, index) => `later-${index}`,
    ),
  ]);
  const deltas = sent.slice(2).map((value) => JSON.parse(value));
  expect(deltas.map((delta) => delta.type)).toEqual([
    "known_containers.add",
    "known_containers.add",
  ]);
  expect(deltas.map((delta) => delta.containerIds.length)).toEqual([
    MAX_WS_INTEREST_CONTAINER_IDS,
    1,
  ]);
  handle.stop();
});

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
    declarationId: expect.any(String),
    containerIds: ["c3"],
  });

  const addition = JSON.parse(sent[1] ?? "null");
  expect(handle.acknowledge(addition.declarationId, ["c3"])).toBe(false);

  fakeStore.setNodes(["c2", "c3"]);
  expect(JSON.parse(sent[2] ?? "null")).toEqual({
    type: "known_containers.remove",
    declarationId: expect.any(String),
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
    declarationId: expect.any(String),
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
    declarationId: expect.any(String),
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
  expect(handle.acknowledge("stale", [])).toBe(false);
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
  expect(handle.acknowledge(String(declarationId), ["readable"])).toBe(true);
  // The production binding starts HTTP catch-up after this barrier. Its tree
  // result drops the revoked ID; the connection remains available for deltas.
  fakeStore.setNodes(["readable"]);
  expect(Reflect.get(ack, "containerIds")).toEqual(["readable"]);
  expect(sent).toHaveLength(1);
  handle.stop();
});

test("a denied local container is retried on a later tree change without looping", () => {
  const fakeStore = createFakeStore(["pending"]);
  const { sent, ws } = fakeSocket(WebSocket.OPEN);
  const handle = startContainerInterestDeclaration(
    tearleadsWithStore(() => fakeStore.store),
    ws,
    new Set(),
  );
  const first = JSON.parse(sent[0] ?? "null");
  expect(handle.acknowledge(first.declarationId, [])).toBe(true);
  expect(sent).toHaveLength(1);
  fakeStore.setNodes(["pending"]);
  const retry = JSON.parse(sent[1] ?? "null");
  expect(retry).toMatchObject({
    type: "known_containers.add",
    containerIds: ["pending"],
  });
  expect(handle.acknowledge(retry.declarationId, ["pending"])).toBe(false);
  fakeStore.setNodes(["pending"]);
  expect(sent).toHaveLength(2);
  handle.stop();
});

test("a tree change during a refused addition causes exactly one fresh declaration", () => {
  const fakeStore = createFakeStore([]);
  const { sent, ws } = fakeSocket(WebSocket.OPEN);
  const handle = startContainerInterestDeclaration(
    tearleadsWithStore(() => fakeStore.store),
    ws,
    new Set(),
  );
  acknowledgeInitialDeclaration(handle, sent);
  fakeStore.setNodes(["pending"]);
  const adding = JSON.parse(sent[1] ?? "null");
  fakeStore.setNodes(["pending"]);
  expect(sent).toHaveLength(2);
  expect(handle.acknowledge(adding.declarationId, [])).toBe(false);
  expect(sent).toHaveLength(3);
  const retry = JSON.parse(sent[2] ?? "null");
  expect(handle.acknowledge(retry.declarationId, [])).toBe(false);
  expect(sent).toHaveLength(3);
  handle.stop();
});

test("an older refused declaration cannot erase a newer accepted subscription", () => {
  const fakeStore = createFakeStore(["a"]);
  const { sent, ws } = fakeSocket(WebSocket.OPEN);
  const handle = startContainerInterestDeclaration(
    tearleadsWithStore(() => fakeStore.store),
    ws,
    new Set(),
  );
  const earlier = JSON.parse(sent[0] ?? "null");
  fakeStore.setNodes(["a", "b"]);
  expect(sent).toHaveLength(1);
  expect(handle.acknowledge(earlier.declarationId, ["a"])).toBe(true);
  const later = JSON.parse(sent[1] ?? "null");
  expect(handle.acknowledge(later.declarationId, ["b"])).toBe(false);
  expect(handle.acknowledge(earlier.declarationId, [])).toBe(false);
  fakeStore.setNodes(["a", "b"]);
  expect(sent).toHaveLength(2);
  handle.stop();
});

test("grant recovery re-declares only refused interests", () => {
  const fakeStore = createFakeStore(["readable", "refused"]);
  const { sent, ws } = fakeSocket(WebSocket.OPEN);
  const handle = startContainerInterestDeclaration(
    tearleadsWithStore(() => fakeStore.store),
    ws,
    new Set(),
  );
  const initial = JSON.parse(sent[0] ?? "null");
  expect(handle.acknowledge(initial.declarationId, ["readable"])).toBe(true);
  handle.retryRefused();
  expect(JSON.parse(sent[1] ?? "null")).toMatchObject({
    type: "known_containers.add",
    containerIds: ["refused"],
  });
  handle.stop();
});

test("a grant during initial authorization preserves its acknowledgment barrier", () => {
  const fakeStore = createFakeStore(["readable", "refused"]);
  const { sent, ws } = fakeSocket(WebSocket.OPEN);
  const handle = startContainerInterestDeclaration(
    tearleadsWithStore(() => fakeStore.store),
    ws,
    new Set(),
  );
  const initial = JSON.parse(sent[0] ?? "null");
  handle.retryRefused();
  expect(sent).toHaveLength(1);
  expect(handle.acknowledge(initial.declarationId, ["readable"])).toBe(true);
  expect(JSON.parse(sent[1] ?? "null")).toMatchObject({
    type: "known_containers.add",
    containerIds: ["refused"],
  });
  const retry = JSON.parse(sent[1] ?? "null");
  expect(handle.acknowledge(retry.declarationId, [])).toBe(false);
  expect(sent).toHaveLength(2);
  handle.stop();
});

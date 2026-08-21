import { expect, test } from "bun:test";
import type { SymCrypt } from "@symcrypt/client-sdk";
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

function symcryptWithStore(openTree: () => unknown): SymCrypt {
  return {
    deviceFirst: {
      open: () => ({ containerStore: openTree() }),
    },
  } as unknown as SymCrypt;
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
    symcryptWithStore(() => fakeStore.store),
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
    symcryptWithStore(() => fakeStore.store),
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
    symcryptWithStore(() => fakeStore.store),
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
    symcryptWithStore(() => fakeStore.store),
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
    symcryptWithStore(() => fakeStore.store),
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
    symcryptWithStore(() => fakeStore.store),
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
    symcryptWithStore(() => {
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
    symcryptWithStore(() => fakeStore.store),
    ws,
    new Set(),
  );

  expect(sent).toEqual([]);
});

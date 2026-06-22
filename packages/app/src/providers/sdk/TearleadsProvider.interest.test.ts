import { expect, test } from "bun:test";
import type { Tearleads } from "@tearleads/client-sdk";
import { startContainerInterestDeclaration } from "./TearleadsProvider";

function createFakeStore(initialIds: string[]) {
  let ids = initialIds;
  const listeners = new Set<() => void>();
  return {
    setNodes(next: string[]) {
      ids = next;
      for (const listener of listeners) {
        listener();
      }
    },
    store: {
      getSnapshot: () => ({ nodes: ids.map((id) => ({ id })) }),
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  };
}

function tearleadsWithStore(openTree: () => unknown): Tearleads {
  return { containerContents: { openTree } } as unknown as Tearleads;
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

test("declares the full known set against an empty baseline, then deltas", () => {
  const fakeStore = createFakeStore(["c1", "c2"]);
  const { sent, ws } = fakeSocket(WebSocket.OPEN);

  const handle = startContainerInterestDeclaration(
    tearleadsWithStore(() => fakeStore.store),
    ws,
    new Set(),
  );

  expect(JSON.parse(sent[0] ?? "null")).toEqual({
    type: "known_containers.add",
    containerIds: ["c1", "c2"],
  });

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
  expect(sent).toEqual([]);

  handle.invalidate("b");
  // No immediate re-add; only the next tree change re-evaluates.
  expect(sent).toEqual([]);

  fakeStore.setNodes(["a", "b"]);
  expect(JSON.parse(sent[0] ?? "null")).toEqual({
    type: "known_containers.add",
    containerIds: ["b"],
  });
});

test("declares only the delta against a hydrated baseline (no full resend)", () => {
  // The server already holds {a, b}; the current tree adds c. Only c is sent.
  const fakeStore = createFakeStore(["a", "b", "c"]);
  const { sent, ws } = fakeSocket(WebSocket.OPEN);

  startContainerInterestDeclaration(
    tearleadsWithStore(() => fakeStore.store),
    ws,
    new Set(["a", "b"]),
  );

  expect(JSON.parse(sent[0] ?? "null")).toEqual({
    type: "known_containers.add",
    containerIds: ["c"],
  });
  // a and b are not re-declared.
  expect(sent).toHaveLength(1);
});

test("sends nothing when the tree already matches the baseline", () => {
  const fakeStore = createFakeStore(["a", "b"]);
  const { sent, ws } = fakeSocket(WebSocket.OPEN);

  startContainerInterestDeclaration(
    tearleadsWithStore(() => fakeStore.store),
    ws,
    new Set(["a", "b"]),
  );

  expect(sent).toEqual([]);
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

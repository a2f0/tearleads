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

test("declares known containers, then pushes add/remove deltas", () => {
  const fakeStore = createFakeStore(["c1", "c2"]);
  const { sent, ws } = fakeSocket(WebSocket.OPEN);

  const stop = startContainerInterestDeclaration(
    tearleadsWithStore(() => fakeStore.store),
    ws,
  );

  // Initial declaration is a full replace of the currently-known set.
  expect(JSON.parse(sent[0] ?? "null")).toEqual({
    type: "known_containers",
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

  stop();
  fakeStore.setNodes(["c2"]);
  // No further declarations after the subscription is stopped.
  expect(sent).toHaveLength(3);
});

test("skips interest when the container tree cannot be opened", () => {
  const { sent, ws } = fakeSocket(WebSocket.OPEN);

  const stop = startContainerInterestDeclaration(
    tearleadsWithStore(() => {
      throw new Error("runtime not ready");
    }),
    ws,
  );

  expect(sent).toEqual([]);
  expect(() => stop()).not.toThrow();
});

test("does not send while the socket is not open", () => {
  const fakeStore = createFakeStore(["c1"]);
  const { sent, ws } = fakeSocket(WebSocket.CONNECTING);

  startContainerInterestDeclaration(
    tearleadsWithStore(() => fakeStore.store),
    ws,
  );

  expect(sent).toEqual([]);
});

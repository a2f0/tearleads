import { expect, test } from "bun:test";
import { MAX_WS_INTEREST_CONTAINER_IDS } from "@tearleads/validators/realtime";
import { startContainerInterestDeclaration } from "./serverEventsBinding";
import {
  fakeSocket,
  tearleadsWithStore,
} from "./test/containerInterestHarness";

// Per-socket admission limits enforced by the realtime gateway
// (`MAX_PENDING_DECLARATIONS` / `MAX_PENDING_CONTAINER_IDS` in
// packages/api/src/realtime/containerInterestAuthorization.ts).
const SERVER_MAX_PENDING_DECLARATIONS = 32;
const SERVER_MAX_PENDING_CONTAINER_IDS = 512;
const TREE_SIZE = 25_000;

interface TreeNode {
  readonly id: string;
  readonly parentId: string | null;
  readonly rootLaneMember?: boolean | undefined;
}

function createTreeStore(initialNodes: TreeNode[]) {
  let nodes = initialNodes;
  const listeners = new Set<() => void>();
  return {
    setNodes(next: TreeNode[]) {
      nodes = next;
      for (const listener of listeners) listener();
    },
    store: {
      getSnapshot: () => ({ nodes, ready: true }),
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  };
}

test("a 25,000-folder tree under one root declares only its root-lane entries in a single frame", () => {
  const nodes: TreeNode[] = [
    { id: "root", parentId: null, rootLaneMember: true },
  ];
  for (let index = 1; index < TREE_SIZE; index++) {
    nodes.push({
      id: `folder-${index}`,
      parentId: index <= 10 ? "root" : `folder-${Math.floor((index - 1) / 10)}`,
    });
  }
  const tree = createTreeStore(nodes);
  const { sent, ws } = fakeSocket(WebSocket.OPEN);
  const handle = startContainerInterestDeclaration(
    tearleadsWithStore(() => tree.store),
    ws,
  );
  expect(sent).toHaveLength(1);
  const initial = JSON.parse(sent[0] ?? "null") as {
    type: string;
    declarationId: string;
    containerIds: string[];
  };
  expect(initial).toMatchObject({
    type: "known_containers",
    containerIds: ["root"],
  });
  expect(initial.containerIds.length).toBeLessThanOrEqual(
    SERVER_MAX_PENDING_CONTAINER_IDS,
  );
  expect(handle.acknowledge(initial.declarationId, ["root"])).toBe(true);

  // Adding ordinary child folders emits zero websocket frames; adding a new
  // directly granted root-lane folder emits one small `.add` delta.
  tree.setNodes([...nodes, { id: "child-ordinary", parentId: "folder-1" }]);
  expect(sent).toHaveLength(1);

  tree.setNodes([
    ...nodes,
    { id: "child-ordinary", parentId: "folder-1" },
    { id: "shared-root", parentId: "external-parent", rootLaneMember: true },
  ]);
  expect(sent).toHaveLength(2);
  expect(JSON.parse(sent[1] ?? "null")).toMatchObject({
    type: "known_containers.add",
    containerIds: ["shared-root"],
  });
  handle.stop();
});

test("more than MAX_WS_INTEREST_CONTAINER_IDS roots stay within server frame and pending caps", () => {
  const roots: TreeNode[] = Array.from(
    { length: MAX_WS_INTEREST_CONTAINER_IDS + 50 },
    (_, index) => ({
      id: `root-${index}`,
      parentId: null,
      rootLaneMember: true,
    }),
  );
  const tree = createTreeStore(roots);
  const { sent, ws } = fakeSocket(WebSocket.OPEN);
  const handle = startContainerInterestDeclaration(
    tearleadsWithStore(() => tree.store),
    ws,
  );
  expect(sent).toHaveLength(1);
  expect(sent.length).toBeLessThanOrEqual(SERVER_MAX_PENDING_DECLARATIONS);
  const initial = JSON.parse(sent[0] ?? "null") as {
    type: string;
    declarationId: string;
    containerIds: string[];
  };
  expect(initial.type).toBe("known_containers");
  expect(initial.containerIds).toHaveLength(MAX_WS_INTEREST_CONTAINER_IDS);
  expect(initial.containerIds.length).toBeLessThanOrEqual(
    SERVER_MAX_PENDING_CONTAINER_IDS,
  );
  expect(handle.acknowledge(initial.declarationId, initial.containerIds)).toBe(
    true,
  );
  handle.stop();
});

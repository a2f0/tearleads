import { expect, test } from "bun:test";
import { createRealtimeGateway } from "./realtimeGateway";

type GatewaySocket = Parameters<
  ReturnType<typeof createRealtimeGateway>["websocket"]["open"]
>[0];

function createTestSocket(userId: string, sessionId: string) {
  const frames: Record<string, unknown>[] = [];
  const ws: GatewaySocket = {
    close: () => undefined,
    data: { sessionId, userId },
    send: (raw: string) => {
      frames.push(JSON.parse(raw) as Record<string, unknown>);
    },
  };
  return { frames, ws };
}

async function declareRoots(
  gateway: ReturnType<typeof createRealtimeGateway>,
  ws: GatewaySocket,
  containerIds: readonly string[],
) {
  gateway.websocket.open(ws);
  await gateway.websocket.message(
    ws,
    JSON.stringify({
      containerIds,
      declarationId: `decl-${ws.data.sessionId}`,
      type: "known_containers",
    }),
  );
}

const ROOT_A = "10000000-0000-4000-8000-000000000001";
const ROOT_B = "10000000-0000-4000-8000-000000000002";
const ROOT_C = "10000000-0000-4000-8000-000000000003";
const PARENT_A = "20000000-0000-4000-8000-000000000001";
const PARENT_B = "20000000-0000-4000-8000-000000000002";
const FOLDER_X = "30000000-0000-4000-8000-000000000001";

test("security 8: delayed non-move mutation with stale previousParentId does not leak to old parent/root", async () => {
  let clock = 1_000;
  const gateway = createRealtimeGateway({
    authorizeContainerAccess: async (_userId, ids) =>
      ids.map((id) => ({
        containerId: id,
        pathContainerIds: [id],
        principalKeys: [],
      })),
    revalidation: { intervalMs: 0, now: () => clock },
    subscribe: () => () => undefined,
    subscribeReconnect: () => () => undefined,
  });
  const oldRoot = createTestSocket("u-old-root", "s-old-root");
  const oldParent = createTestSocket("u-old-parent", "s-old-parent");
  const newRoot = createTestSocket("u-new-root", "s-new-root");
  await declareRoots(gateway, oldRoot.ws, [ROOT_A]);
  await declareRoots(gateway, oldParent.ws, [PARENT_A]);
  await declareRoots(gateway, newRoot.ws, [ROOT_B]);

  await gateway.publish(
    JSON.stringify({
      ancestorIds: [ROOT_B],
      containerId: FOLDER_X,
      eventType: "container.move",
      parentId: ROOT_B,
      previousAncestorIds: [ROOT_A, PARENT_A],
      previousParentId: PARENT_A,
      type: "container_mutation_created",
      updatedAt: "2026-01-01T00:00:10.000Z",
    }),
  );
  oldRoot.frames.length = 0;
  oldParent.frames.length = 0;
  newRoot.frames.length = 0;

  clock += 1_000;
  // Synthetic delayed rekey still carrying stale previousParentId = PARENT_A.
  await gateway.publish(
    JSON.stringify({
      ancestorIds: [ROOT_A, PARENT_A],
      containerId: FOLDER_X,
      eventType: "container.rekey",
      parentId: PARENT_A,
      previousParentId: PARENT_A,
      type: "container_mutation_created",
      updatedAt: "2026-01-01T00:00:09.000Z",
    }),
  );

  expect(oldRoot.frames).toEqual([]);
  expect(oldParent.frames).toEqual([]);
  expect(newRoot.frames).toEqual([
    {
      containerId: FOLDER_X,
      eventType: "container.rekey",
      parentId: ROOT_B,
      type: "container_mutation_created",
      updatedAt: "2026-01-01T00:00:09.000Z",
    },
  ]);
  gateway.stop();
});

test("security 9: move whose source parent already moved away does not leak to old root via stale previousAncestorIds", async () => {
  let clock = 1_000;
  const gateway = createRealtimeGateway({
    authorizeContainerAccess: async (_userId, ids) =>
      ids.map((id) => ({
        containerId: id,
        pathContainerIds: [id],
        principalKeys: [],
      })),
    revalidation: { intervalMs: 0, now: () => clock },
    subscribe: () => () => undefined,
    subscribeReconnect: () => () => undefined,
  });
  const oldRoot = createTestSocket("u-old-root", "s-old-root");
  const newSourceRoot = createTestSocket("u-new-src", "s-new-src");
  const destRoot = createTestSocket("u-dest", "s-dest");
  await declareRoots(gateway, oldRoot.ws, [ROOT_A]);
  await declareRoots(gateway, newSourceRoot.ws, [ROOT_C]);
  await declareRoots(gateway, destRoot.ws, [ROOT_B]);

  // T2: PARENT_A moves out of ROOT_A into ROOT_C and arrives at the hub first.
  await gateway.publish(
    JSON.stringify({
      ancestorIds: [ROOT_C],
      containerId: PARENT_A,
      eventType: "container.move",
      parentId: ROOT_C,
      previousAncestorIds: [ROOT_A],
      previousParentId: ROOT_A,
      type: "container_mutation_created",
      updatedAt: "2026-01-01T00:00:12.000Z",
    }),
  );
  oldRoot.frames.length = 0;
  newSourceRoot.frames.length = 0;
  destRoot.frames.length = 0;

  clock += 1_000;
  // T1 (delayed): FOLDER_X moved from [ROOT_A, PARENT_A] to [ROOT_B, PARENT_B].
  // Because PARENT_A already left ROOT_A, oldRoot must receive NOTHING.
  await gateway.publish(
    JSON.stringify({
      ancestorIds: [ROOT_B, PARENT_B],
      containerId: FOLDER_X,
      eventType: "container.move",
      parentId: PARENT_B,
      previousAncestorIds: [ROOT_A, PARENT_A],
      previousParentId: PARENT_A,
      type: "container_mutation_created",
      updatedAt: "2026-01-01T00:00:11.000Z",
    }),
  );

  expect(oldRoot.frames).toEqual([]);
  expect(newSourceRoot.frames).toEqual([
    { containerIds: [PARENT_A], type: "container_children_changed" },
  ]);
  expect(destRoot.frames).toEqual([
    {
      containerId: FOLDER_X,
      eventType: "container.move",
      parentId: PARENT_B,
      type: "container_mutation_created",
      updatedAt: "2026-01-01T00:00:11.000Z",
    },
  ]);
  gateway.stop();
});

test("security 10: container_deleted fails closed if remembered move leaves empty ancestors", async () => {
  let clock = 1_000;
  const gateway = createRealtimeGateway({
    authorizeContainerAccess: async (_userId, ids) =>
      ids.map((id) => ({
        containerId: id,
        pathContainerIds: [id],
        principalKeys: [],
      })),
    revalidation: { intervalMs: 0, now: () => clock },
    subscribe: () => () => undefined,
    subscribeReconnect: () => () => undefined,
  });
  const oldParent = createTestSocket("u-old-parent", "s-old-parent");
  await declareRoots(gateway, oldParent.ws, [PARENT_A]);

  // Remember a move to root (empty ancestors) for FOLDER_X.
  await gateway.publish(
    JSON.stringify({
      ancestorIds: [],
      containerId: FOLDER_X,
      eventType: "container.move",
      parentId: null,
      previousAncestorIds: [ROOT_A, PARENT_A],
      previousParentId: PARENT_A,
      type: "container_mutation_created",
      updatedAt: "2026-01-01T00:00:10.000Z",
    }),
  );
  oldParent.frames.length = 0;

  clock += 1_000;
  await gateway.publish(
    JSON.stringify({
      ancestorIds: [ROOT_A, PARENT_A],
      containerId: FOLDER_X,
      parentId: PARENT_A,
      type: "container_deleted",
    }),
  );

  expect(oldParent.frames).toEqual([]);
  gateway.stop();
});

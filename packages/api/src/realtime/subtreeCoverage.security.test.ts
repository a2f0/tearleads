import { expect, test } from "bun:test";
import { createRealtimeGateway } from "./realtimeGateway";
import type { GatewaySocket } from "./wsConnection";

const ROOT_A = "11111111-1111-4111-8111-111111111111";
const ROOT_B = "22222222-2222-4222-8222-222222222222";
const PARENT_A = "33333333-3333-4333-8333-333333333333";
const FOLDER_X = "44444444-4444-4444-8444-444444444444";
const DESCENDANT_D = "55555555-5555-4555-8555-555555555555";
const DIRECT_G = "66666666-6666-4666-8666-666666666666";
const DOC_1 = "77777777-7777-4777-8777-777777777777";
const NOW = "2026-01-01T00:00:10.000Z";

function createTestSocket(userId: string, sessionId: string) {
  const frames: Record<string, unknown>[] = [];
  const ws: GatewaySocket = {
    close: () => undefined,
    data: { sessionId, userId },
    send: (raw) => {
      frames.push(JSON.parse(raw) as Record<string, unknown>);
    },
  };
  return { frames, ws };
}

async function declareRoots(
  gateway: ReturnType<typeof createRealtimeGateway>,
  ws: GatewaySocket,
  containerIds: string[],
) {
  await gateway.websocket.message(
    ws,
    JSON.stringify({
      containerIds,
      declarationId: `decl-${crypto.randomUUID()}`,
      type: "known_containers",
    }),
  );
}

test("security 1: hint after move out of coverage does not reach old root socket", async () => {
  const gateway = createRealtimeGateway({
    authorizeContainerAccess: async (_userId, ids) =>
      ids.map((id) => ({
        containerId: id,
        pathContainerIds: [id],
        principalKeys: [],
      })),
    subscribe: () => () => undefined,
    subscribeReconnect: () => () => undefined,
  });
  const oldWatcher = createTestSocket("user-old", "sess-old");
  const newWatcher = createTestSocket("user-new", "sess-new");
  gateway.websocket.open(oldWatcher.ws);
  gateway.websocket.open(newWatcher.ws);
  await declareRoots(gateway, oldWatcher.ws, [ROOT_A]);
  await declareRoots(gateway, newWatcher.ws, [ROOT_B]);
  oldWatcher.frames.length = 0;
  newWatcher.frames.length = 0;

  // Move FOLDER_X from [ROOT_A, PARENT_A] -> [ROOT_B].
  await gateway.publish(
    JSON.stringify({
      ancestorIds: [ROOT_B],
      containerId: FOLDER_X,
      eventType: "container.move",
      parentId: ROOT_B,
      previousAncestorIds: [ROOT_A, PARENT_A],
      previousParentId: PARENT_A,
      type: "container_mutation_created",
      updatedAt: NOW,
    }),
  );
  expect(oldWatcher.frames).toEqual([
    { containerIds: [PARENT_A], type: "container_children_changed" },
  ]);
  expect(newWatcher.frames).toEqual([
    {
      containerId: FOLDER_X,
      eventType: "container.move",
      parentId: ROOT_B,
      type: "container_mutation_created",
      updatedAt: NOW,
    },
  ]);
  oldWatcher.frames.length = 0;
  newWatcher.frames.length = 0;

  // Subsequent document update under DESCENDANT_D at the new path.
  await gateway.publish(
    JSON.stringify({
      containerIds: [DESCENDANT_D],
      containerPaths: { [DESCENDANT_D]: [ROOT_B, FOLDER_X, DESCENDANT_D] },
      documentId: DOC_1,
      type: "document_update_created",
      updateIds: ["u-1"],
    }),
  );
  expect(oldWatcher.frames).toEqual([]);
  expect(newWatcher.frames).toEqual([
    {
      containerIds: [DESCENDANT_D],
      documentId: DOC_1,
      type: "document_update_created",
      updateIds: ["u-1"],
    },
  ]);
  gateway.stop();
});

test("security 2: stale-path hint arriving after move is blocked from old root and old parent", async () => {
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
  const oldRoot = createTestSocket("user-old-root", "sess-old-root");
  const oldParent = createTestSocket("user-old-parent", "sess-old-parent");
  const newRoot = createTestSocket("user-new-root", "sess-new-root");
  gateway.websocket.open(oldRoot.ws);
  gateway.websocket.open(oldParent.ws);
  gateway.websocket.open(newRoot.ws);
  await declareRoots(gateway, oldRoot.ws, [ROOT_A]);
  await declareRoots(gateway, oldParent.ws, [PARENT_A]);
  await declareRoots(gateway, newRoot.ws, [ROOT_B]);
  oldRoot.frames.length = 0;
  oldParent.frames.length = 0;
  newRoot.frames.length = 0;

  // Move FOLDER_X out of [ROOT_A, PARENT_A] to [ROOT_B].
  await gateway.publish(
    JSON.stringify({
      ancestorIds: [ROOT_B],
      containerId: FOLDER_X,
      eventType: "container.move",
      parentId: ROOT_B,
      previousAncestorIds: [ROOT_A, PARENT_A],
      previousParentId: PARENT_A,
      type: "container_mutation_created",
      updatedAt: NOW,
    }),
  );
  oldRoot.frames.length = 0;
  oldParent.frames.length = 0;
  newRoot.frames.length = 0;

  clock += 5_000;
  // Stale document hint for DESCENDANT_D carrying pre-move path [ROOT_A, PARENT_A, FOLDER_X, DESCENDANT_D].
  await gateway.publish(
    JSON.stringify({
      containerIds: [DESCENDANT_D],
      containerPaths: {
        [DESCENDANT_D]: [ROOT_A, PARENT_A, FOLDER_X, DESCENDANT_D],
      },
      documentId: DOC_1,
      type: "document_update_created",
      updateIds: ["u-stale"],
    }),
  );
  // Stale container mutation for FOLDER_X carrying pre-move parentId & ancestorIds.
  await gateway.publish(
    JSON.stringify({
      ancestorIds: [ROOT_A, PARENT_A],
      containerId: FOLDER_X,
      eventType: "container.rekey",
      parentId: PARENT_A,
      type: "container_mutation_created",
      updatedAt: "2026-01-01T00:00:09.000Z",
    }),
  );

  expect(oldRoot.frames).toEqual([]);
  expect(oldParent.frames).toEqual([]);
  expect(newRoot.frames).toEqual([
    {
      containerIds: [DESCENDANT_D],
      documentId: DOC_1,
      type: "document_update_created",
      updateIds: ["u-stale"],
    },
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

test("security 3: hint after root grant revocation is not delivered to revoked socket", async () => {
  const gateway = createRealtimeGateway({
    authorizeContainerAccess: async (_userId, ids) =>
      ids.map((id) => ({
        containerId: id,
        pathContainerIds: [ROOT_A, id],
        principalKeys: [],
      })),
    subscribe: () => () => undefined,
    subscribeReconnect: () => () => undefined,
  });
  const watcher = createTestSocket("user-revoked", "sess-revoked");
  gateway.websocket.open(watcher.ws);
  await declareRoots(gateway, watcher.ws, [PARENT_A]);
  watcher.frames.length = 0;

  await gateway.publish(
    JSON.stringify({ containerId: ROOT_A, type: "access_changed" }),
  );
  expect(watcher.frames).toEqual([
    { containerIds: [PARENT_A], type: "resync_required" },
  ]);
  watcher.frames.length = 0;

  await gateway.publish(
    JSON.stringify({
      containerIds: [DESCENDANT_D],
      containerPaths: { [DESCENDANT_D]: [ROOT_A, PARENT_A, DESCENDANT_D] },
      documentId: DOC_1,
      type: "document_update_created",
      updateIds: ["u-after-revoke"],
    }),
  );
  expect(watcher.frames).toEqual([]);
  gateway.stop();
});

test("security 4: hint to socket whose root proof aged out is not delivered", async () => {
  let clock = 1_000;
  const timers: Array<{ readonly run: () => void; readonly at: number }> = [];
  const gateway = createRealtimeGateway({
    authorizeContainerAccess: async (_userId, ids) =>
      ids.map((id) => ({
        containerId: id,
        pathContainerIds: [id],
        principalKeys: [],
      })),
    revalidation: {
      intervalMs: 1_000,
      maxProofAgeMs: 3_000,
      now: () => clock,
      random: () => 0,
      schedule: (run, delayMs) => {
        const entry = { at: clock + delayMs, run };
        timers.push(entry);
        return () => {
          const index = timers.indexOf(entry);
          if (index >= 0) timers.splice(index, 1);
        };
      },
    },
    subscribe: () => () => undefined,
    subscribeReconnect: () => () => undefined,
  });
  const watcher = createTestSocket("user-stale-proof", "sess-stale-proof");
  gateway.websocket.open(watcher.ws);
  await declareRoots(gateway, watcher.ws, [ROOT_A]);
  watcher.frames.length = 0;

  // Advance wall clock past maxProofAgeMs and fire due proof deadline timers.
  clock += 3_500;
  for (const timer of [...timers].filter((entry) => entry.at <= clock)) {
    timer.run();
  }
  expect(watcher.frames).toContainEqual({
    containerIds: [ROOT_A],
    type: "resync_required",
  });
  watcher.frames.length = 0;

  await gateway.publish(
    JSON.stringify({
      containerIds: [DESCENDANT_D],
      containerPaths: { [DESCENDANT_D]: [ROOT_A, DESCENDANT_D] },
      documentId: DOC_1,
      type: "document_update_created",
      updateIds: ["u-after-expiry"],
    }),
  );
  expect(watcher.frames).toEqual([]);
  gateway.stop();
});

test("security 5: event with no path fails closed to direct holds only", async () => {
  const gateway = createRealtimeGateway({
    authorizeContainerAccess: async (_userId, ids) =>
      ids.map((id) => ({
        containerId: id,
        pathContainerIds: [id],
        principalKeys: [],
      })),
    subscribe: () => () => undefined,
    subscribeReconnect: () => () => undefined,
  });
  const rootOnly = createTestSocket("user-root", "sess-root");
  const directHolder = createTestSocket("user-direct", "sess-direct");
  gateway.websocket.open(rootOnly.ws);
  gateway.websocket.open(directHolder.ws);
  await declareRoots(gateway, rootOnly.ws, [ROOT_A]);
  await declareRoots(gateway, directHolder.ws, [DESCENDANT_D]);
  rootOnly.frames.length = 0;
  directHolder.frames.length = 0;

  // Document hint without `containerPaths`.
  await gateway.publish(
    JSON.stringify({
      containerIds: [DESCENDANT_D],
      documentId: DOC_1,
      type: "document_update_created",
      updateIds: ["u-no-path"],
    }),
  );
  // Container mutation without `ancestorIds`.
  await gateway.publish(
    JSON.stringify({
      containerId: DESCENDANT_D,
      eventType: "container.rekey",
      parentId: FOLDER_X,
      type: "container_mutation_created",
      updatedAt: NOW,
    }),
  );

  expect(rootOnly.frames).toEqual([]);
  expect(directHolder.frames).toEqual([
    {
      containerIds: [DESCENDANT_D],
      documentId: DOC_1,
      type: "document_update_created",
      updateIds: ["u-no-path"],
    },
    {
      containerId: DESCENDANT_D,
      eventType: "container.rekey",
      type: "container_mutation_created",
      updatedAt: NOW,
    },
  ]);
  gateway.stop();
});

test("security 6: nested directly granted folder stays covered after its parent moves out of outer root", async () => {
  let parentMovedOut = false;
  const gateway = createRealtimeGateway({
    authorizeContainerAccess: async (_userId, ids) =>
      ids.map((id) => {
        if (id === DIRECT_G) {
          return {
            containerId: DIRECT_G,
            pathContainerIds: parentMovedOut
              ? [ROOT_B, FOLDER_X, DIRECT_G]
              : [ROOT_A, FOLDER_X, DIRECT_G],
            principalKeys: [],
          };
        }
        return {
          containerId: id,
          pathContainerIds: [id],
          principalKeys: [],
        };
      }),
    subscribe: () => () => undefined,
    subscribeReconnect: () => () => undefined,
  });
  const watcher = createTestSocket("user-nested", "sess-nested");
  gateway.websocket.open(watcher.ws);
  // Client declares both outer root ROOT_A and nested directly granted root DIRECT_G.
  await declareRoots(gateway, watcher.ws, [ROOT_A, DIRECT_G]);
  watcher.frames.length = 0;

  // FOLDER_X (parent of DIRECT_G) moves from ROOT_A to ROOT_B.
  // access_changed(FOLDER_X) evicts DIRECT_G (whose proof path cited FOLDER_X),
  // leaving ROOT_A intact; client re-declares [ROOT_A, DIRECT_G] cleanly.
  parentMovedOut = true;
  await gateway.publish(
    JSON.stringify({ containerId: FOLDER_X, type: "access_changed" }),
  );
  await gateway.publish(
    JSON.stringify({
      ancestorIds: [ROOT_B],
      containerId: FOLDER_X,
      eventType: "container.move",
      parentId: ROOT_B,
      previousAncestorIds: [ROOT_A],
      previousParentId: ROOT_A,
      type: "container_mutation_created",
      updatedAt: NOW,
    }),
  );
  expect(watcher.frames).toEqual([
    { containerIds: [DIRECT_G], type: "resync_required" },
    { containerIds: [ROOT_A], type: "container_children_changed" },
  ]);
  watcher.frames.length = 0;

  // Client re-declares after resync_required; DIRECT_G re-authorizes at new path.
  await declareRoots(gateway, watcher.ws, [ROOT_A, DIRECT_G]);
  watcher.frames.length = 0;

  // Descendant under DIRECT_G is STILL covered through DIRECT_G without learning ROOT_B or FOLDER_X.
  await gateway.publish(
    JSON.stringify({
      containerIds: [DESCENDANT_D],
      containerPaths: {
        [DESCENDANT_D]: [ROOT_B, FOLDER_X, DIRECT_G, DESCENDANT_D],
      },
      documentId: DOC_1,
      type: "document_update_created",
      updateIds: ["u-nested-ok"],
    }),
  );
  expect(watcher.frames).toEqual([
    {
      containerIds: [DESCENDANT_D],
      documentId: DOC_1,
      type: "document_update_created",
      updateIds: ["u-nested-ok"],
    },
  ]);
  // Verify server-only routing metadata never leaks onto the socket.
  expect(watcher.frames[0]).not.toHaveProperty("containerPaths");
  expect(watcher.frames[0]).not.toHaveProperty("origin");
  gateway.stop();
});

test("container_deleted delivers container_children_changed to ancestor root without revealing parent to evicted child holder", async () => {
  const gateway = createRealtimeGateway({
    authorizeContainerAccess: async (_userId, ids) =>
      ids.map((id) => ({
        containerId: id,
        pathContainerIds: id === FOLDER_X ? [ROOT_A, PARENT_A, FOLDER_X] : [id],
        principalKeys: [],
      })),
    subscribe: () => () => undefined,
    subscribeReconnect: () => () => undefined,
  });
  const rootWatcher = createTestSocket("user-root", "sess-root");
  const childOnlyWatcher = createTestSocket("user-child", "sess-child");
  gateway.websocket.open(rootWatcher.ws);
  gateway.websocket.open(childOnlyWatcher.ws);
  await declareRoots(gateway, rootWatcher.ws, [ROOT_A]);
  await declareRoots(gateway, childOnlyWatcher.ws, [FOLDER_X]);
  rootWatcher.frames.length = 0;
  childOnlyWatcher.frames.length = 0;

  await gateway.publish(
    JSON.stringify({ containerId: FOLDER_X, type: "access_changed" }),
  );
  await gateway.publish(
    JSON.stringify({
      ancestorIds: [ROOT_A, PARENT_A],
      containerId: FOLDER_X,
      parentId: PARENT_A,
      type: "container_deleted",
    }),
  );

  expect(rootWatcher.frames).toEqual([
    { containerIds: [PARENT_A], type: "container_children_changed" },
  ]);
  expect(childOnlyWatcher.frames).toEqual([
    { containerIds: [FOLDER_X], type: "resync_required" },
  ]);
  gateway.stop();
});

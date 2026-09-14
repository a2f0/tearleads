import { expect, test } from "bun:test";
import { MAX_WS_INTEREST_CONTAINER_IDS } from "@tearleads/validators/realtime";
import { startContainerInterestDeclaration } from "./serverEventsBinding";
import {
  createFakeStore,
  fakeSocket,
  tearleadsWithStore,
} from "./test/containerInterestHarness";

// Per-socket admission limits enforced by the realtime gateway
// (`MAX_PENDING_DECLARATIONS` / `MAX_PENDING_CONTAINER_IDS` in
// packages/api/src/realtime/containerInterestAuthorization.ts); overflow closes
// the socket with 1013, so the client must never have this much outstanding.
const SERVER_MAX_PENDING_DECLARATIONS = 32;
const SERVER_MAX_PENDING_CONTAINER_IDS = 20_000;
const TREE_SIZE = 25_000;

interface Frame {
  readonly type: string;
  readonly declarationId: string;
  readonly containerIds: string[];
}

/** Mirror the gateway's pending counters over the frames a socket has sent. */
function pendingServerSide(sent: readonly string[]) {
  const pending = new Map<string, Frame>();
  let peakDeclarations = 0;
  let peakIds = 0;
  let seen = 0;
  const observe = (): void => {
    for (const raw of sent.slice(seen)) {
      const frame = JSON.parse(raw) as Frame;
      pending.set(frame.declarationId, frame);
    }
    seen = sent.length;
    peakDeclarations = Math.max(peakDeclarations, pending.size);
    peakIds = Math.max(
      peakIds,
      [...pending.values()].reduce(
        (total, frame) => total + frame.containerIds.length,
        0,
      ),
    );
  };
  return {
    observe,
    /** Process the oldest pending frame the way the gateway's queue would. */
    acknowledgeOldest(): Frame {
      observe();
      const [oldest] = pending.values();
      if (!oldest) throw new Error("nothing pending server-side");
      pending.delete(oldest.declarationId);
      return oldest;
    },
    get peakDeclarations() {
      return peakDeclarations;
    },
    get peakIds() {
      return peakIds;
    },
    get size() {
      return pending.size;
    },
  };
}

function bigTree(prefix: string, length = TREE_SIZE): string[] {
  return Array.from({ length }, (_, index) => `${prefix}-${index}`);
}

test("a 25,000-id tree is declared one acknowledged chunk at a time within the server's pending limits", () => {
  const ids = bigTree("container");
  const fakeStore = createFakeStore(ids);
  const { sent, ws } = fakeSocket(WebSocket.OPEN);
  const server = pendingServerSide(sent);
  const handle = startContainerInterestDeclaration(
    tearleadsWithStore(() => fakeStore.store),
    ws,
    new Set(),
  );
  server.observe();
  // Only the first chunk leaves before any acknowledgment.
  expect(sent).toHaveLength(1);
  expect(server.size).toBe(1);

  const first = server.acknowledgeOldest();
  expect(first.type).toBe("known_containers");
  expect(first.containerIds).toHaveLength(MAX_WS_INTEREST_CONTAINER_IDS);
  expect(handle.acknowledge(first.declarationId, first.containerIds)).toBe(
    false,
  );
  server.observe();
  expect(sent).toHaveLength(2);

  const second = server.acknowledgeOldest();
  expect(second.type).toBe("known_containers.add");
  expect(second.containerIds).toHaveLength(MAX_WS_INTEREST_CONTAINER_IDS);
  expect(handle.acknowledge(second.declarationId, second.containerIds)).toBe(
    false,
  );
  server.observe();
  expect(sent).toHaveLength(3);

  const third = server.acknowledgeOldest();
  expect(third.type).toBe("known_containers.add");
  expect(third.containerIds).toHaveLength(
    TREE_SIZE - 2 * MAX_WS_INTEREST_CONTAINER_IDS,
  );
  // The barrier clears only once the last chunk is acknowledged.
  expect(handle.acknowledge(third.declarationId, third.containerIds)).toBe(
    true,
  );
  server.observe();
  expect(sent).toHaveLength(3);
  expect(server.size).toBe(0);

  expect(server.peakDeclarations).toBe(1);
  expect(server.peakDeclarations).toBeLessThanOrEqual(
    SERVER_MAX_PENDING_DECLARATIONS,
  );
  expect(server.peakIds).toBe(MAX_WS_INTEREST_CONTAINER_IDS);
  expect(server.peakIds).toBeLessThanOrEqual(SERVER_MAX_PENDING_CONTAINER_IDS);
  expect([first, second, third].flatMap((frame) => frame.containerIds)).toEqual(
    ids,
  );

  // Past the barrier the connection carries deltas, not another full replace.
  fakeStore.setNodes([...ids, "late"]);
  expect(JSON.parse(sent[3] ?? "null")).toMatchObject({
    type: "known_containers.add",
    containerIds: ["late"],
  });
  handle.stop();
});

test("a tree change while chunks are still paced waits for the barrier and sends one delta", () => {
  const ids = bigTree("container");
  const fakeStore = createFakeStore(ids);
  const { sent, ws } = fakeSocket(WebSocket.OPEN);
  const server = pendingServerSide(sent);
  const handle = startContainerInterestDeclaration(
    tearleadsWithStore(() => fakeStore.store),
    ws,
    new Set(),
  );
  const grown = [...ids, ...bigTree("grown", 3)];
  fakeStore.setNodes(grown);
  fakeStore.setNodes(grown);
  expect(sent).toHaveLength(1);

  let frame = server.acknowledgeOldest();
  while (!handle.acknowledge(frame.declarationId, frame.containerIds)) {
    frame = server.acknowledgeOldest();
  }
  expect(server.peakDeclarations).toBe(1);
  expect(server.peakIds).toBe(MAX_WS_INTEREST_CONTAINER_IDS);
  expect(sent).toHaveLength(4);
  expect(JSON.parse(sent[3] ?? "null")).toMatchObject({
    type: "known_containers.add",
    containerIds: bigTree("grown", 3),
  });
  handle.stop();
});

test("stopping a paced declaration drops its unsent chunks", () => {
  const fakeStore = createFakeStore(bigTree("container"));
  const { sent, ws } = fakeSocket(WebSocket.OPEN);
  const handle = startContainerInterestDeclaration(
    tearleadsWithStore(() => fakeStore.store),
    ws,
    new Set(),
  );
  const first = JSON.parse(sent[0] ?? "null") as Frame;
  handle.stop();
  expect(handle.acknowledge(first.declarationId, first.containerIds)).toBe(
    false,
  );
  expect(sent).toHaveLength(1);
});

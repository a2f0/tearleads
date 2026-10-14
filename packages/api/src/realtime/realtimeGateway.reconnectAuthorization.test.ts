import { expect, test } from "bun:test";
import {
  CONTAINER,
  fixture,
  OTHER,
} from "../../test/helpers/realtimeContainerAuthorization";

test("a reconnecting socket starts empty and its declaration reauthorizes", async () => {
  let calls = 0;
  const f = fixture({
    authorize: async (_user, ids) => {
      calls++;
      return ids;
    },
  });
  f.gateway.websocket.open(f.socket);
  await f.declare("known_containers", [CONTAINER, OTHER]);
  expect(calls).toBe(1);
  f.gateway.websocket.close(f.socket);
  // A new socket of the same session inherits nothing from the old one.
  const reconnected = { ...f.socket };
  f.gateway.websocket.open(reconnected);
  expect(f.router.interestedSocketCount(CONTAINER)).toBe(0);
  expect(f.router.interestedSocketCount(OTHER)).toBe(0);
  expect(calls).toBe(1);
  await f.declare("known_containers", [CONTAINER], reconnected);
  expect(calls).toBe(2);
  expect(f.router.interestedSocketCount(CONTAINER)).toBe(1);
  expect(f.router.interestedSocketCount(OTHER)).toBe(0);
  f.gateway.stop();
});

test("a revocation observed before the declaration is never installed", async () => {
  let calls = 0;
  const f = fixture({
    authorize: async () => (++calls === 1 ? [] : [CONTAINER]),
  });
  f.gateway.websocket.open(f.socket);
  f.publish({ type: "access_changed", containerId: CONTAINER });
  await f.declare("known_containers");
  expect(calls).toBe(1);
  expect(f.router.interestedSocketCount(CONTAINER)).toBe(0);
  expect(f.sent.at(-1)).toEqual({
    type: "known_containers_ack",
    declarationId: "declaration",
    containerIds: [],
  });
  f.gateway.stop();
});

test("large declarations receive a proportional signed-verification budget", async () => {
  const ids = Array.from({ length: 1000 }, () => crypto.randomUUID());
  const f = fixture({
    timeoutMs: 50,
    authorize: async (_user, requested) => {
      await new Promise((resolve) => setTimeout(resolve, 75));
      return requested;
    },
  });
  f.gateway.websocket.open(f.socket);
  await f.declare("known_containers", ids);
  expect(f.closed).toEqual([]);
  expect(f.sent.at(-1)).toMatchObject({ containerIds: ids });
  expect(f.router.interestedSocketCount(ids[0] ?? "")).toBe(1);
  f.gateway.stop();
});

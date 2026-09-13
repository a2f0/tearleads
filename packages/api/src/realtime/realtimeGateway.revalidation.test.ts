import { expect, spyOn, test } from "bun:test";
import {
  CONTAINER,
  fixture,
  OTHER,
} from "../../test/helpers/realtimeContainerAuthorization";
import * as sentry from "../diagnostics/sentry";

function resyncFrames(sent: ReadonlyArray<Record<string, unknown>>) {
  return sent.filter(
    (frame) => Reflect.get(frame, "type") === "resync_required",
  );
}

test("periodic revalidation evicts a subscription the workflow no longer grants", async () => {
  let readable = new Set([CONTAINER, OTHER]);
  const revalidated = Promise.withResolvers<string[]>();
  let calls = 0;
  const f = fixture({
    revalidation: { intervalMs: 4, random: () => 0 },
    authorize: async (_user, ids) => {
      calls++;
      const granted = ids.filter((id) => readable.has(id));
      if (calls === 2) revalidated.resolve(ids);
      return granted;
    },
  });
  await f.gateway.websocket.open(f.socket);
  await f.declare("known_containers", [CONTAINER, OTHER]);
  readable = new Set([OTHER]);
  expect([...(await revalidated.promise)].sort()).toEqual([CONTAINER, OTHER]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(f.router.interestedSocketCount(CONTAINER)).toBe(0);
  expect(f.router.interestedSocketCount(OTHER)).toBe(1);
  expect(resyncFrames(f.sent)).toEqual([
    { type: "resync_required", containerIds: [CONTAINER] },
  ]);
  expect(f.persisted).toContainEqual({
    kind: "remove",
    containerIds: [CONTAINER],
  });
  expect(f.closed).toEqual([]);
  f.gateway.stop();
});

test("revalidation leaves a still-authorized subscription silent and re-arms", async () => {
  const ticks: number[] = [];
  const third = Promise.withResolvers<void>();
  const f = fixture({
    revalidation: { intervalMs: 4, random: () => 0 },
    authorize: async (_user, ids) => {
      ticks.push(Date.now());
      if (ticks.length === 3) third.resolve();
      return ids;
    },
  });
  await f.gateway.websocket.open(f.socket);
  await f.declare();
  await third.promise;
  expect(f.router.interestedSocketCount(CONTAINER)).toBe(1);
  expect(resyncFrames(f.sent)).toEqual([]);
  f.gateway.stop();
});

test("closing a socket stops its revalidation", async () => {
  let calls = 0;
  const f = fixture({
    revalidation: { intervalMs: 2, random: () => 0 },
    authorize: async (_user, ids) => {
      calls++;
      return ids;
    },
  });
  await f.gateway.websocket.open(f.socket);
  await f.declare();
  f.gateway.websocket.close(f.socket);
  const after = calls;
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(calls).toBe(after);
  f.gateway.stop();
});

test("a revalidation failure keeps the socket and retries next interval", async () => {
  const capture = spyOn(sentry, "captureApiError").mockImplementation(
    () => undefined,
  );
  const retried = Promise.withResolvers<void>();
  let calls = 0;
  const f = fixture({
    revalidation: { intervalMs: 4, random: () => 0 },
    authorize: async (_user, ids) => {
      calls++;
      if (calls === 2) throw new Error("authorization database unavailable");
      if (calls === 3) retried.resolve();
      return ids;
    },
  });
  try {
    await f.gateway.websocket.open(f.socket);
    await f.declare();
    await retried.promise;
    expect(f.closed).toEqual([]);
    expect(f.router.interestedSocketCount(CONTAINER)).toBe(1);
    expect(capture).toHaveBeenCalled();
  } finally {
    capture.mockRestore();
    f.gateway.stop();
  }
});

test("a pub/sub reconnect re-verifies every live socket and resyncs all it holds", async () => {
  let readable = new Set([CONTAINER, OTHER]);
  const requested: string[][] = [];
  const f = fixture({
    authorize: async (_user, ids) => {
      requested.push([...ids].sort());
      return ids.filter((id) => readable.has(id));
    },
  });
  await f.gateway.websocket.open(f.socket);
  await f.declare("known_containers", [CONTAINER, OTHER]);
  // The invalidation for this revocation was published while the subscriber
  // was disconnected and is gone for good.
  readable = new Set([OTHER]);
  f.reconnect();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(requested).toEqual([
    [CONTAINER, OTHER],
    [CONTAINER, OTHER],
  ]);
  expect(f.router.interestedSocketCount(CONTAINER)).toBe(0);
  expect(f.router.interestedSocketCount(OTHER)).toBe(1);
  expect(resyncFrames(f.sent)).toEqual([
    { type: "resync_required", containerIds: [CONTAINER, OTHER] },
  ]);
  expect(f.persisted.at(-1)).toEqual({
    kind: "remove",
    containerIds: [CONTAINER],
  });
  f.gateway.stop();
});

test("a reconnect with no held interest asks nothing", async () => {
  let calls = 0;
  const f = fixture({
    authorize: async (_user, ids) => {
      calls++;
      return ids;
    },
  });
  await f.gateway.websocket.open(f.socket);
  f.reconnect();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(calls).toBe(0);
  expect(resyncFrames(f.sent)).toEqual([]);
  f.gateway.stop();
});

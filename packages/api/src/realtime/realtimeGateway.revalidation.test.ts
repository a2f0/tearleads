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

test("a revalidation eviction invalidates the reconnect handoff for a matching declaration", async () => {
  let readable = new Set([CONTAINER, OTHER]);
  let calls = 0;
  const f = fixture({
    cached: [CONTAINER, OTHER],
    authorize: async (_user, ids) => {
      calls++;
      return ids.filter((id) => readable.has(id));
    },
  });
  await f.gateway.websocket.open(f.socket);
  expect(f.router.interestedSocketCount(CONTAINER)).toBe(1);
  // Revoked while the subscriber was down: the invalidation never arrives, so
  // only the reconnect-triggered re-verification evicts it.
  readable = new Set([OTHER]);
  f.reconnect();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(calls).toBe(2);
  expect(f.router.interestedSocketCount(CONTAINER)).toBe(0);
  // The client's authoritative declaration matches the cached set inside the
  // handoff window; it must reauthorize instead of reinstalling the stale proof.
  await f.declare("known_containers", [CONTAINER, OTHER]);
  expect(calls).toBe(3);
  expect(f.router.interestedSocketCount(CONTAINER)).toBe(0);
  expect(f.router.interestedSocketCount(OTHER)).toBe(1);
  expect(f.sent.at(-1)).toEqual({
    type: "known_containers_ack",
    containerIds: [OTHER],
    declarationId: "declaration",
  });
  f.gateway.stop();
});

test("a failed reconnect verification holds the full resync until a pass succeeds", async () => {
  const capture = spyOn(sentry, "captureApiError").mockImplementation(
    () => undefined,
  );
  const recovered = Promise.withResolvers<void>();
  let calls = 0;
  const f = fixture({
    revalidation: { intervalMs: 40, random: () => 0 },
    authorize: async (_user, ids) => {
      calls++;
      if (calls === 2) throw new Error("authorization database unavailable");
      if (calls === 3) recovered.resolve();
      return ids;
    },
  });
  try {
    await f.gateway.websocket.open(f.socket);
    await f.declare("known_containers", [CONTAINER, OTHER]);
    f.reconnect();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toBe(2);
    expect(resyncFrames(f.sent)).toEqual([]);
    expect(f.closed).toEqual([]);
    // The next periodic pass finds nothing revoked but still owes the client
    // the resync the failed reconnect pass could not deliver.
    await recovered.promise;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(resyncFrames(f.sent)).toEqual([
      { type: "resync_required", containerIds: [CONTAINER, OTHER] },
    ]);
    expect(f.router.interestedSocketCount(CONTAINER)).toBe(1);
    expect(capture).toHaveBeenCalled();
  } finally {
    capture.mockRestore();
    f.gateway.stop();
  }
});

test("failing passes evict proofs past the max age and a success resets it", async () => {
  const capture = spyOn(sentry, "captureApiError").mockImplementation(
    () => undefined,
  );
  let now = 0;
  let failing = false;
  const f = fixture({
    revalidation: { intervalMs: 0, maxProofAgeMs: 30, now: () => now },
    authorize: async (_user, ids) => {
      if (failing) throw new Error("Container authorization timed out");
      return ids;
    },
  });
  const pass = async (): Promise<void> => {
    f.reconnect();
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  try {
    await f.gateway.websocket.open(f.socket);
    await f.declare("known_containers", [CONTAINER, OTHER]);
    failing = true;
    now = 20;
    await pass();
    // Younger than the max age: a failure keeps the proofs.
    expect(f.router.interestedSocketCount(CONTAINER)).toBe(1);
    expect(resyncFrames(f.sent)).toEqual([]);
    failing = false;
    now = 25;
    await pass();
    // A success re-dates the proofs (and delivers the held reconnect resync).
    expect(resyncFrames(f.sent)).toHaveLength(1);
    failing = true;
    now = 54;
    await pass();
    expect(f.router.interestedSocketCount(CONTAINER)).toBe(1);
    expect(resyncFrames(f.sent)).toHaveLength(1);
    now = 55;
    await pass();
    // Thirty ms since the last confirmation: fail closed.
    expect(f.router.interestedSocketCount(CONTAINER)).toBe(0);
    expect(f.router.interestedSocketCount(OTHER)).toBe(0);
    expect(resyncFrames(f.sent).at(-1)).toEqual({
      type: "resync_required",
      containerIds: [CONTAINER, OTHER],
    });
    expect(f.persisted.at(-1)).toEqual({
      kind: "remove",
      containerIds: [CONTAINER, OTHER],
    });
    expect(f.closed).toEqual([]);
    // The client recovers through fresh authorization.
    failing = false;
    await f.declare("known_containers.add", [CONTAINER]);
    expect(f.router.interestedSocketCount(CONTAINER)).toBe(1);
  } finally {
    capture.mockRestore();
    f.gateway.stop();
  }
});

test("repeated periodic timeouts evict a socket's subscriptions instead of keeping them", async () => {
  const capture = spyOn(sentry, "captureApiError").mockImplementation(
    () => undefined,
  );
  let calls = 0;
  const f = fixture({
    revalidation: { intervalMs: 4, random: () => 0, maxProofAgeMs: 20 },
    authorize: async (_user, ids) => {
      if (++calls > 1) throw new Error("Container authorization timed out");
      return ids;
    },
  });
  try {
    await f.gateway.websocket.open(f.socket);
    await f.declare("known_containers", [CONTAINER, OTHER]);
    const deadline = Date.now() + 2_000;
    while (resyncFrames(f.sent).length === 0 && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 2));
    expect(calls).toBeGreaterThan(2);
    expect(resyncFrames(f.sent)).toEqual([
      { type: "resync_required", containerIds: [CONTAINER, OTHER] },
    ]);
    expect(f.router.interestedSocketCount(CONTAINER)).toBe(0);
    expect(f.closed).toEqual([]);
  } finally {
    capture.mockRestore();
    f.gateway.stop();
  }
});

test("a saturated declaration queue cannot shelter proofs past the max age", async () => {
  let now = 0;
  let hang = false;
  const pending = Promise.withResolvers<string[]>();
  const f = fixture({
    revalidation: { intervalMs: 0, maxProofAgeMs: 30, now: () => now },
    authorize: async (_user, ids) => (hang ? pending.promise : ids),
  });
  let queued: Promise<void>[] = [];
  try {
    await f.gateway.websocket.open(f.socket);
    await f.declare("known_containers", [CONTAINER, OTHER]);
    // Fill the socket's queue to its limit with declarations that never
    // complete, so no revalidation pass can be enqueued behind them.
    hang = true;
    queued = Array.from({ length: 32 }, () =>
      f.declare("known_containers.add", [crypto.randomUUID()]),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(f.closed).toEqual([]);
    now = 29;
    f.reconnect();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(f.router.interestedSocketCount(CONTAINER)).toBe(1);
    now = 30;
    f.reconnect();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(f.router.interestedSocketCount(CONTAINER)).toBe(0);
    expect(f.router.interestedSocketCount(OTHER)).toBe(0);
    expect(resyncFrames(f.sent)).toEqual([
      { type: "resync_required", containerIds: [CONTAINER, OTHER] },
    ]);
    expect(f.persisted.at(-1)).toEqual({
      kind: "remove",
      containerIds: [CONTAINER, OTHER],
    });
    // The overflow close is untouched: the queue is still full, not closed.
    expect(f.closed).toEqual([]);
  } finally {
    pending.resolve([]);
    await Promise.all(queued);
    f.gateway.stop();
  }
});

test("proof age is enforced by wall clock while a pass waits behind slow declarations", async () => {
  let now = 0;
  let slow = false;
  const release = Promise.withResolvers<void>();
  const f = fixture({
    revalidation: { intervalMs: 0, maxProofAgeMs: 30, now: () => now },
    authorize: async (_user, ids) => {
      if (slow) await release.promise;
      return ids;
    },
  });
  let queued: Promise<void>[] = [];
  try {
    await f.gateway.websocket.open(f.socket);
    await f.declare("known_containers", [CONTAINER, OTHER]);
    // A nearly full queue of slow but successful declarations, then a pass
    // queued behind them that cannot run until they finish.
    slow = true;
    const added = Array.from({ length: 30 }, () => crypto.randomUUID());
    queued = added.map((id) => f.declare("known_containers.add", [id]));
    f.reconnect();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(f.router.interestedSocketCount(CONTAINER)).toBe(1);
    now = 30;
    f.reconnect();
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Evicted before any slow declaration resolved.
    expect(f.router.interestedSocketCount(CONTAINER)).toBe(0);
    expect(f.router.interestedSocketCount(OTHER)).toBe(0);
    expect(resyncFrames(f.sent)).toEqual([
      { type: "resync_required", containerIds: [CONTAINER, OTHER] },
    ]);
    expect(f.closed).toEqual([]);
    release.resolve();
    await Promise.all(queued);
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The slow declarations install what they verified; the evicted ids stay
    // out until the client redeclares them.
    expect(f.router.interestedSocketCount(CONTAINER)).toBe(0);
    expect(f.router.interestedSocketCount(added[0] ?? "")).toBe(1);
    expect(f.closed).toEqual([]);
  } finally {
    release.resolve();
    await Promise.all(queued);
    f.gateway.stop();
  }
});

test("an in-flight pass that outlives the max age cannot reinstall evicted proofs", async () => {
  let now = 0;
  let calls = 0;
  const release = Promise.withResolvers<void>();
  const f = fixture({
    revalidation: { intervalMs: 0, maxProofAgeMs: 30, now: () => now },
    authorize: async (_user, ids) => {
      if (++calls === 2) await release.promise;
      return ids;
    },
  });
  try {
    await f.gateway.websocket.open(f.socket);
    await f.declare("known_containers", [CONTAINER, OTHER]);
    f.reconnect();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toBe(2);
    now = 30;
    f.reconnect();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(f.router.interestedSocketCount(CONTAINER)).toBe(0);
    expect(resyncFrames(f.sent)).toHaveLength(1);
    // The joined tick did not start a second pass.
    expect(calls).toBe(2);
    release.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The stale result is discarded: no reinstall, no second resync frame.
    expect(f.router.interestedSocketCount(CONTAINER)).toBe(0);
    expect(f.router.interestedSocketCount(OTHER)).toBe(0);
    expect(resyncFrames(f.sent)).toHaveLength(1);
    expect(f.persisted.at(-1)).toEqual({
      kind: "remove",
      containerIds: [CONTAINER, OTHER],
    });
    expect(f.closed).toEqual([]);
  } finally {
    release.resolve();
    f.gateway.stop();
  }
});

test("periodic ticks keep checking proof age while a pass is stuck in the queue", async () => {
  let calls = 0;
  const release = Promise.withResolvers<void>();
  const f = fixture({
    revalidation: { intervalMs: 4, random: () => 0, maxProofAgeMs: 20 },
    authorize: async (_user, ids) => {
      if (++calls === 2) await release.promise;
      return ids;
    },
  });
  let stuck: Promise<void> = Promise.resolve();
  try {
    await f.gateway.websocket.open(f.socket);
    await f.declare("known_containers", [CONTAINER, OTHER]);
    // One declaration that never finishes blocks the queue; every pass the
    // scheduler enqueues waits behind it.
    stuck = f.declare("known_containers.add", [crypto.randomUUID()]);
    const deadline = Date.now() + 2_000;
    while (resyncFrames(f.sent).length === 0 && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 2));
    expect(resyncFrames(f.sent)).toEqual([
      { type: "resync_required", containerIds: [CONTAINER, OTHER] },
    ]);
    expect(f.router.interestedSocketCount(CONTAINER)).toBe(0);
    expect(f.closed).toEqual([]);
  } finally {
    release.resolve();
    await stuck;
    f.gateway.stop();
  }
});

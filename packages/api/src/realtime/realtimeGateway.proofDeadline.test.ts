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

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Deterministic clock and timer source shared by ticks and proof deadlines. */
function fakeClock() {
  let now = 0;
  const timers = new Set<{ at: number; run: () => void }>();
  return {
    now: () => now,
    pending: () => timers.size,
    schedule: (run: () => void, delayMs: number) => {
      const timer = { at: now + delayMs, run };
      timers.add(timer);
      return () => {
        timers.delete(timer);
      };
    },
    async advanceTo(target: number): Promise<void> {
      for (;;) {
        const [due] = [...timers]
          .filter((timer) => timer.at <= target)
          .sort((a, b) => a.at - b.at);
        if (!due) break;
        timers.delete(due);
        now = due.at;
        due.run();
        await flush();
      }
      now = target;
      await flush();
    },
  };
}

test("a reconnect discards an in-flight pass and verifies afresh", async () => {
  let readable = new Set([CONTAINER, OTHER]);
  const release = Promise.withResolvers<void>();
  let calls = 0;
  const f = fixture({
    authorize: async (_user, ids) => {
      // Access is read when the query starts; a slow answer carries that
      // snapshot forward.
      const granted = ids.filter((id) => readable.has(id));
      if (++calls === 2) await release.promise;
      return granted;
    },
  });
  try {
    await f.gateway.websocket.open(f.socket);
    await f.declare("known_containers", [CONTAINER, OTHER]);
    f.reconnect();
    await flush();
    expect(calls).toBe(2);
    // Revoked while that pass is still waiting; its invalidation is lost.
    readable = new Set([OTHER]);
    f.reconnect();
    await flush();
    release.resolve();
    await flush();
    await flush();
    // The pre-revocation result was discarded and a fresh verification ran.
    expect(calls).toBe(3);
    expect(f.router.interestedSocketCount(CONTAINER)).toBe(0);
    expect(f.router.interestedSocketCount(OTHER)).toBe(1);
    expect(resyncFrames(f.sent)).toEqual([
      { type: "resync_required", containerIds: [CONTAINER, OTHER] },
    ]);
    expect(f.persisted.at(-1)).toEqual({
      kind: "remove",
      containerIds: [CONTAINER],
    });
    expect(f.closed).toEqual([]);
  } finally {
    release.resolve();
    f.gateway.stop();
  }
});

test("failing verifications evict at the proof deadline, not at the next tick", async () => {
  const capture = spyOn(sentry, "captureApiError").mockImplementation(
    () => undefined,
  );
  const clock = fakeClock();
  let failing = false;
  const ticks: number[] = [];
  const f = fixture({
    revalidation: {
      intervalMs: 10,
      random: () => 1,
      maxProofAgeMs: 25,
      now: clock.now,
      schedule: clock.schedule,
    },
    authorize: async (_user, ids) => {
      ticks.push(clock.now());
      if (failing) throw new Error("Container authorization timed out");
      return ids;
    },
  });
  try {
    await f.gateway.websocket.open(f.socket);
    await f.declare("known_containers", [CONTAINER, OTHER]);
    failing = true;
    await clock.advanceTo(24);
    expect(ticks).toEqual([0, 10, 20]);
    expect(f.router.interestedSocketCount(CONTAINER)).toBe(1);
    expect(resyncFrames(f.sent)).toEqual([]);
    // Ticks fall at 10, 20, 30; the deadline is 25 and wins.
    await clock.advanceTo(25);
    expect(f.router.interestedSocketCount(CONTAINER)).toBe(0);
    expect(f.router.interestedSocketCount(OTHER)).toBe(0);
    expect(resyncFrames(f.sent)).toEqual([
      { type: "resync_required", containerIds: [CONTAINER, OTHER] },
    ]);
    expect(f.persisted.at(-1)).toEqual({
      kind: "remove",
      containerIds: [CONTAINER, OTHER],
    });
    await clock.advanceTo(30);
    expect(resyncFrames(f.sent)).toHaveLength(1);
    expect(f.closed).toEqual([]);
  } finally {
    capture.mockRestore();
    f.gateway.stop();
  }
});

test("a successful verification re-arms the proof deadline from its own time", async () => {
  const capture = spyOn(sentry, "captureApiError").mockImplementation(
    () => undefined,
  );
  const clock = fakeClock();
  let failing = false;
  const f = fixture({
    revalidation: {
      intervalMs: 10,
      random: () => 1,
      maxProofAgeMs: 30,
      now: clock.now,
      schedule: clock.schedule,
    },
    authorize: async (_user, ids) => {
      if (failing) throw new Error("Container authorization timed out");
      return ids;
    },
  });
  try {
    await f.gateway.websocket.open(f.socket);
    await f.declare("known_containers", [CONTAINER, OTHER]);
    failing = true;
    await clock.advanceTo(25);
    failing = false;
    f.reconnect();
    await flush();
    // Confirmed at 25: the deadline moves to 55 and the held resync goes out.
    expect(resyncFrames(f.sent)).toHaveLength(1);
    failing = true;
    await clock.advanceTo(30);
    expect(f.router.interestedSocketCount(CONTAINER)).toBe(1);
    await clock.advanceTo(54);
    expect(f.router.interestedSocketCount(CONTAINER)).toBe(1);
    expect(resyncFrames(f.sent)).toHaveLength(1);
    await clock.advanceTo(55);
    expect(f.router.interestedSocketCount(CONTAINER)).toBe(0);
    expect(resyncFrames(f.sent)).toHaveLength(2);
    expect(resyncFrames(f.sent).at(-1)).toEqual({
      type: "resync_required",
      containerIds: [CONTAINER, OTHER],
    });
    expect(f.closed).toEqual([]);
  } finally {
    capture.mockRestore();
    f.gateway.stop();
  }
});

test("stopping the gateway disarms every proof deadline", async () => {
  const clock = fakeClock();
  let failing = false;
  const f = fixture({
    revalidation: {
      intervalMs: 10,
      random: () => 1,
      maxProofAgeMs: 25,
      now: clock.now,
      schedule: clock.schedule,
    },
    authorize: async (_user, ids) => {
      if (failing) throw new Error("Container authorization timed out");
      return ids;
    },
  });
  await f.gateway.websocket.open(f.socket);
  await f.declare("known_containers", [CONTAINER, OTHER]);
  failing = true;
  const framesBeforeStop = f.sent.length;
  f.gateway.stop();
  expect(clock.pending()).toBe(0);
  await clock.advanceTo(60);
  // Nothing fires from a stopped gateway: no eviction, no frame.
  expect(f.sent).toHaveLength(framesBeforeStop);
  expect(f.router.interestedSocketCount(CONTAINER)).toBe(1);
});

test("a declaration straddling the proof deadline re-authorizes instead of installing", async () => {
  const clock = fakeClock();
  let readable = new Set([CONTAINER, OTHER]);
  const release = Promise.withResolvers<void>();
  let calls = 0;
  const f = fixture({
    revalidation: {
      intervalMs: 0,
      maxProofAgeMs: 30,
      now: clock.now,
      schedule: clock.schedule,
    },
    authorize: async (_user, ids) => {
      // Access is read when the query starts; the held answer carries it.
      const granted = ids.filter((id) => readable.has(id));
      if (++calls === 2) await release.promise;
      return granted;
    },
  });
  try {
    await f.gateway.websocket.open(f.socket);
    await f.declare("known_containers", [CONTAINER]);
    const adding = f.declare("known_containers.add", [OTHER]);
    await flush();
    expect(calls).toBe(2);
    // The deadline passes while the declaration's query is open; the held
    // subscription is evicted and, meanwhile, the pending grant is revoked
    // with its invalidation lost.
    await clock.advanceTo(30);
    expect(f.router.interestedSocketCount(CONTAINER)).toBe(0);
    expect(resyncFrames(f.sent)).toEqual([
      { type: "resync_required", containerIds: [CONTAINER] },
    ]);
    readable = new Set();
    release.resolve();
    await adding;
    // The pre-eviction answer was discarded; fresh authorization refused it.
    expect(calls).toBe(3);
    expect(f.router.interestedSocketCount(OTHER)).toBe(0);
    expect(f.sent.at(-1)).toEqual({
      type: "known_containers_ack",
      containerIds: [],
      declarationId: "declaration",
    });
    // The client's re-declaration authorizes normally.
    readable = new Set([CONTAINER, OTHER]);
    await f.declare("known_containers.add", [CONTAINER]);
    expect(calls).toBe(4);
    expect(f.router.interestedSocketCount(CONTAINER)).toBe(1);
    expect(f.closed).toEqual([]);
  } finally {
    release.resolve();
    f.gateway.stop();
  }
});

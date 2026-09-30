import { expect, spyOn, test } from "bun:test";
import {
  CONTAINER,
  fixture,
} from "../../test/helpers/realtimeContainerAuthorization";
import * as sentry from "../diagnostics/sentry";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Collects scheduled revalidation ticks so a test fires them by hand. */
function manualTimers() {
  const due: Array<() => void> = [];
  return {
    schedule: (run: () => void) => {
      due.push(run);
      return () => {
        const index = due.indexOf(run);
        if (index >= 0) due.splice(index, 1);
      };
    },
    async fire(): Promise<void> {
      const run = due.shift();
      if (!run) throw new Error("No revalidation tick is scheduled");
      run();
      await flush();
    },
  };
}

function resyncFrames(sent: ReadonlyArray<Record<string, unknown>>) {
  return sent.filter(
    (frame) => Reflect.get(frame, "type") === "resync_required",
  );
}

test("a revalidation tick closes the socket of an ended session", async () => {
  const timers = manualTimers();
  let live = true;
  let calls = 0;
  const f = fixture({
    revalidation: { intervalMs: 4, random: () => 0, schedule: timers.schedule },
    sessionLive: () => live,
    authorize: async (_user, ids) => {
      calls++;
      return ids;
    },
  });
  try {
    await f.gateway.websocket.open(f.socket);
    await f.declare();
    expect(f.router.interestedSocketCount(CONTAINER)).toBe(1);
    await timers.fire();
    expect(f.closed).toEqual([]);
    const before = calls;
    // Expired or revoked with the revocation publication lost.
    live = false;
    await timers.fire();
    expect(f.closed).toEqual([1008]);
    expect(f.router.interestedSocketCount(CONTAINER)).toBe(0);
    expect(calls).toBe(before);
  } finally {
    f.gateway.stop();
  }
});

test("a subscriber reconnect closes an ended session before resyncing", async () => {
  let live = true;
  const f = fixture({
    sessionLive: () => live,
    authorize: async (_user, ids) => ids,
  });
  try {
    await f.gateway.websocket.open(f.socket);
    await f.declare();
    live = false;
    f.reconnect();
    await flush();
    await flush();
    expect(f.closed).toEqual([1008]);
    expect(f.router.interestedSocketCount(CONTAINER)).toBe(0);
    expect(resyncFrames(f.sent)).toEqual([]);
  } finally {
    f.gateway.stop();
  }
});

test("a subscriber reconnect keeps a live session's socket", async () => {
  const f = fixture({ authorize: async (_user, ids) => ids });
  try {
    await f.gateway.websocket.open(f.socket);
    await f.declare();
    f.reconnect();
    await flush();
    await flush();
    expect(f.closed).toEqual([]);
    expect(f.router.interestedSocketCount(CONTAINER)).toBe(1);
    expect(resyncFrames(f.sent)).toHaveLength(1);
  } finally {
    f.gateway.stop();
  }
});

test("an unreadable session store still lets the reconnect resync", async () => {
  const capture = spyOn(sentry, "captureApiError").mockImplementation(
    () => undefined,
  );
  const f = fixture({
    sessionLive: () => {
      throw new Error("Session store unavailable");
    },
    authorize: async (_user, ids) => ids,
  });
  try {
    await f.gateway.websocket.open(f.socket);
    await f.declare();
    f.reconnect();
    await flush();
    await flush();
    expect(f.closed).toEqual([]);
    expect(f.router.interestedSocketCount(CONTAINER)).toBe(1);
    expect(resyncFrames(f.sent)).toHaveLength(1);
    expect(capture).toHaveBeenCalled();
  } finally {
    f.gateway.stop();
    capture.mockRestore();
  }
});

import { afterEach, expect, mock, spyOn, test } from "bun:test";
import {
  CONTAINER,
  fixture,
  recordingSocket,
} from "../../test/helpers/realtimeContainerAuthorization";
import * as sentry from "../diagnostics/sentry";
import { type WsConnection, WsEventRouter } from "./wsRouting";

afterEach(() => {
  mock.restore();
});

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
      await flush();
    },
  };
}

function resyncFrames(sent: ReadonlyArray<Record<string, unknown>>) {
  return sent.filter(
    (frame) => Reflect.get(frame, "type") === "resync_required",
  );
}

function silenceReports() {
  spyOn(console, "error").mockImplementation(() => undefined);
  return spyOn(sentry, "captureApiError").mockImplementation(() => undefined);
}

test("an ended session's sockets close with a neutral reason", () => {
  const router = new WsEventRouter();
  const closed: Array<[number | undefined, string | undefined]> = [];
  const socket = {
    data: { userId: "user", sessionId: "session" },
    send: () => undefined,
    close: (code?: number, reason?: string) => closed.push([code, reason]),
  } as unknown as WsConnection;
  router.open(socket);
  router.closeSession("user", "session");
  expect(closed).toEqual([[1008, "Session ended"]]);
});

test("a revalidation tick closes the socket of an ended session", async () => {
  const timers = manualTimers();
  let live = true;
  const f = fixture({
    // Proof age off: only the manual tick may run, never a deadline eviction.
    revalidation: {
      intervalMs: 4,
      maxProofAgeMs: 0,
      random: () => 0,
      schedule: timers.schedule,
    },
    sessionLive: () => live,
    authorize: async (_user, ids) => ids,
  });
  try {
    await f.gateway.websocket.open(f.socket);
    await f.declare();
    await timers.fire();
    expect(f.closed).toEqual([]);
    // Expired, or revoked with the revocation publication lost.
    live = false;
    await timers.fire();
    expect(f.closed).toEqual([1008]);
    expect(f.router.interestedSocketCount(CONTAINER)).toBe(0);
  } finally {
    f.gateway.stop();
  }
});

test("a tick still re-verifies proofs when the session store fails", async () => {
  const capture = silenceReports();
  const timers = manualTimers();
  let calls = 0;
  const f = fixture({
    // Proof age off: only the manual tick may run, never a deadline eviction.
    revalidation: {
      intervalMs: 4,
      maxProofAgeMs: 0,
      random: () => 0,
      schedule: timers.schedule,
    },
    sessionLive: () => {
      throw new Error("Session store unavailable");
    },
    authorize: async (_user, ids) => {
      calls++;
      return ids;
    },
  });
  try {
    await f.gateway.websocket.open(f.socket);
    await f.declare();
    const before = calls;
    await timers.fire();
    expect(calls).toBe(before + 1);
    expect(f.closed).toEqual([]);
    expect(capture).toHaveBeenCalledTimes(1);
  } finally {
    f.gateway.stop();
  }
});

test("a subscriber reconnect closes an ended session's socket", async () => {
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
  } finally {
    f.gateway.stop();
  }
});

test("a reconnect keeps a live session's socket and resyncs it", async () => {
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

test("a hung session read does not hold back the reconnect resync", async () => {
  const f = fixture({ authorize: async (_user, ids) => ids });
  const hung = fixture({
    authorize: async (_user, ids) => ids,
    validateSession: () => new Promise<boolean>(() => undefined),
  });
  try {
    for (const g of [f, hung]) {
      await g.gateway.websocket.open(g.socket);
      await g.declare();
      g.reconnect();
      await flush();
      await flush();
    }
    expect(resyncFrames(hung.sent)).toEqual(resyncFrames(f.sent));
    expect(resyncFrames(hung.sent)).toHaveLength(1);
    expect(hung.closed).toEqual([]);
  } finally {
    f.gateway.stop();
    hung.gateway.stop();
  }
});

test("a reconnect checks each session once and reports one failure", async () => {
  const capture = silenceReports();
  let checks = 0;
  const f = fixture({
    sessionLive: () => {
      checks++;
      throw new Error("Session store unavailable");
    },
    authorize: async (_user, ids) => ids,
  });
  const sameSession = recordingSocket("user", "session");
  const otherSession = recordingSocket("user", "other-session");
  try {
    await f.gateway.websocket.open(f.socket);
    await f.gateway.websocket.open(sameSession.socket);
    await f.gateway.websocket.open(otherSession.socket);
    await f.declare();
    f.reconnect();
    await flush();
    await flush();
    expect(checks).toBe(2);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(resyncFrames(f.sent)).toHaveLength(1);
    expect(f.closed).toEqual([]);
  } finally {
    f.gateway.stop();
  }
});

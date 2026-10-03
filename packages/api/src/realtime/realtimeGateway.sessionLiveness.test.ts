import { afterEach, expect, mock, spyOn, test } from "bun:test";
import {
  CONTAINER,
  fixture,
  recordingSocket,
  virtualClock,
} from "../../test/helpers/realtimeContainerAuthorization";
import * as background from "../diagnostics/reportBackgroundFailure";
import { WsEventRouter } from "./wsRouting";

afterEach(() => {
  mock.restore();
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function resyncFrames(sent: ReadonlyArray<Record<string, unknown>>) {
  return sent.filter(
    (frame) => Reflect.get(frame, "type") === "resync_required",
  );
}

function silenceReports() {
  spyOn(console, "error").mockImplementation(() => undefined);
  return spyOn(background, "reportBackgroundFailure").mockImplementation(
    () => undefined,
  );
}

/** Ticks every 50 ms (half the interval, without jitter); proof age off. */
function ticking(clock: ReturnType<typeof virtualClock>) {
  return {
    intervalMs: 100,
    maxProofAgeMs: 0,
    now: clock.now,
    random: () => 0,
    schedule: clock.schedule,
  };
}

test("closing a session closes its sockets and spares other sessions", () => {
  const router = new WsEventRouter();
  const first = recordingSocket("user", "session");
  const second = recordingSocket("user", "session");
  const other = recordingSocket("user", "other-session");
  for (const { socket } of [first, second, other]) router.open(socket);
  router.closeSession("user", "session");
  const ended = [{ code: 1008, reason: "Session ended" }];
  expect(first.closed).toEqual(ended);
  expect(second.closed).toEqual(ended);
  expect(other.closed).toEqual([]);
  expect(router.openSockets()).toEqual([other.socket]);
});

test("a session tick closes the socket of an ended session", async () => {
  const clock = virtualClock();
  let live = true;
  const f = fixture({
    revalidation: ticking(clock),
    sessionLive: () => live,
    authorize: async (_user, ids) => ids,
  });
  try {
    await f.gateway.websocket.open(f.socket);
    await f.declare();
    await clock.advance(50);
    expect(f.closed).toEqual([]);
    // Expired, or revoked with the revocation publication lost.
    live = false;
    await clock.advance(50);
    expect(f.closed).toEqual([1008]);
    expect(f.router.interestedSocketCount(CONTAINER)).toBe(0);
  } finally {
    f.gateway.stop();
  }
});

test("a session's sockets share one store read per tick", async () => {
  const clock = virtualClock();
  const reads: string[] = [];
  const f = fixture({
    revalidation: ticking(clock),
    validateSession: async ({ sessionId }) => {
      reads.push(sessionId);
      return true;
    },
    authorize: async (_user, ids) => ids,
  });
  try {
    await f.gateway.websocket.open(f.socket);
    for (const sessionId of ["session", "session", "other-session"]) {
      await f.gateway.websocket.open(recordingSocket("user", sessionId).socket);
    }
    await clock.advance(50);
    expect(reads.sort()).toEqual(["other-session", "session"]);
  } finally {
    f.gateway.stop();
  }
});

test("a tick still re-verifies proofs when the session store fails", async () => {
  const report = silenceReports();
  const clock = virtualClock();
  let calls = 0;
  const f = fixture({
    revalidation: ticking(clock),
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
    await clock.advance(50);
    expect(calls).toBe(before + 1);
    expect(f.closed).toEqual([]);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(expect.any(Error), "websocket.session");
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
    expect(capture).toHaveBeenCalledWith(
      expect.any(Error),
      "websocket.session",
    );
    expect(resyncFrames(f.sent)).toHaveLength(1);
    expect(f.closed).toEqual([]);
  } finally {
    f.gateway.stop();
  }
});

test("a reconnect keeps at most 16 session reads in flight", async () => {
  let inFlight = 0;
  let reads = 0;
  const answers: Array<() => void> = [];
  const f = fixture({
    authorize: async (_user, ids) => ids,
    validateSession: () => {
      inFlight++;
      reads++;
      return new Promise<boolean>((resolve) => {
        answers.push(() => {
          inFlight--;
          resolve(true);
        });
      });
    },
  });
  try {
    for (let index = 0; index < 40; index++) {
      await f.gateway.websocket.open(
        recordingSocket("user", `session-${index}`).socket,
      );
    }
    f.reconnect();
    await flush();
    expect(inFlight).toBe(16);
    for (let answer = answers.shift(); answer; answer = answers.shift()) {
      answer();
      await flush();
      expect(inFlight).toBeLessThanOrEqual(16);
    }
    expect(reads).toBe(40);
  } finally {
    f.gateway.stop();
  }
});

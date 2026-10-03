import { afterEach, expect, mock, spyOn, test } from "bun:test";
import {
  fixture,
  recordingSocket,
  virtualClock,
} from "../../test/helpers/realtimeContainerAuthorization";
import * as background from "../diagnostics/reportBackgroundFailure";
import { resolveProofAgePolicy } from "./containerInterestRevalidation";

afterEach(() => {
  mock.restore();
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function silenceReports() {
  spyOn(console, "error").mockImplementation(() => undefined);
  return spyOn(background, "reportBackgroundFailure").mockImplementation(
    () => undefined,
  );
}

/** Ticks every 50 ms, without jitter, on the virtual clock. */
function ticking(
  clock: ReturnType<typeof virtualClock>,
  maxProofAgeMs: number,
) {
  return {
    intervalMs: 100,
    maxProofAgeMs,
    now: clock.now,
    random: () => 0,
    schedule: clock.schedule,
  };
}

test("a session the store cannot confirm closes at its deadline", async () => {
  const report = silenceReports();
  const clock = virtualClock();
  const f = fixture({
    revalidation: ticking(clock, 300),
    sessionLive: () => {
      throw new Error("Session store unavailable");
    },
    authorize: async (_user, ids) => ids,
  });
  try {
    await f.gateway.websocket.open(f.socket);
    await f.declare();
    await clock.advance(299);
    // Ticks at 50 to 250 each fail, and each failure only delays the close.
    expect(report).toHaveBeenCalledTimes(5);
    expect(f.closed).toEqual([]);
    await clock.advance(1);
    expect(f.closed).toEqual([1013]);
  } finally {
    f.gateway.stop();
  }
});

test("failing reads never extend the deadline past the last confirmation", async () => {
  silenceReports();
  const clock = virtualClock();
  const f = fixture({
    revalidation: ticking(clock, 300),
    sessionLive: () => {
      if (clock.now() > 100) throw new Error("Session store unavailable");
      return true;
    },
    authorize: async (_user, ids) => ids,
  });
  try {
    await f.gateway.websocket.open(f.socket);
    // The tick at 100 is the last confirmation.
    await clock.advance(399);
    expect(f.closed).toEqual([]);
    await clock.advance(1);
    expect(f.closed).toEqual([1013]);
  } finally {
    f.gateway.stop();
  }
});

test("a confirmed session outlives its deadline", async () => {
  const clock = virtualClock();
  const f = fixture({
    revalidation: ticking(clock, 300),
    authorize: async (_user, ids) => ids,
  });
  try {
    await f.gateway.websocket.open(f.socket);
    await clock.advance(1_000);
    expect(f.closed).toEqual([]);
  } finally {
    f.gateway.stop();
  }
});

test("a ticket upgrade confirms the session, and older reads never undo it", async () => {
  silenceReports();
  const clock = virtualClock();
  let answer: (live: boolean) => void = () => undefined;
  let reads = 0;
  const f = fixture({
    revalidation: ticking(clock, 300),
    validateSession: () => {
      if (++reads > 1) return Promise.reject(new Error("Store unavailable"));
      return new Promise<boolean>((resolve) => {
        answer = resolve;
      });
    },
    authorize: async (_user, ids) => ids,
  });
  try {
    await f.gateway.websocket.open(f.socket);
    // The tick at 50 starts a read that answers only after the upgrade below.
    await clock.advance(200);
    await f.gateway.websocket.open(recordingSocket("user", "session").socket);
    answer(true);
    await flush();
    // The upgrade at 200 confirmed the session; the read from 50 cannot move
    // the deadline back to 350, and later reads all fail.
    await clock.advance(299);
    expect(f.closed).toEqual([]);
    await clock.advance(1);
    expect(f.closed).toEqual([1013]);
  } finally {
    f.gateway.stop();
  }
});

test("a hung session read times out and the next tick joins it", async () => {
  const report = silenceReports();
  const clock = virtualClock();
  let reads = 0;
  const f = fixture({
    revalidation: ticking(clock, 0),
    sessionReadTimeoutMs: 5,
    validateSession: () => {
      reads++;
      return new Promise<boolean>(() => undefined);
    },
    authorize: async (_user, ids) => ids,
  });
  try {
    await f.gateway.websocket.open(f.socket);
    await clock.advance(55);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(expect.any(Error), "websocket.session");
    await clock.advance(50);
    expect(reads).toBe(1);
    expect(report).toHaveBeenCalledTimes(2);
    expect(f.closed).toEqual([]);
  } finally {
    f.gateway.stop();
  }
});

test("a read that answers after its timeout still closes an ended session", async () => {
  const report = silenceReports();
  const clock = virtualClock();
  let answer: (live: boolean) => void = () => undefined;
  const f = fixture({
    revalidation: ticking(clock, 0),
    sessionReadTimeoutMs: 5,
    validateSession: () =>
      new Promise<boolean>((resolve) => {
        answer = resolve;
      }),
    authorize: async (_user, ids) => ids,
  });
  try {
    await f.gateway.websocket.open(f.socket);
    await clock.advance(55);
    expect(report).toHaveBeenCalledTimes(1);
    answer(false);
    await flush();
    expect(f.closed).toEqual([1008]);
  } finally {
    f.gateway.stop();
  }
});

test("a stopped gateway reports no session check still in flight", async () => {
  const report = silenceReports();
  const clock = virtualClock();
  let fail: (error: Error) => void = () => undefined;
  const f = fixture({
    revalidation: ticking(clock, 0),
    validateSession: () =>
      new Promise<boolean>((_resolve, reject) => {
        fail = reject;
      }),
    authorize: async (_user, ids) => ids,
  });
  await f.gateway.websocket.open(f.socket);
  await clock.advance(50);
  f.gateway.stop();
  fail(new Error("Session store unavailable"));
  await flush();
  await flush();
  expect(report).not.toHaveBeenCalled();
});

test("a proof-age bound under two intervals is refused", () => {
  expect(() =>
    resolveProofAgePolicy({ intervalMs: 100, maxProofAgeMs: 199 }),
  ).toThrow("maxProofAgeMs must be at least twice the revalidation interval");
  expect(
    resolveProofAgePolicy({ intervalMs: 100, maxProofAgeMs: 200 })
      .maxProofAgeMs,
  ).toBe(200);
  expect(
    resolveProofAgePolicy({ intervalMs: 0, maxProofAgeMs: 30 }).maxProofAgeMs,
  ).toBe(30);
});

test("closing a session's last socket stops its rechecks and deadline", async () => {
  const clock = virtualClock();
  let reads = 0;
  const f = fixture({
    revalidation: ticking(clock, 300),
    validateSession: async () => {
      reads++;
      return true;
    },
    authorize: async (_user, ids) => ids,
  });
  const second = recordingSocket("user", "session");
  try {
    await f.gateway.websocket.open(f.socket);
    await f.gateway.websocket.open(second.socket);
    // One of two sockets closing keeps the session tracked.
    f.gateway.websocket.close(second.socket);
    await clock.advance(50);
    expect(reads).toBe(1);
    f.gateway.websocket.close(f.socket);
    expect(clock.pending()).toBe(0);
    await clock.advance(1_000);
    expect(reads).toBe(1);
  } finally {
    f.gateway.stop();
  }
});

test("a hung store holds at most one read per session", async () => {
  silenceReports();
  const clock = virtualClock();
  let reads = 0;
  const f = fixture({
    revalidation: ticking(clock, 0),
    sessionReadTimeoutMs: 5,
    validateSession: () => {
      reads++;
      return new Promise<boolean>(() => undefined);
    },
    authorize: async (_user, ids) => ids,
  });
  try {
    for (let index = 0; index < 40; index++) {
      await f.gateway.websocket.open(
        recordingSocket("user", `session-${index}`).socket,
      );
    }
    f.reconnect();
    await clock.advance(25);
    expect(reads).toBe(40);
    f.reconnect();
    await clock.advance(25);
    expect(reads).toBe(40);
  } finally {
    f.gateway.stop();
  }
});

test("a failure without a reason is still reported", async () => {
  const report = silenceReports();
  const f = fixture({
    authorize: async (_user, ids) => ids,
    validateSession: () => Promise.reject(),
  });
  try {
    await f.gateway.websocket.open(f.socket);
    f.reconnect();
    await flush();
    await flush();
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(undefined, "websocket.session");
  } finally {
    f.gateway.stop();
  }
});

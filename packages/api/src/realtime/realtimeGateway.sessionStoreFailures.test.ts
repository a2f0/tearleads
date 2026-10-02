import { afterEach, expect, mock, spyOn, test } from "bun:test";
import {
  fixture,
  virtualClock,
} from "../../test/helpers/realtimeContainerAuthorization";
import * as background from "../diagnostics/reportBackgroundFailure";

afterEach(() => {
  mock.restore();
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function silenceReports() {
  spyOn(console, "error").mockImplementation(() => undefined);
  return spyOn(background, "reportBackgroundFailure").mockImplementation(
    () => undefined,
  );
}

/** Ticks every 50 ms; a session unconfirmed for 300 ms reaches its deadline. */
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
    await clock.advance(50);
    await sleep(20);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(expect.any(Error), "websocket.session");
    await clock.advance(50);
    await sleep(20);
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
    await clock.advance(50);
    await sleep(20);
    expect(report).toHaveBeenCalledTimes(1);
    answer(false);
    await flush();
    expect(f.closed).toEqual([1008]);
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

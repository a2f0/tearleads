import { expect, test } from "bun:test";
import type { Frame } from "../hubSocket";
import {
  type MonitorClock,
  startHintMonitor,
  summarizeLags,
} from "./hintMonitor";

/** A manual clock: timers run only when the test advances time. */
function manualClock() {
  let now = 0;
  let pending: { run: () => void; at: number } | null = null;
  const clock: MonitorClock<number> = {
    now: () => now,
    setTimeout: (run, delayMs) => {
      pending = { run, at: now + delayMs };
      return 1;
    },
    clearTimeout: () => {
      pending = null;
    },
  };
  return {
    clock,
    /** Runs the armed timer at `at`, or later if the thread was busy. */
    fireAt(at: number) {
      const timer = pending;
      if (!timer) throw new Error("No timer is armed.");
      expect(at).toBeGreaterThanOrEqual(timer.at);
      now = at;
      pending = null;
      timer.run();
    },
    pendingAt: () => pending?.at,
  };
}

/** Delivers every published hint to the observer, as the router would. */
function echoingHub() {
  const listeners = new Set<(frame: Frame) => void>();
  const published: string[] = [];
  return {
    observer: {
      listen(listener: (frame: Frame) => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    published,
    async publish(message: string) {
      published.push(message);
      const frame: Frame = JSON.parse(message);
      for (const listener of listeners) listener(frame);
    },
  };
}

test("lag is delivery time minus the hint's due time", () => {
  const { clock, fireAt, pendingAt } = manualClock();
  const hub = echoingHub();
  const monitor = startHintMonitor(
    {
      intervalMs: 10,
      containerId: "root",
      observer: hub.observer,
      publish: hub.publish,
    },
    clock,
  );
  fireAt(10);
  fireAt(20);
  // A 35 ms stall: the hint due at 30 fires at 65, and the deadlines it
  // swallowed are skipped rather than replayed.
  fireAt(65);
  expect(pendingAt()).toBe(70);
  fireAt(70);
  const lag = monitor.stop();
  expect(lag).toMatchObject({ sent: 4, delivered: 4, maxMs: 35 });
  expect(lag.blockedMs).toBe(25);
  expect(JSON.parse(hub.published[0] ?? "")).toMatchObject({
    type: "document_update_created",
    containerIds: ["root"],
  });
  expect(pendingAt()).toBeUndefined();
});

test("hints that never reach the observer are counted as undelivered", () => {
  const { clock, fireAt } = manualClock();
  const monitor = startHintMonitor(
    {
      intervalMs: 5,
      containerId: "root",
      observer: { listen: () => () => undefined },
      publish: async () => undefined,
    },
    clock,
  );
  fireAt(5);
  fireAt(10);
  expect(monitor.stop()).toMatchObject({ sent: 2, delivered: 0, maxMs: 0 });
});

test("a hint the hub fails to publish fails the measurement", async () => {
  const { clock, fireAt } = manualClock();
  const monitor = startHintMonitor(
    {
      intervalMs: 5,
      containerId: "root",
      observer: { listen: () => () => undefined },
      publish: async () => {
        throw new Error("routing failed");
      },
    },
    clock,
  );
  fireAt(5);
  await Promise.resolve();
  expect(() => monitor.stop()).toThrow(/1 hints failed/);
});

test("percentiles are nearest-rank over delivered hints", () => {
  const lags = Array.from({ length: 100 }, (_, index) => index + 1);
  expect(summarizeLags(lags, 100, 10)).toMatchObject({
    p50Ms: 50,
    p95Ms: 95,
    p99Ms: 99,
    maxMs: 100,
    blockedMs: 4_095,
  });
  expect(summarizeLags([], 3, 10)).toMatchObject({
    delivered: 0,
    p99Ms: 0,
    blockedMs: 0,
  });
});

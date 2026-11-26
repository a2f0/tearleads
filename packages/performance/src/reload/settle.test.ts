import { expect, test } from "bun:test";
import type { ApiRequestMetricsSnapshot } from "@tearleads/client-sdk";
import { requestTotals, settle } from "./settle";

/** A clock that advances only when the code under test sleeps. */
function manualClock() {
  let now = 1_000;
  return {
    now: () => now,
    sleep: async (ms: number) => {
      now += ms;
    },
  };
}

/** Request totals that follow a script, one entry per poll. */
function scripted(polls: readonly [total: number, inFlight: number][]) {
  let index = 0;
  return () => {
    const [total, inFlight] = polls[Math.min(index, polls.length - 1)] ?? [
      0, 0,
    ];
    index += 1;
    return { total, inFlight };
  };
}

const idle = async () => undefined;

test("settles when no request starts, runs or finishes for the quiet window", async () => {
  // Read at the start, then at 25, 50, 75 ms and on.
  const settled = await settle({
    started: 1_000,
    quietMs: 100,
    timeoutMs: 10_000,
    idle,
    totals: scripted([
      [0, 0],
      [1, 1],
      [2, 1],
      [2, 0],
      [2, 0],
    ]),
    clock: manualClock(),
  });
  // The request in flight at 50 ms finished by 75 ms, the last activity seen.
  expect(settled).toBe(75);
});

test("a request in flight keeps the reload from settling", async () => {
  const clock = manualClock();
  const settled = await settle({
    started: 1_000,
    quietMs: 50,
    timeoutMs: 10_000,
    idle,
    totals: () => ({ total: 1, inFlight: clock.now() < 1_500 ? 1 : 0 }),
    clock,
  });
  expect(settled).toBe(500);
});

test("requests counted before the first poll count as activity then", async () => {
  const clock = manualClock();
  await clock.sleep(40);
  const settled = await settle({
    started: 1_000,
    quietMs: 50,
    timeoutMs: 10_000,
    idle,
    totals: () => ({ total: 3, inFlight: 0 }),
    clock,
  });
  expect(settled).toBe(40);
});

test("a reload that never goes quiet times out", async () => {
  let total = 0;
  await expect(
    settle({
      started: 1_000,
      quietMs: 100,
      timeoutMs: 1_000,
      idle,
      totals: () => ({ total: ++total, inFlight: 0 }),
      clock: manualClock(),
    }),
  ).rejects.toThrow("The reload did not settle.");
});

test("request totals merge identity scopes and count a repeated scope once", () => {
  const snapshot = (
    total: number,
    inFlight: number,
    path: string,
  ): ApiRequestMetricsSnapshot => ({
    startedAt: "",
    total,
    inFlight,
    succeeded: total - inFlight,
    failed: 0,
    cancelled: 0,
    endpoints: [
      {
        method: "GET",
        path,
        total,
        inFlight,
        succeeded: total - inFlight,
        failed: 0,
        cancelled: 0,
        duration: null,
        serverDuration: null,
        databaseDuration: null,
      },
    ],
  });
  const snapshots = new Map<string | null, ApiRequestMetricsSnapshot>([
    [null, snapshot(1, 0, "/before-identity")],
    ["fingerprint", snapshot(5, 2, "/after-identity")],
  ]);
  const get = (scope: string | null) =>
    snapshots.get(scope) ?? snapshot(0, 0, "/unused");
  const both = requestTotals(get, [null, "fingerprint"]);
  expect([both.total, both.inFlight]).toEqual([6, 2]);
  expect(both.endpoints.map((endpoint) => endpoint.path)).toEqual([
    "/before-identity",
    "/after-identity",
  ]);
  const anonymous = requestTotals(get, [null, null]);
  expect([anonymous.total, anonymous.endpoints.length]).toEqual([1, 1]);
});

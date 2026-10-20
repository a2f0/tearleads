import { expect, test } from "bun:test";
import { listSessionsOperation } from "@tearleads/validators/operation";
import { ApiRequestMetrics } from "./apiRequestMetrics";
import { DURATION_SAMPLE_WINDOW_SIZE } from "./durationSampleWindow";
import { measureApiRequest } from "./measureApiRequest";

function createClock() {
  const clock = { nowMs: 1000, now: () => clock.nowMs };
  return clock;
}

function endpointRow(metrics: ApiRequestMetrics, identity: string | null) {
  return metrics.getSnapshot(identity).endpoints[0];
}

test("times every outcome per endpoint with nearest-rank percentiles", () => {
  const clock = createClock();
  const metrics = new ApiRequestMetrics(clock.now);
  const outcomes = ["succeeded", "failed", "cancelled"] as const;
  for (let ms = 1; ms <= 20; ms += 1) {
    const finish = metrics.begin("alice", listSessionsOperation);
    clock.nowMs += ms;
    finish(outcomes[ms % outcomes.length] ?? "succeeded");
  }
  const pending = metrics.begin("alice", listSessionsOperation);
  expect(endpointRow(metrics, "alice")).toMatchObject({
    inFlight: 1,
    duration: { samples: 20, totalMs: 210, p50Ms: 10, p95Ms: 19, maxMs: 20 },
    serverDuration: null,
    databaseDuration: null,
  });
  clock.nowMs -= 5;
  pending("succeeded");
  expect(endpointRow(metrics, "alice")?.duration).toMatchObject({
    samples: 21,
    p50Ms: 10,
  });
  expect(metrics.getSnapshot("bob").endpoints).toEqual([]);
});

test("percentiles use the latest window while max and totals span the reset", () => {
  const clock = createClock();
  const metrics = new ApiRequestMetrics(clock.now);
  const record = (ms: number) => {
    const finish = metrics.begin(null, listSessionsOperation);
    clock.nowMs += ms;
    finish("succeeded");
  };
  record(5000);
  for (let index = 0; index < DURATION_SAMPLE_WINDOW_SIZE; index += 1)
    record(2);
  expect(endpointRow(metrics, null)?.duration).toEqual({
    samples: DURATION_SAMPLE_WINDOW_SIZE + 1,
    totalMs: 5000 + 2 * DURATION_SAMPLE_WINDOW_SIZE,
    p50Ms: 2,
    p95Ms: 2,
    maxMs: 5000,
  });
});

test("reset discards earlier durations and in-flight timings", () => {
  const clock = createClock();
  const metrics = new ApiRequestMetrics(clock.now);
  const before = metrics.begin("alice", listSessionsOperation);
  metrics.begin("alice", listSessionsOperation)("succeeded", {
    totalMs: 4,
    databaseMs: 3,
  });
  metrics.reset("alice");
  const current = metrics.begin("alice", listSessionsOperation);
  clock.nowMs += 900;
  before("succeeded", { totalMs: 800, databaseMs: 700 });
  expect(endpointRow(metrics, "alice")).toMatchObject({
    total: 1,
    inFlight: 1,
    duration: null,
    serverDuration: null,
    databaseDuration: null,
  });
  clock.nowMs += 7;
  current("succeeded");
  expect(endpointRow(metrics, "alice")?.duration).toMatchObject({
    samples: 1,
    maxMs: 907,
  });
});

test("transport records Server-Timing only when the API reports it", async () => {
  const clock = createClock();
  const metrics = new ApiRequestMetrics(clock.now);
  const instrumentation = { metrics, getIdentity: () => null };
  const respond = (headers: HeadersInit) =>
    measureApiRequest(
      instrumentation,
      listSessionsOperation,
      async () => {
        clock.nowMs += 50;
        return new Response(null, { headers, status: 200 });
      },
      undefined,
    );
  await respond({ "Server-Timing": "total;dur=30, db;dur=12.5" });
  await respond({ "Server-Timing": "total;dur=40" });
  await respond({ "Server-Timing": "db;dur=oops" });
  await respond({});
  expect(endpointRow(metrics, null)).toMatchObject({
    duration: { samples: 4, p50Ms: 50, maxMs: 50 },
    serverDuration: { samples: 2, p50Ms: 30, maxMs: 40, totalMs: 70 },
    databaseDuration: { samples: 1, p50Ms: 12.5 },
  });
});

test("connection failures and cancellations are timed without server timing", async () => {
  const clock = createClock();
  const metrics = new ApiRequestMetrics(clock.now);
  const controller = new AbortController();
  const fail = (signal: AbortSignal | undefined) =>
    measureApiRequest(
      { metrics, getIdentity: () => null },
      listSessionsOperation,
      async () => {
        clock.nowMs += 250;
        throw new Error("offline");
      },
      signal,
    ).catch(() => undefined);
  await fail(undefined);
  controller.abort();
  await fail(controller.signal);
  expect(endpointRow(metrics, null)).toMatchObject({
    failed: 1,
    cancelled: 1,
    duration: { samples: 2, totalMs: 500 },
    serverDuration: null,
  });
});

test("a throwing clock cannot fail the request", async () => {
  const metrics = new ApiRequestMetrics(() => {
    throw new Error("clock failed");
  });
  const response = new Response("ok");
  expect(
    await measureApiRequest(
      { metrics, getIdentity: () => null },
      listSessionsOperation,
      async () => response,
      undefined,
    ),
  ).toBe(response);
});

import { expect, spyOn, test } from "bun:test";
import {
  getBlobBytesOperation,
  listSessionsOperation,
} from "@tearleads/validators/operation";
import { ApiRequestMetrics } from "./apiRequestMetrics";
import { measureApiRequest } from "./measureApiRequest";

test("aggregates concurrent attempts by endpoint and identity with immutable snapshots", () => {
  const metrics = new ApiRequestMetrics();
  const first = metrics.begin("alice", listSessionsOperation);
  const initial = metrics.getSnapshot("alice");
  const second = metrics.begin("alice", listSessionsOperation);
  metrics.begin("bob", listSessionsOperation)("failed");
  metrics.begin(null, getBlobBytesOperation)("cancelled");
  second("failed");
  first("succeeded");
  first("succeeded");
  expect(initial).toMatchObject({ total: 1, inFlight: 1, succeeded: 0 });
  expect(metrics.getSnapshot("alice")).toMatchObject({
    total: 2,
    inFlight: 0,
    succeeded: 1,
    failed: 1,
    cancelled: 0,
  });
  expect(metrics.getSnapshot("alice").endpoints).toEqual([
    {
      method: "GET",
      path: "/auth/sessions",
      total: 2,
      inFlight: 0,
      succeeded: 1,
      failed: 1,
      cancelled: 0,
    },
  ]);
  expect(metrics.getSnapshot("bob").total).toBe(1);
  expect(metrics.getSnapshot(null).cancelled).toBe(1);
  expect(metrics.getSnapshot("alice")).toBe(metrics.getSnapshot("alice"));
  expect(new ApiRequestMetrics().getSnapshot("alice").total).toBe(0);
});

test("reset ignores earlier completions even when the same endpoint is requested again", () => {
  const metrics = new ApiRequestMetrics();
  const old = metrics.begin("alice", listSessionsOperation);
  metrics.begin("bob", listSessionsOperation)("succeeded");
  metrics.reset("alice");
  const current = metrics.begin("alice", listSessionsOperation);
  old("failed");
  expect(metrics.getSnapshot("alice")).toMatchObject({
    total: 1,
    inFlight: 1,
    failed: 0,
  });
  current("succeeded");
  expect(metrics.getSnapshot("alice")).toMatchObject({
    total: 1,
    inFlight: 0,
    succeeded: 1,
    failed: 0,
  });
  expect(metrics.getSnapshot("bob").total).toBe(1);
});

test("observers cannot break requests and unsubscribe stops notifications", () => {
  const metrics = new ApiRequestMetrics();
  metrics.subscribe(() => {
    throw new Error("broken observer");
  });
  let notifications = 0;
  const unsubscribe = metrics.subscribe(() => {
    notifications += 1;
  });
  metrics.begin(null, listSessionsOperation)("succeeded");
  unsubscribe();
  metrics.begin(null, listSessionsOperation)("failed");
  expect(notifications).toBe(2);
  expect(metrics.getSnapshot(null).total).toBe(2);
});

test("transport counts binary responses without consuming bodies and pins the dispatch identity", async () => {
  const metrics = new ApiRequestMetrics();
  let identity = "alice";
  const pending = Promise.withResolvers<Response>();
  const request = measureApiRequest(
    { metrics, getIdentity: () => identity },
    getBlobBytesOperation,
    () => pending.promise,
    undefined,
  );
  expect(metrics.getSnapshot("alice").inFlight).toBe(1);
  identity = "bob";
  const response = new Response(new Uint8Array([0, 1, 255]));
  pending.resolve(response);
  expect(await request).toBe(response);
  expect(response.bodyUsed).toBe(false);
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(
    new Uint8Array([0, 1, 255]),
  );
  expect(metrics.getSnapshot("alice")).toMatchObject({
    total: 1,
    succeeded: 1,
    inFlight: 0,
  });
  expect(metrics.getSnapshot("bob").total).toBe(0);
});

test("HTTP, network and cancellation outcomes are counted separately", async () => {
  const metrics = new ApiRequestMetrics();
  const instrumentation = { metrics, getIdentity: () => null };
  const controller = new AbortController();
  await measureApiRequest(
    instrumentation,
    listSessionsOperation,
    async () => new Response(null, { status: 503 }),
    undefined,
  );
  const failure = new Error("connection failed");
  await expect(
    measureApiRequest(
      instrumentation,
      listSessionsOperation,
      async () => {
        throw failure;
      },
      undefined,
    ),
  ).rejects.toBe(failure);
  controller.abort();
  await expect(
    measureApiRequest(
      instrumentation,
      listSessionsOperation,
      async () => {
        throw failure;
      },
      controller.signal,
    ),
  ).rejects.toBe(failure);
  expect(metrics.getSnapshot(null)).toMatchObject({
    total: 3,
    failed: 2,
    cancelled: 1,
    succeeded: 0,
    inFlight: 0,
  });
});

for (const failure of ["identity", "begin", "finish"] as const) {
  test(`instrumentation ${failure} errors cannot prevent or fail HTTP`, async () => {
    const metrics = new ApiRequestMetrics();
    const observerError = new Error("instrumentation failed");
    const begin = spyOn(metrics, "begin");
    if (failure === "begin")
      begin.mockImplementation(() => {
        throw observerError;
      });
    if (failure === "finish")
      begin.mockImplementation(() => () => {
        throw observerError;
      });
    const response = new Response("ok");
    let dispatched = false;
    try {
      const result = await measureApiRequest(
        {
          metrics,
          getIdentity: () => {
            if (failure === "identity") throw observerError;
            return "alice";
          },
        },
        listSessionsOperation,
        async () => {
          dispatched = true;
          return response;
        },
        undefined,
      );
      expect(dispatched).toBe(true);
      expect(result).toBe(response);
    } finally {
      begin.mockRestore();
    }
  });
}

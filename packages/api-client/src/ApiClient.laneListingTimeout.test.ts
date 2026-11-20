import { afterEach, expect, jest } from "bun:test";
import { getHealthOperation } from "@tearleads/validators/operation";
import { SESSION_ERROR_CODES } from "@tearleads/validators/response";
import { HttpResponse, http, passthrough } from "msw";
import {
  apiBaseUrl,
  server as mockServer,
  testApiClient,
} from "../test/helpers/apiClientTestHarness";
import { ApiClient } from "./ApiClient";
import { ApiRequestRuntime } from "./apiRequestRuntime";
import { CONTAINER_LANE_LISTING_TIMEOUT_MS } from "./client/laneListingRequest";
import { createJsonOperationTransport } from "./operationTransport";

const realFetch = globalThis.fetch;

afterEach(() => {
  jest.useRealTimers();
  globalThis.fetch = realFetch;
});

const listingPaths = {
  document: "/containers/documents/query",
  parent: "/containers/parent-lanes/query",
} as const;

// A listing that never completes must not hold its shared request, and every
// caller joined to it, forever: the deadline ends it as a reported network
// failure, whether the server stalls before its headers or inside its body.
for (const listing of ["parent", "document"] as const) {
  for (const phase of ["headers", "body"] as const) {
    testApiClient(
      `a ${listing} lane listing stalled in its ${phase} times out for every joined caller`,
      async () => {
        mockServer.use(
          http.all(/^http:\/\/127\.0\.0\.1:\d+\//, () => passthrough()),
        );
        const stalled = Promise.withResolvers<void>();
        const received = Promise.withResolvers<void>();
        const responded = Promise.withResolvers<void>();
        let requests = 0;
        const server = Bun.serve({
          hostname: "127.0.0.1",
          port: 0,
          async fetch() {
            requests += 1;
            received.resolve();
            if (phase === "body")
              return new Response(
                new ReadableStream({
                  start(body) {
                    body.enqueue(new TextEncoder().encode("{"));
                  },
                }),
                { headers: { "Content-Type": "application/json" } },
              );
            await stalled.promise;
            return Response.json({ results: [] });
          },
        });
        const fetchThroughMock = globalThis.fetch;
        globalThis.fetch = Object.assign(
          async (...args: Parameters<typeof fetch>) => {
            const response = await fetchThroughMock(...args);
            responded.resolve();
            return response;
          },
          { preconnect: fetchThroughMock.preconnect },
        );
        const client = new ApiClient(server.url.origin);
        const errors: string[] = [];
        client.setOnError((message) => errors.push(message));
        let networkErrors = 0;
        client.setOnNetworkError(() => {
          networkErrors += 1;
        });
        const list = () =>
          listing === "parent"
            ? client.listContainerParentLanes({
                lanes: [{ laneId: "root", parentId: null, watermark: null }],
              })
            : client.listContainerDocumentLanes({
                lanes: [
                  {
                    containerId: "container-1",
                    laneId: "lane-0",
                    watermark: null,
                  },
                ],
              });
        try {
          jest.useFakeTimers();
          const first = list();
          const joined = list();
          await (phase === "body" ? responded.promise : received.promise);
          jest.advanceTimersByTime(CONTAINER_LANE_LISTING_TIMEOUT_MS);
          jest.useRealTimers();

          await expect(Promise.all([first, joined])).resolves.toEqual([
            null,
            null,
          ]);
          expect(requests).toBe(1);
          const timeout = `POST ${listingPaths[listing]}: no response within ${CONTAINER_LANE_LISTING_TIMEOUT_MS} ms`;
          // The parent listing reports its one shared failure; each document
          // caller settles the shared result under its own reporting policy.
          expect(errors).toEqual(
            listing === "parent" ? [timeout] : [timeout, timeout],
          );
          // One shared request timed out: one reachability hint, in either
          // phase, not a second one for the body read the deadline aborted.
          expect(networkErrors).toBe(1);
        } finally {
          stalled.resolve();
          await server.stop(true);
        }
      },
    );
  }
}

// A refresh-required 401 makes the request await a session renewal. The
// deadline still ends the listing; the shared renewal keeps running.
testApiClient(
  "a lane listing waiting on a stalled session renewal still times out",
  async () => {
    mockServer.use(
      http.post(`${apiBaseUrl}${listingPaths.parent}`, () =>
        HttpResponse.json(
          {
            code: SESSION_ERROR_CODES.refreshRequired,
            error: "Expired session",
          },
          { status: 401 },
        ),
      ),
    );
    const client = new ApiClient(apiBaseUrl);
    client.setAuthToken("expired-session");
    const renewing = Promise.withResolvers<void>();
    client.setOnSessionExpired(() => {
      renewing.resolve();
      return Promise.withResolvers<boolean>().promise;
    });
    const errors: string[] = [];
    client.setOnError((message) => errors.push(message));

    jest.useFakeTimers();
    const listed = client.listContainerParentLanes({
      lanes: [{ laneId: "root", parentId: null, watermark: null }],
    });
    await renewing.promise;
    jest.advanceTimersByTime(CONTAINER_LANE_LISTING_TIMEOUT_MS);
    jest.useRealTimers();

    // A regression here hangs without tripping the runner's per-test timeout,
    // so bound the wait directly. A passing run settles first and never waits.
    const hang = Promise.withResolvers<"hung">();
    const guard = setTimeout(() => hang.resolve("hung"), 2_000);
    try {
      await expect(Promise.race([listed, hang.promise])).resolves.toBeNull();
    } finally {
      clearTimeout(guard);
    }
    expect(errors).toEqual([
      `POST ${listingPaths.parent}: no response within ${CONTAINER_LANE_LISTING_TIMEOUT_MS} ms`,
    ]);
  },
);

testApiClient(
  "a retired listing deadline leaves the new sign-in's connectivity and failure cache intact",
  async () => {
    const client = new ApiClient(apiBaseUrl);
    client.setAuthToken("first");
    const received = Promise.withResolvers<void>();
    const release = Promise.withResolvers<Response>();
    globalThis.fetch = Object.assign(async () => {
      received.resolve();
      return release.promise;
    }, realFetch);
    let offline = false;
    client.setOnNetworkError(() => {
      offline = true;
    });
    jest.useFakeTimers();
    try {
      const listing = client.listContainerParentLanes({
        lanes: [{ laneId: "root", parentId: null, watermark: null }],
      });
      await received.promise;
      jest.advanceTimersByTime(CONTAINER_LANE_LISTING_TIMEOUT_MS);
      client.setAuthToken("next", { boundary: "replacement" });
      release.resolve(Response.json({ results: [] }));
      await expect(listing).resolves.toBeNull();
      expect(offline).toBe(false);
      expect(
        client.getRequestFailure({ method: "POST", path: listingPaths.parent }),
      ).toBeNull();
    } finally {
      jest.useRealTimers();
      release.resolve(Response.json({ results: [] }));
    }
  },
);

for (const phase of ["headers", "body"])
  testApiClient(
    `a document listing cancelled during ${phase} preserves the concurrent caller's failure`,
    async () => {
      const client = new ApiClient(apiBaseUrl);
      const controller = new AbortController();
      const first = Promise.withResolvers<void>();
      const release = Promise.withResolvers<Response>();
      let calls = 0;
      globalThis.fetch = Object.assign(async () => {
        if (++calls === 1) {
          first.resolve();
          return release.promise;
        }
        return Response.json({ error: "Current failure" }, { status: 503 });
      }, realFetch);
      const input = {
        lanes: [{ containerId: "container-1", laneId: "0", watermark: null }],
      };
      const failure = () =>
        client.getRequestFailure({
          method: "POST",
          path: listingPaths.document,
        });
      try {
        const stale = client.listContainerDocumentLanes(input, {
          signal: controller.signal,
        });
        await first.promise;
        await client.listContainerDocumentLanes(input);
        expect(failure()?.status).toBe(503);
        if (phase === "body") {
          const reading = Promise.withResolvers<void>();
          const body = Promise.withResolvers<unknown>();
          const response = Response.json({ results: [] });
          response.json = () => {
            reading.resolve();
            return body.promise;
          };
          release.resolve(response);
          await reading.promise;
          controller.abort();
          body.resolve({ results: [] });
        } else {
          controller.abort();
          release.resolve(Response.json({ error: "Retired" }, { status: 404 }));
        }
        expect(await stale).toBeNull();
        expect(failure()?.status).toBe(503);
      } finally {
        release.resolve(Response.json({ results: [] }));
      }
    },
  );

for (const phase of [
  "success",
  "cancelled",
  "cancelled-error",
  "aborted-fetch",
])
  testApiClient(
    `an older JSON response preserves concurrent failures (${phase})`,
    async () => {
      const cancelled = phase !== "success";
      const net = new ApiRequestRuntime(apiBaseUrl);
      const transport = createJsonOperationTransport(net.responseRequest);
      const headers = Promise.withResolvers<Response>();
      const body = Promise.withResolvers<unknown>();
      const reading = Promise.withResolvers<void>();
      const controller = new AbortController();
      let count = 0;
      globalThis.fetch = Object.assign(
        async () =>
          ++count === 1
            ? headers.promise
            : Response.json({ error: "Busy" }, { status: 503 }),
        realFetch,
      );
      const currentFailure = () =>
        net.getRequestFailure({ method: "GET", path: "/" });
      const stale = transport.requestResult(
        {
          ...getHealthOperation,
          failureResponses: { 503: getHealthOperation.responses[200] },
        },
        { params: {} },
        {
          signal: controller.signal,
        },
      );
      await transport.requestResult(getHealthOperation, { params: {} });
      expect(currentFailure()?.status).toBe(503);
      if (phase === "aborted-fetch") {
        controller.abort();
        headers.reject(controller.signal.reason);
        expect(await stale).toMatchObject({ ok: false, kind: "cancelled" });
        expect(currentFailure()?.status).toBe(503);
        return;
      }
      const response = Response.json(
        {},
        { status: phase === "cancelled-error" ? 503 : 200 },
      );
      response.text = async () => {
        reading.resolve();
        return JSON.stringify(await body.promise);
      };
      response.json = () => {
        reading.resolve();
        return body.promise;
      };
      headers.resolve(response);
      await reading.promise;
      if (cancelled) controller.abort();
      body.resolve({ message: "ok" });
      expect(await stale).toMatchObject(
        cancelled ? { ok: false, kind: "cancelled" } : { ok: true },
      );
      expect(currentFailure()?.status).toBe(503);
    },
  );

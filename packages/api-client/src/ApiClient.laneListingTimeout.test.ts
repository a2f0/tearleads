import { afterEach, expect, jest } from "bun:test";
import { SESSION_ERROR_CODES } from "@tearleads/validators/response";
import { HttpResponse, http, passthrough } from "msw";
import {
  apiBaseUrl,
  server as mockServer,
  testApiClient,
} from "../test/helpers/apiClientTestHarness";
import { ApiClient } from "./ApiClient";
import { CONTAINER_LANE_LISTING_TIMEOUT_MS } from "./client/laneListingRequest";

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
        } finally {
          stalled.resolve();
          await server.stop(true);
        }
      },
    );
  }
}

// A refresh-required 401 makes the request await a session renewal that does
// not observe the abort signal. The deadline still ends the listing; the
// shared renewal is left to finish on its own.
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

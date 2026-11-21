import { afterEach, expect, jest } from "bun:test";
import {
  type ListContainerDocumentLanesResponse,
  type ListContainerParentLanesResponse,
  SESSION_ERROR_CODES,
} from "@tearleads/validators/response";
import { HttpResponse, http, passthrough } from "msw";
import {
  apiBaseUrl,
  server as mockServer,
  testApiClient,
} from "../test/helpers/apiClientTestHarness";
import { ApiClient } from "./ApiClient";
import {
  CONTAINER_LANE_LISTING_ATTEMPTS,
  CONTAINER_LANE_LISTING_TIMEOUT_MS,
} from "./client/laneListingRequest";

const realFetch = globalThis.fetch;

afterEach(() => {
  jest.useRealTimers();
  globalThis.fetch = realFetch;
});

const listingPaths = {
  document: "/containers/documents/query",
  parent: "/containers/parent-lanes/query",
} as const;

const emptyPage = {
  hasMore: false,
  items: [],
  nextWatermark: null,
  tombstones: [],
};

const listedLanes = {
  document: {
    results: [{ laneId: "lane-0", page: emptyPage }],
  } satisfies ListContainerDocumentLanesResponse,
  parent: {
    results: [{ laneId: "root", page: emptyPage }],
  } satisfies ListContainerParentLanesResponse,
};

function listLanes(client: ApiClient, listing: "parent" | "document") {
  return listing === "parent"
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
}

function attemptSignals() {
  return Array.from({ length: CONTAINER_LANE_LISTING_ATTEMPTS }, () =>
    Promise.withResolvers<void>(),
  );
}

// A listing that never completes must not hold its shared request, and every
// caller joined to it, forever: once every attempt's deadline has passed, it
// ends as a reported network failure, whether the server stalls before its
// headers or inside its body.
for (const listing of ["parent", "document"] as const) {
  for (const phase of ["headers", "body"] as const) {
    testApiClient(
      `a ${listing} lane listing stalled in its ${phase} on every attempt times out for every joined caller`,
      async () => {
        mockServer.use(
          http.all(/^http:\/\/127\.0\.0\.1:\d+\//, () => passthrough()),
        );
        const stalled = Promise.withResolvers<void>();
        const received = attemptSignals();
        const responded = attemptSignals();
        let requests = 0;
        let responses = 0;
        const server = Bun.serve({
          hostname: "127.0.0.1",
          port: 0,
          async fetch() {
            received[requests]?.resolve();
            requests += 1;
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
            responded[responses]?.resolve();
            responses += 1;
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
        try {
          jest.useFakeTimers();
          const first = listLanes(client, listing);
          const joined = listLanes(client, listing);
          // Each attempt starts its own deadline before it dispatches.
          for (
            let attempt = 0;
            attempt < CONTAINER_LANE_LISTING_ATTEMPTS;
            attempt += 1
          ) {
            await (phase === "body" ? responded : received)[attempt]?.promise;
            jest.advanceTimersByTime(CONTAINER_LANE_LISTING_TIMEOUT_MS);
          }
          jest.useRealTimers();

          await expect(Promise.all([first, joined])).resolves.toEqual([
            null,
            null,
          ]);
          expect(requests).toBe(CONTAINER_LANE_LISTING_ATTEMPTS);
          const timeout = `POST ${listingPaths[listing]}: no response within ${CONTAINER_LANE_LISTING_TIMEOUT_MS} ms`;
          // The parent listing reports its one shared failure; each document
          // caller settles the shared result under its own reporting policy.
          expect(errors).toEqual(
            listing === "parent" ? [timeout] : [timeout, timeout],
          );
          // One shared listing timed out: one reachability hint, in either
          // phase, not one per attempt or for the body read the deadline
          // aborted.
          expect(networkErrors).toBe(1);
        } finally {
          stalled.resolve();
          await server.stop(true);
        }
      },
    );
  }
}

// A refresh-required 401 makes the request await a session renewal. Each
// attempt's deadline still ends it; the shared renewal keeps running.
testApiClient(
  "a lane listing waiting on a stalled session renewal still times out",
  async () => {
    const arrived = attemptSignals();
    let requests = 0;
    mockServer.use(
      http.post(`${apiBaseUrl}${listingPaths.parent}`, () => {
        arrived[requests]?.resolve();
        requests += 1;
        return HttpResponse.json(
          {
            code: SESSION_ERROR_CODES.refreshRequired,
            error: "Expired session",
          },
          { status: 401 },
        );
      }),
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
    for (const attempt of arrived) {
      await attempt.promise;
      jest.advanceTimersByTime(CONTAINER_LANE_LISTING_TIMEOUT_MS);
    }
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
    expect(requests).toBe(CONTAINER_LANE_LISTING_ATTEMPTS);
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

// A timed-out listing was most likely lost on its way to the API (#3099: the
// edge accepted it and the Worker never ran it). The listing only reads, so
// it is sent again, and the refresh waiting on it succeeds instead of
// reporting a failure.
for (const listing of ["parent", "document"] as const) {
  testApiClient(
    `a ${listing} lane listing lost on its first attempt succeeds on the retry for every joined caller`,
    async () => {
      mockServer.use(
        http.all(/^http:\/\/127\.0\.0\.1:\d+\//, () => passthrough()),
      );
      const lost = Promise.withResolvers<void>();
      const firstArrived = Promise.withResolvers<void>();
      let requests = 0;
      const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        async fetch() {
          requests += 1;
          if (requests === 1) {
            firstArrived.resolve();
            await lost.promise;
          }
          return Response.json(listedLanes[listing]);
        },
      });
      const client = new ApiClient(server.url.origin);
      const errors: string[] = [];
      client.setOnError((message) => errors.push(message));
      let networkErrors = 0;
      client.setOnNetworkError(() => {
        networkErrors += 1;
      });
      try {
        jest.useFakeTimers();
        const first = listLanes(client, listing);
        const joined = listLanes(client, listing);
        await firstArrived.promise;
        jest.advanceTimersByTime(CONTAINER_LANE_LISTING_TIMEOUT_MS);
        jest.useRealTimers();

        await expect(Promise.all([first, joined])).resolves.toEqual([
          listedLanes[listing],
          listedLanes[listing],
        ]);
        expect(requests).toBe(2);
        expect(errors).toEqual([]);
        expect(networkErrors).toBe(0);
        expect(
          client.getRequestFailure({
            method: "POST",
            path: listingPaths[listing],
          }),
        ).toBeNull();
      } finally {
        jest.useRealTimers();
        lost.resolve();
        await server.stop(true);
      }
    },
  );
}

// Only a timeout is retried: a listing the API answered with an error is
// final, and reported once.
testApiClient("a lane listing the API refused is not retried", async () => {
  let requests = 0;
  mockServer.use(
    http.post(`${apiBaseUrl}${listingPaths.parent}`, () => {
      requests += 1;
      return HttpResponse.json({ error: "Unavailable" }, { status: 503 });
    }),
  );
  const client = new ApiClient(apiBaseUrl);
  const errors: string[] = [];
  client.setOnError((message) => errors.push(message));

  await expect(listLanes(client, "parent")).resolves.toBeNull();
  expect(requests).toBe(1);
  expect(errors).toHaveLength(1);
});

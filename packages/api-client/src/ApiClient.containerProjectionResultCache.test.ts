import { expect } from "bun:test";
import { HttpResponse, http } from "msw";
import { createContainerWriterProjectionResponse } from "../test/helpers/apiClientTestFactories";
import {
  apiBaseUrl,
  type CapturedHttpCall,
  captureHttpCall,
  createDeferred,
  server,
  testApiClient,
} from "../test/helpers/apiClientTestHarness";
import { ApiClient } from "./ApiClient";
import type { CachedRequestResultOptions } from "./types";

type ContainerWriterProjection = ReturnType<
  typeof createContainerWriterProjectionResponse
>;

function seedContainerWriterProjectionPromise(
  client: ApiClient,
  containerId: string,
  entry: Promise<ContainerWriterProjection | null>,
) {
  (
    client as unknown as {
      containerWriterProjectionRequestsByContainerId: Map<
        string,
        Promise<ContainerWriterProjection | null>
      >;
    }
  ).containerWriterProjectionRequestsByContainerId.set(containerId, entry);
}

function seedContainerWriterProjectionCache(
  client: ApiClient,
  containerId: string,
  projection: ContainerWriterProjection,
) {
  seedContainerWriterProjectionPromise(
    client,
    containerId,
    Promise.resolve(projection),
  );
}

function requestSummaries(calls: readonly CapturedHttpCall[]) {
  return calls.map((call) => ({
    body: call.body,
    input: call.url,
    method: call.method,
  }));
}

testApiClient(
  "container writer projection result fetches do not overwrite newer cache entries",
  async () => {
    const calls: CapturedHttpCall[] = [];
    const fetchStarted = createDeferred<void>();
    const finishFetch = createDeferred<void>();
    const staleProjection = createContainerWriterProjectionResponse();
    const baseNewerProjection = createContainerWriterProjectionResponse();
    const newerProjection = {
      ...baseNewerProjection,
      organizationId: `${baseNewerProjection.organizationId}-newer`,
    };
    server.use(
      http.get(
        `${apiBaseUrl}/containers/:containerId/writer-projection`,
        async ({ request }) => {
          calls.push(await captureHttpCall(request));
          fetchStarted.resolve();
          await finishFetch.promise;
          return HttpResponse.json(staleProjection);
        },
      ),
    );

    const client = new ApiClient(apiBaseUrl);
    const result = client.getContainerWriterProjectionResult("container-1", {
      reportErrors: false,
    });
    await fetchStarted.promise;

    seedContainerWriterProjectionCache(client, "container-1", newerProjection);

    finishFetch.resolve();
    await expect(result).resolves.toEqual({ data: staleProjection, ok: true });
    await expect(
      client.getContainerWriterProjection("container-1"),
    ).resolves.toEqual(newerProjection);

    expect(requestSummaries(calls)).toEqual([
      {
        body: null,
        input: `${apiBaseUrl}/containers/container-1/writer-projection`,
        method: "GET",
      },
    ]);
  },
);

testApiClient(
  "container writer projection result fetches do not repopulate an entry evicted mid-flight",
  async () => {
    const calls: CapturedHttpCall[] = [];
    const fetchStarted = createDeferred<void>();
    const finishFetch = createDeferred<void>();
    const staleProjection = createContainerWriterProjectionResponse();
    server.use(
      http.get(
        `${apiBaseUrl}/containers/:containerId/writer-projection`,
        async ({ request }) => {
          calls.push(await captureHttpCall(request));
          if (calls.length === 1) {
            fetchStarted.resolve();
            await finishFetch.promise;
          }
          return HttpResponse.json(staleProjection);
        },
      ),
    );

    const client = new ApiClient(apiBaseUrl);
    const result = client.getContainerWriterProjectionResult("container-1", {
      reportErrors: false,
    });
    await fetchStarted.promise;

    client.evictContainerWriterProjection("container-1");

    finishFetch.resolve();
    await expect(result).resolves.toEqual({ data: staleProjection, ok: true });

    // The eviction wins: the pre-eviction response must not be re-cached, so
    // the next plain read fetches fresh instead of serving the stale value.
    await client.getContainerWriterProjection("container-1");
    expect(calls).toHaveLength(2);
  },
);

testApiClient(
  "container writer projection result reuses an entry replaced while awaiting a cached miss",
  async () => {
    const calls: CapturedHttpCall[] = [];
    const newerProjection = createContainerWriterProjectionResponse();
    server.use(
      http.get(
        `${apiBaseUrl}/containers/:containerId/writer-projection`,
        async ({ request }) => {
          calls.push(await captureHttpCall(request));
          return HttpResponse.json(createContainerWriterProjectionResponse());
        },
      ),
    );

    const client = new ApiClient(apiBaseUrl);
    const emptyEntry = createDeferred<ContainerWriterProjection | null>();
    seedContainerWriterProjectionPromise(
      client,
      "container-1",
      emptyEntry.promise,
    );

    const result = client.getContainerWriterProjectionResult("container-1", {
      reportErrors: false,
    });
    seedContainerWriterProjectionCache(client, "container-1", newerProjection);
    emptyEntry.resolve(null);

    // The newer entry installed while awaiting the empty one is reused: no
    // fetch fires, and the entry survives instead of being clobbered.
    await expect(result).resolves.toEqual({ data: newerProjection, ok: true });
    await expect(
      client.getContainerWriterProjection("container-1"),
    ).resolves.toEqual(newerProjection);
    expect(calls).toHaveLength(0);
  },
);

testApiClient(
  "container result callers do not adopt an in-flight fetch after eviction",
  async () => {
    const calls: CapturedHttpCall[] = [];
    const fetchStarted = createDeferred<void>();
    const finishFirstFetch = createDeferred<void>();
    const staleProjection = createContainerWriterProjectionResponse();
    const baseFreshProjection = createContainerWriterProjectionResponse();
    const freshProjection = {
      ...baseFreshProjection,
      organizationId: `${baseFreshProjection.organizationId}-fresh`,
    };
    server.use(
      http.get(
        `${apiBaseUrl}/containers/:containerId/writer-projection`,
        async ({ request }) => {
          calls.push(await captureHttpCall(request));
          if (calls.length === 1) {
            fetchStarted.resolve();
            await finishFirstFetch.promise;
            return HttpResponse.json(staleProjection);
          }
          return HttpResponse.json(freshProjection);
        },
      ),
    );

    const client = new ApiClient(apiBaseUrl);
    const first = client.getContainerWriterProjectionResult("container-1", {
      reportErrors: false,
    });
    await fetchStarted.promise;

    client.evictContainerWriterProjection("container-1");

    // A result caller arriving after the eviction must not coalesce onto the
    // pre-eviction fetch: its answer comes from a fresh request.
    const second = client.getContainerWriterProjectionResult("container-1", {
      reportErrors: false,
    });
    await expect(second).resolves.toEqual({ data: freshProjection, ok: true });

    finishFirstFetch.resolve();
    await expect(first).resolves.toEqual({ data: staleProjection, ok: true });
    expect(calls).toHaveLength(2);
  },
);

testApiClient(
  "concurrent container writer projection result callers share one failing fetch",
  async () => {
    const calls: CapturedHttpCall[] = [];
    const finishFetch = createDeferred<void>();
    server.use(
      http.get(
        `${apiBaseUrl}/containers/:containerId/writer-projection`,
        async ({ request }) => {
          calls.push(await captureHttpCall(request));
          await finishFetch.promise;
          return HttpResponse.json(
            { error: "Payment required" },
            { status: 402, statusText: "Payment Required" },
          );
        },
      ),
    );

    const client = new ApiClient(apiBaseUrl);
    const first = client.getContainerWriterProjectionResult("container-1", {
      reportErrors: false,
    });
    const second = client.getContainerWriterProjectionResult("container-1", {
      reportErrors: false,
    });
    finishFetch.resolve();

    // The burst shares one fetch, failure included, so the request and its
    // side effects (reporting, the 402 billing signal) fire once.
    await expect(first).resolves.toMatchObject({ ok: false, status: 402 });
    await expect(second).resolves.toMatchObject({ ok: false, status: 402 });
    expect(calls).toHaveLength(1);

    // Failures are shared in flight, never cached: a later retry refetches.
    await expect(
      client.getContainerWriterProjectionResult("container-1", {
        reportErrors: false,
      }),
    ).resolves.toMatchObject({ ok: false, status: 402 });
    expect(calls).toHaveLength(2);
  },
);

testApiClient(
  "coalesced result callers apply their own reporting policy",
  async () => {
    const calls: CapturedHttpCall[] = [];
    const finishFetch = createDeferred<void>();
    const reportedErrors: string[] = [];
    server.use(
      http.get(
        `${apiBaseUrl}/containers/:containerId/writer-projection`,
        async ({ request }) => {
          calls.push(await captureHttpCall(request));
          await finishFetch.promise;
          return HttpResponse.json(
            { error: "Payment required" },
            { status: 402, statusText: "Payment Required" },
          );
        },
      ),
    );

    const client = new ApiClient(apiBaseUrl);
    client.setOnError((message) => {
      reportedErrors.push(message);
    });
    const silent = client.getContainerWriterProjectionResult("container-1", {
      reportErrors: false,
    });
    const reporting = client.getContainerWriterProjectionResult("container-1");
    finishFetch.resolve();

    // One shared fetch, but reporting follows each caller's own policy: the
    // default caller reports the failure, the silent caller does not.
    await expect(silent).resolves.toMatchObject({ ok: false, status: 402 });
    await expect(reporting).resolves.toMatchObject({ ok: false, status: 402 });
    expect(calls).toHaveLength(1);
    expect(reportedErrors).toHaveLength(1);
  },
);

testApiClient(
  "post-prime container result callers read the seed, not an older in-flight fetch",
  async () => {
    const calls: CapturedHttpCall[] = [];
    const fetchStarted = createDeferred<void>();
    const finishFetch = createDeferred<void>();
    const staleProjection = createContainerWriterProjectionResponse();
    const basePrimedProjection = createContainerWriterProjectionResponse();
    const primedProjection = {
      ...basePrimedProjection,
      organizationId: `${basePrimedProjection.organizationId}-primed`,
    };
    server.use(
      http.get(
        `${apiBaseUrl}/containers/:containerId/writer-projection`,
        async ({ request }) => {
          calls.push(await captureHttpCall(request));
          fetchStarted.resolve();
          await finishFetch.promise;
          return HttpResponse.json(staleProjection);
        },
      ),
    );

    const client = new ApiClient(apiBaseUrl);
    const first = client.getContainerWriterProjectionResult("container-1", {
      reportErrors: false,
    });
    await fetchStarted.promise;

    client.primeContainerWriterProjection("container-1", primedProjection);

    // The just-authored seed supersedes the in-flight GET for new callers.
    const second = client.getContainerWriterProjectionResult("container-1", {
      reportErrors: false,
    });
    await expect(second).resolves.toEqual({ data: primedProjection, ok: true });

    finishFetch.resolve();
    await expect(first).resolves.toEqual({ data: staleProjection, ok: true });

    // The seed survives the older fetch's settle, and no extra GET fired.
    await expect(
      client.getContainerWriterProjection("container-1"),
    ).resolves.toEqual(primedProjection);
    expect(calls).toHaveLength(1);
  },
);

testApiClient(
  "plain callers keep their own reporting during a silent result fetch",
  async () => {
    const calls: CapturedHttpCall[] = [];
    const finishFetch = createDeferred<void>();
    const reportedErrors: string[] = [];
    server.use(
      http.get(
        `${apiBaseUrl}/containers/:containerId/writer-projection`,
        async ({ request }) => {
          calls.push(await captureHttpCall(request));
          await finishFetch.promise;
          return HttpResponse.json(
            { error: "Payment required" },
            { status: 402, statusText: "Payment Required" },
          );
        },
      ),
    );

    const client = new ApiClient(apiBaseUrl);
    client.setOnError((message) => {
      reportedErrors.push(message);
    });
    const silentResult = client.getContainerWriterProjectionResult(
      "container-1",
      { reportErrors: false },
    );
    const plain = client.getContainerWriterProjection("container-1");
    finishFetch.resolve();

    // The silent result fetch is never published to the plain cache while in
    // flight, so the plain caller runs (and reports) its own request instead
    // of inheriting silence.
    await expect(silentResult).resolves.toMatchObject({
      ok: false,
      status: 402,
    });
    await expect(plain).resolves.toBeNull();
    expect(calls).toHaveLength(2);
    expect(reportedErrors).toHaveLength(1);
  },
);

testApiClient(
  "container writer projection result strips request-affecting options",
  async () => {
    let smuggledHeader: string | null = null;
    const projection = createContainerWriterProjectionResponse();
    server.use(
      http.get(
        `${apiBaseUrl}/containers/:containerId/writer-projection`,
        ({ request }) => {
          smuggledHeader = request.headers.get("x-caller-specific");
          return HttpResponse.json(projection);
        },
      ),
    );

    const client = new ApiClient(apiBaseUrl);
    // The type narrows to reporting-only options, but a widened variable can
    // still carry request-affecting fields structurally; they must not reach
    // the request that populates the shared cache.
    const widenedOptions = {
      headers: { "x-caller-specific": "1" },
      reportErrors: false,
    } as CachedRequestResultOptions;
    await expect(
      client.getContainerWriterProjectionResult("container-1", widenedOptions),
    ).resolves.toEqual({ data: projection, ok: true });
    expect(smuggledHeader).toBeNull();
  },
);

testApiClient(
  "container writer projection result failures clear the entry so a retry refetches",
  async () => {
    const calls: CapturedHttpCall[] = [];
    const projection = createContainerWriterProjectionResponse();
    let denyFetch = true;
    server.use(
      http.get(
        `${apiBaseUrl}/containers/:containerId/writer-projection`,
        async ({ request }) => {
          calls.push(await captureHttpCall(request));
          if (denyFetch) {
            return HttpResponse.json(
              { error: "Payment required" },
              { status: 402, statusText: "Payment Required" },
            );
          }
          return HttpResponse.json(projection);
        },
      ),
    );

    const client = new ApiClient(apiBaseUrl);
    await expect(
      client.getContainerWriterProjectionResult("container-1", {
        reportErrors: false,
      }),
    ).resolves.toMatchObject({ ok: false, status: 402 });

    denyFetch = false;
    await expect(
      client.getContainerWriterProjectionResult("container-1", {
        reportErrors: false,
      }),
    ).resolves.toEqual({ data: projection, ok: true });

    expect(calls).toHaveLength(2);
  },
);

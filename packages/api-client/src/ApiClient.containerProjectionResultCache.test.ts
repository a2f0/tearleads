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
  "evicting one container leaves another container's coalescing intact",
  async () => {
    const calls: CapturedHttpCall[] = [];
    const fetchStarted = createDeferred<void>();
    const finishFetch = createDeferred<void>();
    const projection = createContainerWriterProjectionResponse();
    server.use(
      http.get(
        `${apiBaseUrl}/containers/:containerId/writer-projection`,
        async ({ request }) => {
          calls.push(await captureHttpCall(request));
          fetchStarted.resolve();
          await finishFetch.promise;
          return HttpResponse.json(projection);
        },
      ),
    );

    const client = new ApiClient(apiBaseUrl);
    const first = client.getContainerWriterProjectionResult("container-1", {
      reportErrors: false,
    });
    await fetchStarted.promise;

    // An unrelated id's eviction must not unpin container-1's in-flight
    // fetch: a second caller still joins it, and the success still warms the
    // cache afterward.
    client.evictContainerWriterProjection("container-2");

    const second = client.getContainerWriterProjectionResult("container-1", {
      reportErrors: false,
    });
    finishFetch.resolve();
    await expect(first).resolves.toEqual({ data: projection, ok: true });
    await expect(second).resolves.toEqual({ data: projection, ok: true });
    expect(calls).toHaveLength(1);

    await expect(
      client.getContainerWriterProjection("container-1"),
    ).resolves.toEqual(projection);
    expect(calls).toHaveLength(1);
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
  "result callers prefer a newly cached plain GET over an older in-flight fetch",
  async () => {
    const calls: CapturedHttpCall[] = [];
    const firstStarted = createDeferred<void>();
    const finishFirst = createDeferred<void>();
    const oldProjection = createContainerWriterProjectionResponse();
    const baseNewProjection = createContainerWriterProjectionResponse();
    const newProjection = {
      ...baseNewProjection,
      organizationId: `${baseNewProjection.organizationId}-new`,
    };
    server.use(
      http.get(
        `${apiBaseUrl}/containers/:containerId/writer-projection`,
        async ({ request }) => {
          calls.push(await captureHttpCall(request));
          if (calls.length === 1) {
            firstStarted.resolve();
            await finishFirst.promise;
            return HttpResponse.json(oldProjection);
          }
          return HttpResponse.json(newProjection);
        },
      ),
    );

    const client = new ApiClient(apiBaseUrl);
    const first = client.getContainerWriterProjectionResult("container-1", {
      reportErrors: false,
    });
    await firstStarted.promise;

    // A plain caller runs its own GET, which completes first and populates
    // the cache with newer material than the still-running result fetch.
    await expect(
      client.getContainerWriterProjection("container-1"),
    ).resolves.toEqual(newProjection);

    // A result caller arriving now must read that newer cached value instead
    // of joining the older in-flight fetch.
    const third = client.getContainerWriterProjectionResult("container-1", {
      reportErrors: false,
    });
    finishFirst.resolve();
    await expect(third).resolves.toEqual({ data: newProjection, ok: true });
    await expect(first).resolves.toEqual({ data: oldProjection, ok: true });

    // The older fetch's settle does not clobber the newer cached entry, and
    // no extra request fired beyond the two real fetches.
    await expect(
      client.getContainerWriterProjection("container-1"),
    ).resolves.toEqual(newProjection);
    expect(calls).toHaveLength(2);
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

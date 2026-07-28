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

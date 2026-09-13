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

testApiClient(
  "a plain projection read evicted mid-flight is not retained and the next read fetches again",
  async () => {
    const calls: CapturedHttpCall[] = [];
    const fetchStarted = createDeferred<void>();
    const finishFetch = createDeferred<void>();
    const staleProjection = createContainerWriterProjectionResponse();
    const freshProjection = {
      ...createContainerWriterProjectionResponse(),
      organizationId: "organization-rotated",
    };
    server.use(
      http.get(
        `${apiBaseUrl}/containers/:containerId/writer-projection`,
        async ({ request }) => {
          calls.push(await captureHttpCall(request));
          if (calls.length === 1) {
            fetchStarted.resolve();
            await finishFetch.promise;
            return HttpResponse.json(staleProjection);
          }
          return HttpResponse.json(freshProjection);
        },
      ),
    );

    const client = new ApiClient(apiBaseUrl);
    const stale = client.getContainerWriterProjection("container-1");
    await fetchStarted.promise;
    // A realtime hint invalidates the container while the read is open.
    client.evictContainerWriterProjection("container-1");
    finishFetch.resolve();
    await expect(stale).resolves.toEqual(staleProjection);

    // The pre-hint answer must not sit in the cache: the next read fetches.
    await expect(
      client.getContainerWriterProjection("container-1"),
    ).resolves.toEqual(freshProjection);
    expect(calls).toHaveLength(2);
  },
);

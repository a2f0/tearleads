import { expect } from "bun:test";
import { HttpResponse, http } from "msw";
import { ApiClient } from "./ApiClient";
import {
  createDocumentLinkSetMutationRequest,
  createDocumentLinkSetMutationResponse,
  createDocumentWriterProjectionResponse,
} from "./ApiClient.testFactories";
import {
  apiBaseUrl,
  type CapturedHttpCall,
  captureHttpCall,
  server,
  testApiClient,
} from "./ApiClient.testHarness";

testApiClient(
  "serves a primed document writer projection without a network fetch",
  async () => {
    const calls: CapturedHttpCall[] = [];
    server.use(
      http.get(
        `${apiBaseUrl}/documents/:documentId/writer-projection`,
        async ({ request }) => {
          calls.push(await captureHttpCall(request));
          return HttpResponse.json(createDocumentWriterProjectionResponse());
        },
      ),
    );

    const client = new ApiClient(apiBaseUrl);
    const projection = createDocumentWriterProjectionResponse();

    // A mutation workflow primes the cache from the response it just authored.
    client.primeDocumentWriterProjection(projection.documentId, projection);

    // The next two reads resolve from the seed: no GET writer-projection.
    await expect(
      client.getDocumentWriterProjection(projection.documentId),
    ).resolves.toEqual(projection);
    await expect(
      client.getDocumentWriterProjection(projection.documentId),
    ).resolves.toEqual(projection);

    expect(calls).toEqual([]);
  },
);

testApiClient(
  "re-priming after a link mutation avoids the post-link projection fetch",
  async () => {
    const calls: CapturedHttpCall[] = [];
    server.use(
      http.get(
        `${apiBaseUrl}/documents/:documentId/writer-projection`,
        async ({ request }) => {
          calls.push(await captureHttpCall(request));
          return HttpResponse.json(createDocumentWriterProjectionResponse());
        },
      ),
      http.post(
        `${apiBaseUrl}/documents/:documentId/link`,
        async ({ request }) => {
          calls.push(await captureHttpCall(request));
          return HttpResponse.json(createDocumentLinkSetMutationResponse());
        },
      ),
    );

    const client = new ApiClient(apiBaseUrl);
    const projection = createDocumentWriterProjectionResponse();

    // linkDocument invalidates the cached projection (its authorizing paths
    // changed); the relink workflow re-primes from the reconstructed
    // post-mutation projection, so the next read still skips the GET.
    await expect(
      client.linkDocument(
        projection.documentId,
        createDocumentLinkSetMutationRequest(),
      ),
    ).resolves.not.toBeNull();
    client.primeDocumentWriterProjection(projection.documentId, projection);
    await expect(
      client.getDocumentWriterProjection(projection.documentId),
    ).resolves.toEqual(projection);

    // Only the link POST hit the network — no writer-projection GET.
    expect(
      calls.map((call) => ({ input: call.url, method: call.method })),
    ).toEqual([
      {
        input: `${apiBaseUrl}/documents/${projection.documentId}/link`,
        method: "POST",
      },
    ]);
  },
);

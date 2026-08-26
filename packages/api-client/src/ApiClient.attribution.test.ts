import { expect } from "bun:test";
import { HttpResponse, http } from "msw";
import {
  createDocumentLinkSetMutationRequest,
  createDocumentLinkSetMutationResponse,
  createDocumentPurgeRequest,
  createDocumentSyncRequest,
  createDocumentSyncResponse,
} from "../test/helpers/apiClientTestFactories";
import {
  apiBaseUrl,
  type CapturedHttpCall,
  captureHttpCall,
  createDeferred,
  server,
  testApiClient,
} from "../test/helpers/apiClientTestHarness";
import { ApiClient } from "./ApiClient";

const attributionMutationCases = [
  {
    name: "link",
    run: (client: ApiClient) =>
      client.linkDocument("document-1", createDocumentLinkSetMutationRequest()),
  },
  {
    name: "unlink",
    run: (client: ApiClient) =>
      client.unlinkDocument(
        "document-1",
        createDocumentLinkSetMutationRequest(),
      ),
  },
  {
    name: "sync",
    run: (client: ApiClient) =>
      client.syncDocument("document-1", createDocumentSyncRequest()),
  },
  {
    name: "sync-result",
    run: (client: ApiClient) =>
      client.syncDocumentResult("document-1", createDocumentSyncRequest()),
  },
  {
    name: "purge",
    run: (client: ApiClient) =>
      client.purgeDocument("document-1", createDocumentPurgeRequest()),
  },
] as const;

testApiClient(
  "lists a bounded page of detailed document attribution ranges",
  async () => {
    const calls: CapturedHttpCall[] = [];
    const response = {
      attributionRevision: 7,
      documentId: "document/with spaces",
      hasMore: true,
      items: [
        {
          authorityKind: "direct" as const,
          endCounter: 4,
          peerId: "peer-1",
          startCounter: 1,
          updateId: "update-1",
          writerKeyFingerprint: "fingerprint-1",
          writerUserId: "user-1",
        },
      ],
      nextCursor: "next-page",
    };
    server.use(
      http.get(
        `${apiBaseUrl}/documents/:documentId/attribution/ranges`,
        async ({ request }) => {
          calls.push(await captureHttpCall(request));
          return HttpResponse.json(response);
        },
      ),
    );

    const client = new ApiClient(apiBaseUrl);
    await expect(
      client.listDocumentEditAttributionRanges("document/with spaces", {
        cursor: "page one",
        expectedRevision: 7,
        limit: 25,
      }),
    ).resolves.toEqual(response);

    expect(calls).toEqual([
      {
        authorization: null,
        body: null,
        contentType: null,
        method: "GET",
        url: `${apiBaseUrl}/documents/document%2Fwith%20spaces/attribution/ranges?cursor=page+one&expectedRevision=7&limit=25`,
      },
    ]);
  },
);

testApiClient(
  "preserves an empty attribution cursor for server validation",
  async () => {
    let requestedUrl = "";
    server.use(
      http.get(
        `${apiBaseUrl}/documents/:documentId/attribution/ranges`,
        ({ request }) => {
          requestedUrl = request.url;
          return HttpResponse.json(
            { error: "invalid cursor" },
            { status: 400 },
          );
        },
      ),
    );

    const client = new ApiClient(apiBaseUrl);
    await expect(
      client.listDocumentEditAttributionRanges("document-1", { cursor: "" }),
    ).resolves.toBeNull();
    expect(requestedUrl).toEndWith(
      "/documents/document-1/attribution/ranges?cursor=",
    );
  },
);

for (const mutationCase of attributionMutationCases) {
  testApiClient(
    `${mutationCase.name} isolates attribution requests started before and during the mutation`,
    async () => {
      const firstAttributionStarted = createDeferred<void>();
      const finishFirstAttribution = createDeferred<void>();
      const secondAttributionStarted = createDeferred<void>();
      const finishSecondAttribution = createDeferred<void>();
      const mutationStarted = createDeferred<void>();
      const finishMutation = createDeferred<void>();
      let requestCount = 0;
      const attributionResponse = {
        attributionRevision: 1,
        documentId: "document-1",
        segments: [],
      };
      const mutationHandler = async (request: Request) => {
        mutationStarted.resolve();
        await finishMutation.promise;
        if (request.url.endsWith("/purge")) {
          return HttpResponse.json({
            authorizingContainerPath: [],
            documentContainerManifestHistory: [],
            documentId: "document-1",
            documentManifest: {},
            documentManifestContainerPaths: [],
            documentManifestHistory: [],
            purgeEvent: {},
            purgedAt: "2026-07-14T12:00:00.000Z",
            reclaimedBlobStorageKeys: [],
          });
        }
        return HttpResponse.json(
          request.url.endsWith("/sync")
            ? createDocumentSyncResponse()
            : createDocumentLinkSetMutationResponse(),
        );
      };
      server.use(
        http.get(
          `${apiBaseUrl}/documents/:documentId/attribution`,
          async () => {
            requestCount += 1;
            if (requestCount === 1) {
              firstAttributionStarted.resolve();
              await finishFirstAttribution.promise;
            } else if (requestCount === 2) {
              secondAttributionStarted.resolve();
              await finishSecondAttribution.promise;
            }
            return HttpResponse.json(attributionResponse);
          },
        ),
        http.all(
          `${apiBaseUrl}/documents/:documentId/:mutation`,
          ({ request }) => mutationHandler(request),
        ),
      );

      const client = new ApiClient(apiBaseUrl);
      const beforeMutation = client.getDocumentEditAttribution("document-1");
      await firstAttributionStarted.promise;
      const mutation = mutationCase.run(client);
      await mutationStarted.promise;
      const duringMutation = client.getDocumentEditAttribution("document-1");
      await secondAttributionStarted.promise;
      finishMutation.resolve();
      await mutation;

      await expect(
        client.getDocumentEditAttribution("document-1"),
      ).resolves.toEqual(attributionResponse);
      expect(requestCount).toBe(3);

      finishFirstAttribution.resolve();
      finishSecondAttribution.resolve();
      await Promise.all([beforeMutation, duringMutation]);
    },
  );
}

testApiClient(
  "auth changes isolate in-flight attribution requests",
  async () => {
    const requestStarted = createDeferred<void>();
    const finishRequest = createDeferred<void>();
    let requestCount = 0;
    const attributionResponse = {
      attributionRevision: 0,
      documentId: "document-1",
      segments: [],
    };
    server.use(
      http.get(`${apiBaseUrl}/documents/:documentId/attribution`, async () => {
        requestCount += 1;
        if (requestCount === 1) {
          requestStarted.resolve();
          await finishRequest.promise;
        }
        return HttpResponse.json(attributionResponse);
      }),
    );

    const client = new ApiClient(apiBaseUrl);
    const anonymous = client.getDocumentEditAttribution("document-1");
    await requestStarted.promise;
    client.setAuthToken("fresh-session");
    await expect(
      client.getDocumentEditAttribution("document-1"),
    ).resolves.toEqual(attributionResponse);
    expect(requestCount).toBe(2);

    finishRequest.resolve();
    await anonymous;
  },
);

testApiClient(
  "dedupes only concurrent document attribution requests",
  async () => {
    const requestStarted = createDeferred<void>();
    const finishRequest = createDeferred<void>();
    let requestCount = 0;
    const attributionResponse = {
      attributionRevision: 0,
      documentId: "document-1",
      segments: [],
    };
    server.use(
      http.get(`${apiBaseUrl}/documents/:documentId/attribution`, async () => {
        requestCount += 1;
        if (requestCount === 1) {
          requestStarted.resolve();
          await finishRequest.promise;
        }
        return HttpResponse.json(attributionResponse);
      }),
    );

    const client = new ApiClient(apiBaseUrl);
    const first = client.getDocumentEditAttribution("document-1");
    await requestStarted.promise;
    const concurrent = client.getDocumentEditAttribution("document-1");
    finishRequest.resolve();

    await expect(Promise.all([first, concurrent])).resolves.toEqual([
      attributionResponse,
      attributionResponse,
    ]);
    expect(requestCount).toBe(1);

    await expect(
      client.getDocumentEditAttribution("document-1"),
    ).resolves.toEqual(attributionResponse);
    expect(requestCount).toBe(2);
  },
);

testApiClient(
  "does not join attribution requests across freshness generations",
  async () => {
    const firstRequestStarted = createDeferred<void>();
    const finishFirstRequest = createDeferred<void>();
    let requestCount = 0;
    const attributionResponse = {
      attributionRevision: 0,
      documentId: "document-1",
      segments: [],
    };
    server.use(
      http.get(`${apiBaseUrl}/documents/:documentId/attribution`, async () => {
        requestCount += 1;
        if (requestCount === 1) {
          firstRequestStarted.resolve();
          await finishFirstRequest.promise;
        }
        return HttpResponse.json(attributionResponse);
      }),
    );

    const client = new ApiClient(apiBaseUrl);
    const stale = client.getDocumentEditAttribution("document-1", "event-1");
    await firstRequestStarted.promise;
    const fresh = client.getDocumentEditAttribution("document-1", "event-2");

    await expect(fresh).resolves.toEqual(attributionResponse);
    finishFirstRequest.resolve();
    await expect(stale).resolves.toEqual(attributionResponse);
    expect(requestCount).toBe(2);
  },
);

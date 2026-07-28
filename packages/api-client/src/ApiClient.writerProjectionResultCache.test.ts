import { expect } from "bun:test";
import { HttpResponse, http } from "msw";
import {
  createDocumentSyncRequest,
  createDocumentSyncResponse,
  createDocumentWriterProjectionResponse,
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

type DocumentWriterProjection = ReturnType<
  typeof createDocumentWriterProjectionResponse
>;

function seedDocumentWriterProjectionCache(
  client: ApiClient,
  documentId: string,
  projection: DocumentWriterProjection,
) {
  (
    client as unknown as {
      documentWriterProjectionRequestsByDocumentId: Map<
        string,
        Promise<DocumentWriterProjection | null>
      >;
    }
  ).documentWriterProjectionRequestsByDocumentId.set(
    documentId,
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
  "writer projection result fetches do not overwrite newer cache entries",
  async () => {
    const calls: CapturedHttpCall[] = [];
    const fetchStarted = createDeferred<void>();
    const finishFetch = createDeferred<void>();
    const staleProjection = createDocumentWriterProjectionResponse();
    const baseNewerProjection = createDocumentWriterProjectionResponse();
    const newerProjection = {
      ...baseNewerProjection,
      contentKeyBundle: {
        ...baseNewerProjection.contentKeyBundle,
        contentKeyEpoch: 2,
      },
    };
    server.use(
      http.get(
        `${apiBaseUrl}/documents/:documentId/writer-projection`,
        async ({ request }) => {
          calls.push(await captureHttpCall(request));
          fetchStarted.resolve();
          await finishFetch.promise;
          return HttpResponse.json(staleProjection);
        },
      ),
    );

    const client = new ApiClient(apiBaseUrl);
    const result = client.getDocumentWriterProjectionResult("document-1", {
      reportErrors: false,
    });
    await fetchStarted.promise;

    seedDocumentWriterProjectionCache(client, "document-1", newerProjection);

    finishFetch.resolve();
    await expect(result).resolves.toEqual({ data: staleProjection, ok: true });
    await expect(
      client.getDocumentWriterProjection("document-1"),
    ).resolves.toEqual(newerProjection);

    expect(requestSummaries(calls)).toEqual([
      {
        body: null,
        input: `${apiBaseUrl}/documents/document-1/writer-projection`,
        method: "GET",
      },
    ]);
  },
);

function useSpanningSyncProjectionHandlers(input: {
  finishFirstGet: Promise<void>;
  fetchStarted: () => void;
  freshProjection: ReturnType<typeof createDocumentWriterProjectionResponse>;
  getCalls: CapturedHttpCall[];
  staleProjection: ReturnType<typeof createDocumentWriterProjectionResponse>;
}) {
  server.use(
    http.get(
      `${apiBaseUrl}/documents/:documentId/writer-projection`,
      async ({ request }) => {
        input.getCalls.push(await captureHttpCall(request));
        if (input.getCalls.length === 1) {
          input.fetchStarted();
          await input.finishFirstGet;
          return HttpResponse.json(input.staleProjection);
        }
        return HttpResponse.json(input.freshProjection);
      },
    ),
    http.post(`${apiBaseUrl}/documents/:documentId/sync`, () =>
      HttpResponse.json(createDocumentSyncResponse()),
    ),
  );
}

// A result GET that spans a document sync predates whatever key material the
// sync committed. With no cached projection to compare against, the sync must
// still conservatively invalidate: the pre-sync fetch's success must not be
// cached, and a post-sync result caller must not coalesce onto it.
for (const variant of ["syncDocument", "syncDocumentResult"] as const) {
  testApiClient(
    `a result fetch spanning ${variant} is not cached or adopted afterward`,
    async () => {
      const getCalls: CapturedHttpCall[] = [];
      const fetchStarted = createDeferred<void>();
      const finishFirstGet = createDeferred<void>();
      const staleProjection = createDocumentWriterProjectionResponse();
      const baseFreshProjection = createDocumentWriterProjectionResponse();
      const freshProjection = {
        ...baseFreshProjection,
        contentKeyBundle: {
          ...baseFreshProjection.contentKeyBundle,
          contentKeyEpoch: 3,
        },
      };
      useSpanningSyncProjectionHandlers({
        fetchStarted: () => fetchStarted.resolve(),
        finishFirstGet: finishFirstGet.promise,
        freshProjection,
        getCalls,
        staleProjection,
      });

      const client = new ApiClient(apiBaseUrl);
      const first = client.getDocumentWriterProjectionResult("document-1", {
        reportErrors: false,
      });
      await fetchStarted.promise;

      if (variant === "syncDocument") {
        await client.syncDocument("document-1", createDocumentSyncRequest());
      } else {
        await client.syncDocumentResult(
          "document-1",
          createDocumentSyncRequest(),
          { reportErrors: false },
        );
      }

      const second = client.getDocumentWriterProjectionResult("document-1", {
        reportErrors: false,
      });
      await expect(second).resolves.toEqual({
        data: freshProjection,
        ok: true,
      });

      finishFirstGet.resolve();
      await expect(first).resolves.toEqual({ data: staleProjection, ok: true });
      expect(getCalls).toHaveLength(2);

      await expect(
        client.getDocumentWriterProjection("document-1"),
      ).resolves.toEqual(freshProjection);
      expect(getCalls).toHaveLength(2);
    },
  );
}

testApiClient(
  "post-prime document result callers read the seed, not an older in-flight fetch",
  async () => {
    const calls: CapturedHttpCall[] = [];
    const fetchStarted = createDeferred<void>();
    const finishFetch = createDeferred<void>();
    const staleProjection = createDocumentWriterProjectionResponse();
    const basePrimedProjection = createDocumentWriterProjectionResponse();
    const primedProjection = {
      ...basePrimedProjection,
      contentKeyBundle: {
        ...basePrimedProjection.contentKeyBundle,
        contentKeyEpoch: 7,
      },
    };
    server.use(
      http.get(
        `${apiBaseUrl}/documents/:documentId/writer-projection`,
        async ({ request }) => {
          calls.push(await captureHttpCall(request));
          fetchStarted.resolve();
          await finishFetch.promise;
          return HttpResponse.json(staleProjection);
        },
      ),
    );

    const client = new ApiClient(apiBaseUrl);
    const first = client.getDocumentWriterProjectionResult("document-1", {
      reportErrors: false,
    });
    await fetchStarted.promise;

    client.primeDocumentWriterProjection("document-1", primedProjection);

    // The just-authored seed supersedes the in-flight GET for new callers.
    const second = client.getDocumentWriterProjectionResult("document-1", {
      reportErrors: false,
    });
    await expect(second).resolves.toEqual({ data: primedProjection, ok: true });

    finishFetch.resolve();
    await expect(first).resolves.toEqual({ data: staleProjection, ok: true });

    // The seed survives the older fetch's settle, and no extra GET fired.
    await expect(
      client.getDocumentWriterProjection("document-1"),
    ).resolves.toEqual(primedProjection);
    expect(calls).toHaveLength(1);
  },
);

testApiClient(
  "writer projection result failures do not delete newer cache entries",
  async () => {
    const calls: CapturedHttpCall[] = [];
    const fetchStarted = createDeferred<void>();
    const finishFetch = createDeferred<void>();
    const newerProjection = createDocumentWriterProjectionResponse();
    server.use(
      http.get(
        `${apiBaseUrl}/documents/:documentId/writer-projection`,
        async ({ request }) => {
          calls.push(await captureHttpCall(request));
          fetchStarted.resolve();
          await finishFetch.promise;
          return HttpResponse.json(
            { error: "Document not found" },
            { status: 404, statusText: "Not Found" },
          );
        },
      ),
    );

    const client = new ApiClient(apiBaseUrl);
    const result = client.getDocumentWriterProjectionResult("document-1", {
      reportErrors: false,
    });
    await fetchStarted.promise;

    seedDocumentWriterProjectionCache(client, "document-1", newerProjection);

    finishFetch.resolve();
    await expect(result).resolves.toMatchObject({ ok: false, status: 404 });
    await expect(
      client.getDocumentWriterProjection("document-1"),
    ).resolves.toEqual(newerProjection);

    expect(requestSummaries(calls)).toEqual([
      {
        body: null,
        input: `${apiBaseUrl}/documents/document-1/writer-projection`,
        method: "GET",
      },
    ]);
  },
);

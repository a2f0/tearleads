import { expect } from "bun:test";
import { HttpResponse, http } from "msw";
import {
  createContainerWriterProjectionResponse,
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

type ContainerWriterProjection = ReturnType<
  typeof createContainerWriterProjectionResponse
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

function seedContainerWriterProjectionCache(
  client: ApiClient,
  containerId: string,
  projection: ContainerWriterProjection,
) {
  (
    client as unknown as {
      containerWriterProjectionRequestsByContainerId: Map<
        string,
        Promise<ContainerWriterProjection | null>
      >;
    }
  ).containerWriterProjectionRequestsByContainerId.set(
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

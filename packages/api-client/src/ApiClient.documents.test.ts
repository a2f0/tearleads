import { expect } from "bun:test";
import { HttpResponse, http } from "msw";
import {
  createDocumentCreateRequest,
  createDocumentCreateResponse,
  createDocumentLinkSetMutationRequest,
  createDocumentLinkSetMutationResponse,
  createDocumentSyncRequest,
  createDocumentSyncResponse,
} from "../test/helpers/apiClientTestFactories";
import {
  apiBaseUrl,
  type CapturedHttpCall,
  captureHttpCall,
  server,
  testApiClient,
} from "../test/helpers/apiClientTestHarness";
import { ApiClient } from "./ApiClient";

testApiClient(
  "posts signed document link-set mutations to the route namespace",
  async () => {
    const calls: CapturedHttpCall[] = [];
    server.use(
      http.all(`${apiBaseUrl}/*`, async ({ request }) => {
        calls.push(await captureHttpCall(request));
        return HttpResponse.json(createDocumentLinkSetMutationResponse());
      }),
    );

    const client = new ApiClient(apiBaseUrl);
    const mutation = createDocumentLinkSetMutationRequest();

    expect(await client.linkDocument("document-1", mutation)).not.toBeNull();
    expect(await client.unlinkDocument("document-1", mutation)).not.toBeNull();

    expect(
      calls.map((call) => ({
        body: call.body,
        input: call.url,
        method: call.method,
      })),
    ).toEqual([
      {
        body: JSON.stringify(mutation),
        input: `${apiBaseUrl}/documents/document-1/link`,
        method: "POST",
      },
      {
        body: JSON.stringify(mutation),
        input: `${apiBaseUrl}/documents/document-1/unlink`,
        method: "POST",
      },
    ]);
  },
);

testApiClient(
  "posts signed document create and sync mutations to the route namespace",
  async () => {
    const calls: CapturedHttpCall[] = [];
    server.use(
      http.all(`${apiBaseUrl}/*`, async ({ request }) => {
        calls.push(await captureHttpCall(request));
        const body = request.url.endsWith("/sync")
          ? createDocumentSyncResponse()
          : createDocumentCreateResponse();
        return HttpResponse.json(body);
      }),
    );

    const client = new ApiClient(apiBaseUrl);
    const createRequest = createDocumentCreateRequest();
    const syncRequest = createDocumentSyncRequest();

    expect(await client.createDocument(createRequest)).not.toBeNull();
    expect(await client.syncDocument("document-1", syncRequest)).not.toBeNull();

    expect(
      calls.map((call) => ({
        body: call.body,
        input: call.url,
        method: call.method,
      })),
    ).toEqual([
      {
        body: JSON.stringify(createRequest),
        input: `${apiBaseUrl}/documents`,
        method: "POST",
      },
      {
        body: JSON.stringify(syncRequest),
        input: `${apiBaseUrl}/documents/document-1/sync`,
        method: "POST",
      },
    ]);
  },
);

testApiClient("rejects an invalid document sync response shape", async () => {
  server.use(
    http.post(`${apiBaseUrl}/documents/:documentId/sync`, () =>
      HttpResponse.json({
        ...createDocumentSyncResponse(),
        contentKeyBundle: undefined,
      }),
    ),
  );

  const client = new ApiClient(apiBaseUrl);
  const errors: string[] = [];
  client.setOnError((message) => {
    errors.push(message);
  });

  await expect(
    client.syncDocument("document-1", createDocumentSyncRequest()),
  ).resolves.toBeNull();
  expect(errors).toEqual([
    "Invalid response shape for /documents/document-1/sync",
  ]);
});

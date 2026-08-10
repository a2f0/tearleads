import { expect } from "bun:test";
import { HttpResponse, http } from "msw";
import {
  createBlobAttachmentBindRequest,
  createBlobAttachmentBindResponse,
  createBlobAttachmentDetachRequest,
  createContainerMutationRequest,
  createContainerMutationResponse,
  createContainerWriterProjectionResponse,
  createDocumentLinkSetMutationRequest,
  createDocumentLinkSetMutationResponse,
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

testApiClient(
  "caches writer projection requests and invalidates on mutations",
  async () => {
    const calls: CapturedHttpCall[] = [];
    server.use(
      http.get(
        `${apiBaseUrl}/containers/:containerId/writer-projection`,
        async ({ request }) => {
          calls.push(await captureHttpCall(request));
          return HttpResponse.json(createContainerWriterProjectionResponse());
        },
      ),
      http.get(
        `${apiBaseUrl}/documents/:documentId/writer-projection`,
        async ({ request }) => {
          calls.push(await captureHttpCall(request));
          return HttpResponse.json(createDocumentWriterProjectionResponse());
        },
      ),
      http.post(
        `${apiBaseUrl}/containers/:containerId/share`,
        async ({ request }) => {
          calls.push(await captureHttpCall(request));
          return HttpResponse.json(createContainerMutationResponse());
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

    await expect(
      client.getContainerWriterProjection("container-1"),
    ).resolves.toEqual(createContainerWriterProjectionResponse());
    await expect(
      client.getContainerWriterProjection("container-1"),
    ).resolves.toEqual(createContainerWriterProjectionResponse());
    await expect(
      client.getDocumentWriterProjection("document-1"),
    ).resolves.toEqual(createDocumentWriterProjectionResponse());
    await expect(
      client.getDocumentWriterProjection("document-1"),
    ).resolves.toEqual(createDocumentWriterProjectionResponse());

    await expect(
      client.shareContainer("container-1", createContainerMutationRequest()),
    ).resolves.not.toBeNull();
    await expect(
      client.getContainerWriterProjection("container-1"),
    ).resolves.toEqual(createContainerWriterProjectionResponse());
    await expect(
      client.getDocumentWriterProjection("document-1"),
    ).resolves.toEqual(createDocumentWriterProjectionResponse());

    await expect(
      client.linkDocument("document-1", createDocumentLinkSetMutationRequest()),
    ).resolves.not.toBeNull();
    await expect(
      client.getDocumentWriterProjection("document-1"),
    ).resolves.toEqual(createDocumentWriterProjectionResponse());

    expect(
      calls.map((call) => ({
        body: call.body,
        input: call.url,
        method: call.method,
      })),
    ).toEqual([
      {
        body: null,
        input: `${apiBaseUrl}/containers/container-1/writer-projection`,
        method: "GET",
      },
      {
        body: null,
        input: `${apiBaseUrl}/documents/document-1/writer-projection`,
        method: "GET",
      },
      {
        body: JSON.stringify(createContainerMutationRequest()),
        input: `${apiBaseUrl}/containers/container-1/share`,
        method: "POST",
      },
      {
        body: null,
        input: `${apiBaseUrl}/containers/container-1/writer-projection`,
        method: "GET",
      },
      {
        body: null,
        input: `${apiBaseUrl}/documents/document-1/writer-projection`,
        method: "GET",
      },
      {
        body: JSON.stringify(createDocumentLinkSetMutationRequest()),
        input: `${apiBaseUrl}/documents/document-1/link`,
        method: "POST",
      },
      {
        body: null,
        input: `${apiBaseUrl}/documents/document-1/writer-projection`,
        method: "GET",
      },
    ]);
  },
);

testApiClient(
  "keeps document writer projections across matching syncs and clears on sync failure",
  async () => {
    const calls: CapturedHttpCall[] = [];
    let failSync = false;
    server.use(
      http.get(
        `${apiBaseUrl}/documents/:documentId/writer-projection`,
        async ({ request }) => {
          calls.push(await captureHttpCall(request));
          return HttpResponse.json(createDocumentWriterProjectionResponse());
        },
      ),
      http.post(
        `${apiBaseUrl}/documents/:documentId/sync`,
        async ({ request }) => {
          calls.push(await captureHttpCall(request));
          if (failSync) {
            return HttpResponse.json(
              { error: "Document KEK targets are stale" },
              { status: 409, statusText: "Conflict" },
            );
          }
          return HttpResponse.json(createDocumentSyncResponse());
        },
      ),
    );

    const client = new ApiClient(apiBaseUrl);

    await expect(
      client.getDocumentWriterProjection("document-1"),
    ).resolves.toEqual(createDocumentWriterProjectionResponse());
    await expect(
      client.syncDocumentResult("document-1", createDocumentSyncRequest(), {
        reportErrors: false,
      }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      client.getDocumentWriterProjection("document-1"),
    ).resolves.toEqual(createDocumentWriterProjectionResponse());

    failSync = true;
    await expect(
      client.syncDocumentResult("document-1", createDocumentSyncRequest(), {
        reportErrors: false,
      }),
    ).resolves.toMatchObject({ ok: false, status: 409 });
    await expect(
      client.getDocumentWriterProjection("document-1"),
    ).resolves.toEqual(createDocumentWriterProjectionResponse());

    expect(
      calls.map((call) => ({
        body: call.body,
        input: call.url,
        method: call.method,
      })),
    ).toEqual([
      {
        body: null,
        input: `${apiBaseUrl}/documents/document-1/writer-projection`,
        method: "GET",
      },
      {
        body: JSON.stringify(createDocumentSyncRequest()),
        input: `${apiBaseUrl}/documents/document-1/sync`,
        method: "POST",
      },
      {
        body: JSON.stringify(createDocumentSyncRequest()),
        input: `${apiBaseUrl}/documents/document-1/sync`,
        method: "POST",
      },
      {
        body: null,
        input: `${apiBaseUrl}/documents/document-1/writer-projection`,
        method: "GET",
      },
    ]);
  },
);

testApiClient(
  "updates cached document attachment lists after attachment mutations",
  async () => {
    const calls: CapturedHttpCall[] = [];
    const attachmentBinding = createBlobAttachmentBindResponse();
    server.use(
      http.get(
        `${apiBaseUrl}/documents/:documentId/attachments`,
        async ({ request }) => {
          calls.push(await captureHttpCall(request));
          return HttpResponse.json([]);
        },
      ),
      http.post(
        `${apiBaseUrl}/blobs/:blobId/attachment-bindings`,
        async ({ request }) => {
          calls.push(await captureHttpCall(request));
          return HttpResponse.json(attachmentBinding);
        },
      ),
      http.post(
        `${apiBaseUrl}/blobs/:blobId/attachment-bindings/:bindingId/detach`,
        async ({ params, request }) => {
          calls.push(await captureHttpCall(request));
          const { bindingId, blobId } = params;
          return HttpResponse.json({
            bindingId: String(bindingId),
            blobId: String(blobId),
            documentId: "document-1",
            slotId: "slot-a",
          });
        },
      ),
    );

    const client = new ApiClient(apiBaseUrl);

    await expect(client.listDocumentAttachments("document-1")).resolves.toEqual(
      [],
    );
    await expect(client.listDocumentAttachments("document-1")).resolves.toEqual(
      [],
    );
    await expect(
      client.bindBlobAttachment("blob-1", createBlobAttachmentBindRequest()),
    ).resolves.toEqual(attachmentBinding);
    await expect(client.listDocumentAttachments("document-1")).resolves.toEqual(
      [
        {
          bindingId: "binding-1",
          blobId: "blob-1",
          blobKekTargets: attachmentBinding.blobKekTargets,
          contentKeyBundle: attachmentBinding.contentKeyBundle,
          slotId: "slot-a",
        },
      ],
    );
    await expect(
      client.detachBlobAttachment(
        "blob-1",
        "binding-1",
        createBlobAttachmentDetachRequest(),
      ),
    ).resolves.not.toBeNull();
    await expect(client.listDocumentAttachments("document-1")).resolves.toEqual(
      [],
    );

    expect(
      calls.map((call) => ({
        body: call.body,
        input: call.url,
        method: call.method,
      })),
    ).toEqual([
      {
        body: null,
        input: `${apiBaseUrl}/documents/document-1/attachments`,
        method: "GET",
      },
      {
        body: JSON.stringify(createBlobAttachmentBindRequest()),
        input: `${apiBaseUrl}/blobs/blob-1/attachment-bindings`,
        method: "POST",
      },
      {
        body: JSON.stringify(createBlobAttachmentDetachRequest()),
        input: `${apiBaseUrl}/blobs/blob-1/attachment-bindings/binding-1/detach`,
        method: "POST",
      },
    ]);
  },
);

testApiClient(
  "coalesces in-flight container document lists without caching settled responses",
  async () => {
    const calls: CapturedHttpCall[] = [];
    const firstDocumentsRequestStarted = createDeferred<void>();
    const finishDocumentsRequest = createDeferred<void>();
    const listContainerDocumentsResponse = {
      hasMore: false,
      items: [],
      nextWatermark: null,
      tombstones: [],
    };

    server.use(
      http.get(
        `${apiBaseUrl}/containers/:containerId/documents`,
        async ({ request }) => {
          calls.push(await captureHttpCall(request));
          if (
            calls.filter((call) => call.url.includes("/documents")).length === 1
          ) {
            firstDocumentsRequestStarted.resolve();
            await finishDocumentsRequest.promise;
          }
          return HttpResponse.json(listContainerDocumentsResponse);
        },
      ),
    );

    const client = new ApiClient(apiBaseUrl);
    const firstDocumentsRequest = client.listContainerDocuments("container-1");
    await firstDocumentsRequestStarted.promise;
    const secondDocumentsRequest = client.listContainerDocuments("container-1");
    finishDocumentsRequest.resolve();
    await expect(
      Promise.all([firstDocumentsRequest, secondDocumentsRequest]),
    ).resolves.toEqual([
      listContainerDocumentsResponse,
      listContainerDocumentsResponse,
    ]);

    await expect(client.listContainerDocuments("container-1")).resolves.toEqual(
      listContainerDocumentsResponse,
    );

    expect(
      calls.map((call) => ({
        input: call.url,
        method: call.method,
      })),
    ).toEqual([
      {
        input: `${apiBaseUrl}/containers/container-1/documents`,
        method: "GET",
      },
      {
        input: `${apiBaseUrl}/containers/container-1/documents`,
        method: "GET",
      },
    ]);
  },
);

testApiClient(
  "keeps writer projection requests started during failed syncs",
  async () => {
    const calls: CapturedHttpCall[] = [];
    const syncStarted = createDeferred<void>();
    const finishSync = createDeferred<void>();
    server.use(
      http.get(
        `${apiBaseUrl}/documents/:documentId/writer-projection`,
        async ({ request }) => {
          calls.push(await captureHttpCall(request));
          return HttpResponse.json(createDocumentWriterProjectionResponse());
        },
      ),
      http.post(
        `${apiBaseUrl}/documents/:documentId/sync`,
        async ({ request }) => {
          calls.push(await captureHttpCall(request));
          syncStarted.resolve();
          await finishSync.promise;
          return HttpResponse.json(
            { error: "Document KEK targets are stale" },
            { status: 409, statusText: "Conflict" },
          );
        },
      ),
    );

    const client = new ApiClient(apiBaseUrl);
    const syncResult = client.syncDocumentResult(
      "document-1",
      createDocumentSyncRequest(),
      { reportErrors: false },
    );
    await syncStarted.promise;

    await expect(
      client.getDocumentWriterProjection("document-1"),
    ).resolves.toEqual(createDocumentWriterProjectionResponse());

    finishSync.resolve();
    await expect(syncResult).resolves.toMatchObject({ ok: false, status: 409 });
    await expect(
      client.getDocumentWriterProjection("document-1"),
    ).resolves.toEqual(createDocumentWriterProjectionResponse());

    expect(
      calls.map((call) => ({
        body: call.body,
        input: call.url,
        method: call.method,
      })),
    ).toEqual([
      {
        body: JSON.stringify(createDocumentSyncRequest()),
        input: `${apiBaseUrl}/documents/document-1/sync`,
        method: "POST",
      },
      {
        body: null,
        input: `${apiBaseUrl}/documents/document-1/writer-projection`,
        method: "GET",
      },
    ]);
  },
);

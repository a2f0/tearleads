import { expect } from "bun:test";
import { HttpResponse, http } from "msw";
import {
  createBlobAttachmentBindResponse,
  createDocumentLinkSetMutationRequest,
  createDocumentLinkSetMutationResponse,
} from "../test/helpers/apiClientTestFactories";
import {
  apiBaseUrl,
  createDeferred,
  server,
  testApiClient,
} from "../test/helpers/apiClientTestHarness";
import { ApiClient } from "./ApiClient";

const mutations = [
  "linkDocument",
  "linkDocumentResult",
  "unlinkDocument",
  "unlinkDocumentResult",
] as const;

for (const mutation of mutations) {
  for (const status of [200, 409, 503]) {
    testApiClient(
      `${mutation} evicts attachment envelopes after HTTP ${status} without evicting other documents`,
      async () => {
        const original = createBlobAttachmentBindResponse();
        const updated = {
          ...original,
          contentKeyBundle: {
            ...original.contentKeyBundle,
            targetHash: "changed-attachment-targets",
          },
        };
        let current = original;
        const reads: string[] = [];
        server.use(
          http.get(
            `${apiBaseUrl}/documents/:documentId/attachments`,
            ({ params }) => {
              const { documentId } = params;
              reads.push(String(documentId));
              return HttpResponse.json([current]);
            },
          ),
          http.post(`${apiBaseUrl}/documents/:documentId/:operation`, () => {
            current = updated;
            return status === 200
              ? HttpResponse.json(createDocumentLinkSetMutationResponse())
              : HttpResponse.json(
                  { error: "Mutation unavailable" },
                  { status },
                );
          }),
        );
        const client = new ApiClient(apiBaseUrl);
        expect(await client.listDocumentAttachments("document-1")).toEqual([
          original,
        ]);
        expect(await client.listDocumentAttachments("document-2")).toEqual([
          original,
        ]);

        await client[mutation](
          "document-1",
          createDocumentLinkSetMutationRequest(),
        );

        expect(await client.listDocumentAttachments("document-1")).toEqual([
          updated,
        ]);
        expect(await client.listDocumentAttachments("document-2")).toEqual([
          original,
        ]);
        expect(reads).toEqual(["document-1", "document-2", "document-1"]);
      },
    );
  }
}

testApiClient(
  "projection invalidation also refreshes attachment key targets",
  async () => {
    let reads = 0;
    server.use(
      http.get(`${apiBaseUrl}/documents/:documentId/attachments`, () => {
        reads += 1;
        return HttpResponse.json([]);
      }),
    );
    const client = new ApiClient(apiBaseUrl);
    await client.listDocumentAttachments("document-1");
    await client.listDocumentAttachments("document-2");
    client.evictDocumentWriterProjection("document-1");
    await client.listDocumentAttachments("document-1");
    await client.listDocumentAttachments("document-2");
    expect(reads).toBe(3);
    client.clearWriterProjectionCaches();
    await client.listDocumentAttachments("document-1");
    await client.listDocumentAttachments("document-2");
    expect(reads).toBe(5);
  },
);

testApiClient(
  "a pre-link attachment read cannot repopulate the cache after the link",
  async () => {
    const started = createDeferred<void>();
    const release = createDeferred<void>();
    const original = createBlobAttachmentBindResponse();
    let reads = 0;
    server.use(
      http.get(`${apiBaseUrl}/documents/:documentId/attachments`, async () => {
        reads += 1;
        if (reads === 1) {
          started.resolve();
          await release.promise;
          return HttpResponse.json([]);
        }
        return HttpResponse.json([original]);
      }),
      http.post(`${apiBaseUrl}/documents/:documentId/link`, () =>
        HttpResponse.json(createDocumentLinkSetMutationResponse()),
      ),
    );
    const client = new ApiClient(apiBaseUrl);
    const pending = client.listDocumentAttachments("document-1");
    await started.promise;
    try {
      await client.linkDocumentResult(
        "document-1",
        createDocumentLinkSetMutationRequest(),
      );
      const afterLink = client.listDocumentAttachments("document-1");
      release.resolve();
      expect(await afterLink).toEqual([original]);
    } finally {
      release.resolve();
    }
    expect(await pending).toEqual([]);
    expect(await client.listDocumentAttachments("document-1")).toEqual([
      original,
    ]);
    expect(reads).toBe(2);
  },
);

import { expect } from "bun:test";
import { HttpResponse, http } from "msw";
import {
  createContainerWriterProjectionResponse,
  createDocumentWriterProjectionResponse,
} from "../test/helpers/apiClientTestFactories";
import {
  apiBaseUrl,
  server,
  testApiClient,
} from "../test/helpers/apiClientTestHarness";
import { ApiClient } from "./ApiClient";

// A compromised server answering `GET /containers/P/writer-projection` with
// the genuine projection of another container M would otherwise make the
// caller wrap a new child's KEK under M's KEK. The projection must describe
// the object it was requested for.

testApiClient(
  "container writer projection for another container is an invalid response",
  async () => {
    const substituted = createContainerWriterProjectionResponse();
    const requestedContainerId = `${substituted.containerId}-requested`;
    const reported: string[] = [];
    server.use(
      http.get(`${apiBaseUrl}/containers/:containerId/writer-projection`, () =>
        HttpResponse.json(substituted),
      ),
    );

    const client = new ApiClient(apiBaseUrl);
    client.setOnError((message) => {
      reported.push(message);
    });

    expect(
      await client.getContainerWriterProjection(requestedContainerId),
    ).toBeNull();
    expect(
      await client.getContainerWriterProjectionResult(requestedContainerId, {
        reportErrors: false,
      }),
    ).toMatchObject({ kind: "shape", ok: false, status: 200 });
    expect(reported).toHaveLength(1);

    expect(
      await client.getContainerWriterProjection(substituted.containerId),
    ).toEqual(substituted);
  },
);

// Relabeling the mutable top-level id is not enough either: the signed leaf
// manifest and its KEK still describe the substituted container.
testApiClient(
  "container writer projection relabeled with the requested id is invalid",
  async () => {
    const substituted = createContainerWriterProjectionResponse();
    const requestedContainerId = `${substituted.containerId}-requested`;
    server.use(
      http.get(`${apiBaseUrl}/containers/:containerId/writer-projection`, () =>
        HttpResponse.json({
          ...substituted,
          containerId: requestedContainerId,
        }),
      ),
    );

    const client = new ApiClient(apiBaseUrl);
    expect(
      await client.getContainerWriterProjection(requestedContainerId),
    ).toBeNull();
  },
);

testApiClient(
  "document writer projection relabeled with the requested id is invalid",
  async () => {
    const substituted = createDocumentWriterProjectionResponse();
    const requestedDocumentId = `${substituted.documentId}-requested`;
    server.use(
      http.get(`${apiBaseUrl}/documents/:documentId/writer-projection`, () =>
        HttpResponse.json({
          ...substituted,
          contentKeyBundle: {
            ...substituted.contentKeyBundle,
            documentId: requestedDocumentId,
          },
          documentId: requestedDocumentId,
          documentKekTargets: {
            ...substituted.documentKekTargets,
            documentId: requestedDocumentId,
          },
        }),
      ),
    );

    const client = new ApiClient(apiBaseUrl);
    expect(
      await client.getDocumentWriterProjection(requestedDocumentId),
    ).toBeNull();
  },
);

testApiClient(
  "document writer projection for another document is an invalid response",
  async () => {
    const substituted = createDocumentWriterProjectionResponse();
    const requestedDocumentId = `${substituted.documentId}-requested`;
    server.use(
      http.get(`${apiBaseUrl}/documents/:documentId/writer-projection`, () =>
        HttpResponse.json(substituted),
      ),
    );

    const client = new ApiClient(apiBaseUrl);

    expect(
      await client.getDocumentWriterProjection(requestedDocumentId),
    ).toBeNull();
    expect(
      await client.getDocumentWriterProjectionResult(requestedDocumentId, {
        reportErrors: false,
      }),
    ).toMatchObject({ kind: "shape", ok: false, status: 200 });

    expect(
      await client.getDocumentWriterProjection(substituted.documentId),
    ).toEqual(substituted);
  },
);

testApiClient("writer projection primes must describe the primed id", () => {
  const client = new ApiClient(apiBaseUrl);
  const containerProjection = createContainerWriterProjectionResponse();
  const documentProjection = createDocumentWriterProjectionResponse();

  expect(() =>
    client.primeContainerWriterProjection("other", containerProjection),
  ).toThrow("does not describe other");
  expect(() =>
    client.primeDocumentWriterProjection("other", documentProjection),
  ).toThrow("does not describe other");
  // A relabeled seed carries the requested top-level id over a foreign
  // manifest, state, and KEK; it must fail the same binding a fetch does.
  expect(() =>
    client.primeContainerWriterProjection("other", {
      ...containerProjection,
      containerId: "other",
    }),
  ).toThrow("does not describe other");
  expect(() =>
    client.primeDocumentWriterProjection("other", {
      ...documentProjection,
      contentKeyBundle: {
        ...documentProjection.contentKeyBundle,
        documentId: "other",
      },
      documentId: "other",
      documentKekTargets: {
        ...documentProjection.documentKekTargets,
        documentId: "other",
      },
    }),
  ).toThrow("does not describe other");

  client.primeContainerWriterProjection(
    containerProjection.containerId,
    containerProjection,
  );
  client.primeDocumentWriterProjection(
    documentProjection.documentId,
    documentProjection,
  );
});

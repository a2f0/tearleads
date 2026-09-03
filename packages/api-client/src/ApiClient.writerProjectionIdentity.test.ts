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
  ).toThrow("describes");
  expect(() =>
    client.primeDocumentWriterProjection("other", documentProjection),
  ).toThrow("describes");

  client.primeContainerWriterProjection(
    containerProjection.containerId,
    containerProjection,
  );
  client.primeDocumentWriterProjection(
    documentProjection.documentId,
    documentProjection,
  );
});
